# Dida integration development notes

## Current validation

- Dida access token is stored in the `DIDA_ACCESS_TOKEN` GitHub Actions secret.
- Real Dida API CRUD is exercised in `.github/workflows/dida-api-smoke.yml`.
- The smoke test creates, reads, updates, completes, and deletes a temporary task.
- A plugin-shaped `POST /open/v1/task` request without `projectId` is also tested against the real Dida API and is currently accepted.
- The plugin build is verified in `.github/workflows/ci.yml`.

## Current implementation

- `TaskService` supports `dida` and `ticktick`.
- Dida uses `https://api.dida365.com/open/v1`.
- TickTick uses `https://api.ticktick.com/open/v1`.
- The shared client supports project listing and task create/read/update/complete/delete operations.
- The Logseq setting defaults to Dida while preserving TickTick as an option.

## Known repository issue

The existing `package.json` and `pnpm-lock.yaml` were already out of sync before this work. CI therefore installs with `pnpm install --no-frozen-lockfile` for build verification. Dependency cleanup should be handled separately from Dida feature work.

## Next development steps

1. Add stable Logseq block-to-task identity mapping.
2. Add synchronization state and conflict handling.
3. Add task completion propagation in both directions.
4. Add automated tests for mapping and synchronization logic.
5. Produce an installable CI artifact for final Logseq UI smoke testing.
