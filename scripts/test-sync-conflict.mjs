import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const tempDir = mkdtempSync(join(tmpdir(), 'logseq-dida-sync-test-'));

try {
  execFileSync(
    'pnpm',
    [
      'exec',
      'tsc',
      'src/sync-conflict.ts',
      'src/checklist-plan.ts',
      'src/task-state.ts',
      'src/ticktick/task.ts',
      '--target',
      'ES2020',
      '--module',
      'commonjs',
      '--moduleResolution',
      'node',
      '--skipLibCheck',
      '--outDir',
      tempDir,
    ],
    { stdio: 'inherit' },
  );

  const require = createRequire(import.meta.url);
  const directPath = join(tempDir, 'sync-conflict.js');
  const nestedPath = join(tempDir, 'src', 'sync-conflict.js');
  const compiledPath = existsSync(directPath) ? directPath : nestedPath;
  const directPlanPath = join(tempDir, 'checklist-plan.js');
  const nestedPlanPath = join(tempDir, 'src', 'checklist-plan.js');
  const compiledPlanPath = existsSync(directPlanPath) ? directPlanPath : nestedPlanPath;
  const {
    classifySyncState,
    parseSnapshot,
    snapshotFromLocalContent,
    snapshotFromRemoteTask,
  } = require(compiledPath);
  const { planChecklistApply } = require(compiledPlanPath);

  const baseline = snapshotFromLocalContent('TODO Alpha', []);
  const sameLocal = snapshotFromLocalContent('TODO Alpha', []);
  const sameRemote = snapshotFromRemoteTask({
    id: 't1', projectId: 'p1', title: 'Alpha', status: 0, priority: 0, items: [],
  });
  assert.equal(classifySyncState(baseline, sameLocal, sameRemote), 'unchanged');

  const localTitleChanged = snapshotFromLocalContent('TODO Alpha local', []);
  assert.equal(classifySyncState(baseline, localTitleChanged, sameRemote), 'keep-local');

  const remoteTitleChanged = snapshotFromRemoteTask({
    id: 't1', projectId: 'p1', title: 'Alpha remote', status: 0, priority: 0, items: [],
  });
  assert.equal(classifySyncState(baseline, sameLocal, remoteTitleChanged), 'pull-remote');
  assert.equal(classifySyncState(baseline, localTitleChanged, remoteTitleChanged), 'conflict');

  const convergedLocal = snapshotFromLocalContent('DONE Alpha final', []);
  const convergedRemote = snapshotFromRemoteTask({
    id: 't1', projectId: 'p1', title: 'Alpha final', status: 1, priority: 0, items: [],
  });
  assert.equal(classifySyncState(baseline, convergedLocal, convergedRemote), 'converged');

  const checklistBaseline = snapshotFromLocalContent('TODO Parent', [
    { title: 'Child A', completed: false },
    { title: 'Child B', completed: false },
  ]);
  const checklistRemoteBaseline = snapshotFromRemoteTask({
    id: 't2',
    projectId: 'p1',
    title: 'Parent',
    status: 0,
    priority: 0,
    items: [
      { title: 'Child A', status: 0 },
      { title: 'Child B', status: 0 },
    ],
  });
  assert.equal(
    classifySyncState(checklistBaseline, checklistBaseline, checklistRemoteBaseline),
    'unchanged',
  );

  const localChecklistChanged = snapshotFromLocalContent('TODO Parent', [
    { title: 'Child A edited', completed: false },
    { title: 'Child B', completed: false },
  ]);
  assert.equal(
    classifySyncState(checklistBaseline, localChecklistChanged, checklistRemoteBaseline),
    'keep-local',
  );

  const localChecklistDeleted = snapshotFromLocalContent('TODO Parent', [
    { title: 'Child A', completed: false },
  ]);
  assert.equal(
    classifySyncState(checklistBaseline, localChecklistDeleted, checklistRemoteBaseline),
    'conflict',
  );

  const remoteChecklistAppended = snapshotFromRemoteTask({
    id: 't2',
    projectId: 'p1',
    title: 'Parent',
    status: 0,
    priority: 0,
    items: [
      { title: 'Child A', status: 0 },
      { title: 'Child B', status: 0 },
      { title: 'Child C', status: 0 },
    ],
  });
  assert.equal(
    classifySyncState(checklistBaseline, checklistBaseline, remoteChecklistAppended),
    'pull-remote',
  );
  assert.equal(
    classifySyncState(checklistBaseline, localChecklistChanged, remoteChecklistAppended),
    'conflict',
  );

  const remoteChecklistDeleted = snapshotFromRemoteTask({
    id: 't2', projectId: 'p1', title: 'Parent', status: 0, priority: 0,
    items: [{ title: 'Child A', status: 0 }],
  });
  assert.equal(
    classifySyncState(checklistBaseline, checklistBaseline, remoteChecklistDeleted),
    'conflict',
  );

  const remoteChecklistReordered = snapshotFromRemoteTask({
    id: 't2', projectId: 'p1', title: 'Parent', status: 0, priority: 0,
    items: [
      { title: 'Child B', status: 0 },
      { title: 'Child A', status: 0 },
    ],
  });
  assert.equal(
    classifySyncState(checklistBaseline, checklistBaseline, remoteChecklistReordered),
    'conflict',
  );

  const remoteChecklistInsertedInMiddle = snapshotFromRemoteTask({
    id: 't2', projectId: 'p1', title: 'Parent', status: 0, priority: 0,
    items: [
      { title: 'Child A', status: 0 },
      { title: 'Inserted', status: 0 },
      { title: 'Child B', status: 0 },
    ],
  });
  assert.equal(
    classifySyncState(checklistBaseline, checklistBaseline, remoteChecklistInsertedInMiddle),
    'conflict',
  );

  const remoteChecklistStatusChanged = snapshotFromRemoteTask({
    id: 't2', projectId: 'p1', title: 'Parent', status: 0, priority: 0,
    items: [
      { title: 'Child A', status: 1 },
      { title: 'Child B', status: 0 },
    ],
  });
  assert.equal(
    classifySyncState(checklistBaseline, checklistBaseline, remoteChecklistStatusChanged),
    'pull-remote',
  );

  assert.equal(planChecklistApply(['A', 'B'], ['A', 'B']), 'positional');
  assert.equal(planChecklistApply(['A', 'B'], ['A edited', 'B']), 'positional');
  assert.equal(planChecklistApply(['A', 'B'], ['A', 'B', 'C']), 'append');
  assert.equal(planChecklistApply(['A', 'B'], ['A']), 'rebuild');
  assert.equal(planChecklistApply(['A', 'B'], ['B', 'A']), 'rebuild');
  assert.equal(planChecklistApply(['A', 'B'], ['A', 'Inserted', 'B']), 'rebuild');

  const legacyBaseline = JSON.stringify({
    title: 'Legacy', completed: false, priority: 0, startDate: null, dueDate: null,
  });
  assert.deepEqual(parseSnapshot(legacyBaseline), {
    title: 'Legacy',
    completed: false,
    priority: 0,
    startDate: null,
    dueDate: null,
    items: [],
  });

  assert.equal(classifySyncState(null, sameLocal, remoteTitleChanged), 'conflict');
  console.log('Sync-state and checklist planner regression tests passed.');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
