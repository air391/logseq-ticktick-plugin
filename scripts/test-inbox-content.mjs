import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const tempDir = mkdtempSync(join(tmpdir(), 'logseq-dida-inbox-test-'));

try {
  execFileSync(
    'pnpm',
    [
      'exec',
      'tsc',
      'src/dida-inbox.ts',
      'src/property-query.ts',
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
  const directPath = join(tempDir, 'dida-inbox.js');
  const nestedPath = join(tempDir, 'src', 'dida-inbox.js');
  const compiledPath = existsSync(directPath) ? directPath : nestedPath;
  const { projectionVisibleContent } = require(compiledPath);

  const managed = [
    'TODO Test task',
    'dida-inbox-task-id:: task-1',
    'dida-inbox-project-id:: project-1',
    'dida-inbox-project-name:: Inbox',
    'dida-inbox-task-url:: https://dida365.com/webapp/#p/project-1/tasks/task-1',
    'dida-inbox-managed-content:: TODO Test task',
  ].join('\n');
  assert.equal(projectionVisibleContent(managed), 'TODO Test task');

  const indentedProperties = [
    'TODO Test task',
    '  dida-inbox-task-id:: task-1',
    '  dida-inbox-managed-content:: TODO Test task',
  ].join('\n');
  assert.equal(projectionVisibleContent(indentedProperties), 'TODO Test task');

  const editedBody = [
    managed,
    'Local note that must survive retirement.',
  ].join('\n');
  assert.equal(
    projectionVisibleContent(editedBody),
    'TODO Test task\nLocal note that must survive retirement.',
  );

  const unrelatedProperty = [
    managed,
    'owner:: researcher',
  ].join('\n');
  assert.equal(
    projectionVisibleContent(unrelatedProperty),
    'TODO Test task\nowner:: researcher',
  );

  console.log('Dida Inbox content-safety regression tests passed.');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
