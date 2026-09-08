import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const tempDir = mkdtempSync(join(tmpdir(), 'logseq-dida-sync-test-'));
const bundlePath = join(tempDir, 'sync-conflict.mjs');

try {
  execFileSync(
    'pnpm',
    [
      'exec',
      'esbuild',
      'src/sync-conflict.ts',
      '--bundle',
      '--platform=node',
      '--format=esm',
      `--outfile=${bundlePath}`,
    ],
    { stdio: 'inherit' },
  );

  const {
    classifySyncState,
    parseSnapshot,
    snapshotFromLocalContent,
    snapshotFromRemoteTask,
  } = await import(pathToFileURL(bundlePath).href);

  const baseline = snapshotFromLocalContent('TODO Alpha', []);
  const sameLocal = snapshotFromLocalContent('TODO Alpha', []);
  const sameRemote = snapshotFromRemoteTask({
    id: 't1',
    projectId: 'p1',
    title: 'Alpha',
    status: 0,
    priority: 0,
    items: [],
  });

  assert.equal(classifySyncState(baseline, sameLocal, sameRemote), 'unchanged');

  const localTitleChanged = snapshotFromLocalContent('TODO Alpha local', []);
  assert.equal(classifySyncState(baseline, localTitleChanged, sameRemote), 'keep-local');

  const remoteTitleChanged = snapshotFromRemoteTask({
    id: 't1',
    projectId: 'p1',
    title: 'Alpha remote',
    status: 0,
    priority: 0,
    items: [],
  });
  assert.equal(classifySyncState(baseline, sameLocal, remoteTitleChanged), 'pull-remote');
  assert.equal(classifySyncState(baseline, localTitleChanged, remoteTitleChanged), 'conflict');

  const convergedLocal = snapshotFromLocalContent('DONE Alpha final', []);
  const convergedRemote = snapshotFromRemoteTask({
    id: 't1',
    projectId: 'p1',
    title: 'Alpha final',
    status: 1,
    priority: 0,
    items: [],
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

  const remoteChecklistAdded = snapshotFromRemoteTask({
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
    classifySyncState(checklistBaseline, checklistBaseline, remoteChecklistAdded),
    'pull-remote',
  );
  assert.equal(
    classifySyncState(checklistBaseline, localChecklistChanged, remoteChecklistAdded),
    'conflict',
  );

  const legacyBaseline = JSON.stringify({
    title: 'Legacy',
    completed: false,
    priority: 0,
    startDate: null,
    dueDate: null,
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
  console.log('Sync-state regression tests passed.');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
