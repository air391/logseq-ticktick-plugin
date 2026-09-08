import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const tempDir = mkdtempSync(join(tmpdir(), 'logseq-dida-enumeration-test-'));

try {
  execFileSync(
    'pnpm',
    [
      'exec',
      'tsc',
      'src/ticktick/ticktick.ts',
      'src/ticktick/task.ts',
      '--target',
      'ES2020',
      '--module',
      'commonjs',
      '--moduleResolution',
      'node',
      '--lib',
      'ES2020,DOM',
      '--skipLibCheck',
      '--outDir',
      tempDir,
    ],
    { stdio: 'inherit' },
  );

  const require = createRequire(import.meta.url);
  const directPath = join(tempDir, 'ticktick', 'ticktick.js');
  const flatPath = join(tempDir, 'ticktick.js');
  const compiledPath = existsSync(directPath) ? directPath : flatPath;
  const TickTick = require(compiledPath).default;

  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);

    if (url === 'https://api.dida365.com/open/v1/project') {
      return Response.json([{ id: 'project-1', name: 'Research' }]);
    }
    if (url === 'https://api.dida365.com/open/v1/project/project-1/data') {
      return Response.json({
        project: { id: 'project-1', name: 'Research' },
        tasks: [
          { id: 'regular-open', projectId: 'project-1', title: 'Regular open', status: 0 },
          { id: 'regular-done', projectId: 'project-1', title: 'Regular done', status: 1 },
        ],
      });
    }
    if (url === 'https://api.dida365.com/open/v1/project/inbox/data') {
      return Response.json({
        project: { id: 'inbox-test', name: 'Inbox' },
        tasks: [
          { id: 'inbox-open', projectId: 'inbox-test', title: 'Inbox open', status: 0 },
          { id: 'regular-open', projectId: 'project-1', title: 'Duplicate regular task', status: 0 },
        ],
      });
    }

    if (url === 'https://api.ticktick.com/open/v1/project') {
      return Response.json([{ id: 'tick-project', name: 'Tick project' }]);
    }
    if (url === 'https://api.ticktick.com/open/v1/project/tick-project/data') {
      return Response.json({
        project: { id: 'tick-project', name: 'Tick project' },
        tasks: [{ id: 'tick-open', projectId: 'tick-project', title: 'Tick open', status: 0 }],
      });
    }

    return new Response('not found', { status: 404 });
  };

  const dida = new TickTick('token', 'dida');
  const didaTasks = await dida.getOpenTasks();
  assert.deepEqual(
    didaTasks.map(({ task }) => task.id).sort(),
    ['inbox-open', 'regular-open'],
  );
  assert.equal(
    calls.filter((url) => url === 'https://api.dida365.com/open/v1/project/inbox/data').length,
    1,
  );

  calls.length = 0;
  const ticktick = new TickTick('token', 'ticktick');
  const tickTasks = await ticktick.getOpenTasks();
  assert.deepEqual(tickTasks.map(({ task }) => task.id), ['tick-open']);
  assert.equal(calls.some((url) => url.endsWith('/project/inbox/data')), false);

  console.log('Task enumeration regression tests passed.');
  globalThis.fetch = originalFetch;
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
