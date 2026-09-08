import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const tempDir = mkdtempSync(join(tmpdir(), 'logseq-task-state-test-'));

try {
  execFileSync(
    'pnpm',
    [
      'exec',
      'tsc',
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
  const directPath = join(tempDir, 'task-state.js');
  const nestedPath = join(tempDir, 'src', 'task-state.js');
  const compiledPath = existsSync(directPath) ? directPath : nestedPath;
  const {
    localStateToRemoteTask,
    parseLocalTaskState,
    remoteTaskToBlockContent,
  } = require(compiledPath);

  const mixed = parseLocalTaskState([
    'TODO Mixed date task',
    'SCHEDULED: <2026-09-10 Thu>',
    'DEADLINE: <2026-09-10 Thu 18:30>',
  ].join('\n'));
  const mixedRemote = localStateToRemoteTask(mixed);
  assert.equal(mixedRemote.isAllDay, false);
  assert.ok(mixedRemote.startDate);
  assert.ok(mixedRemote.dueDate);
  assert.equal(new Date(mixedRemote.dueDate).getHours(), 18);
  assert.equal(new Date(mixedRemote.dueDate).getMinutes(), 30);

  const withoutWeekday = parseLocalTaskState([
    'TODO Handwritten time',
    'DEADLINE: <2026-09-10 07:45>',
  ].join('\n'));
  const handwrittenRemote = localStateToRemoteTask(withoutWeekday);
  assert.equal(handwrittenRemote.isAllDay, false);
  assert.equal(new Date(handwrittenRemote.dueDate).getHours(), 7);
  assert.equal(new Date(handwrittenRemote.dueDate).getMinutes(), 45);

  const allDay = parseLocalTaskState([
    'TODO All-day task',
    'SCHEDULED: <2026-09-10 Thu>',
    'DEADLINE: <2026-09-12 Sat>',
  ].join('\n'));
  assert.equal(localStateToRemoteTask(allDay).isAllDay, true);

  const body = remoteTaskToBlockContent({
    id: 'task-1',
    projectId: 'project-1',
    title: 'Pulled task',
    status: 0,
    priority: 3,
    isAllDay: false,
    startDate: new Date(2026, 8, 10, 9, 15).toISOString(),
    dueDate: new Date(2026, 8, 10, 18, 30).toISOString(),
  }, 'TODO Old title\nLocal note that must stay');
  assert.match(body, /^TODO \[#B\] Pulled task/m);
  assert.match(body, /Local note that must stay/);
  assert.match(body, /SCHEDULED: <2026-09-10 Thu 09:15>/);
  assert.match(body, /DEADLINE: <2026-09-10 Thu 18:30>/);

  console.log('Task-state date conversion regression tests passed.');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
