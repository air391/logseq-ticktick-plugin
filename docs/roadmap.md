# Synchronization roadmap

## Phase 1: Dida API compatibility

- Dual Dida/TickTick service configuration.
- Shared project/task API client.
- Real Dida API CI smoke testing.
- Installable CI artifact.

## Phase 2: Stable identity mapping

- Persist Dida/TickTick task ID and project ID on the Logseq block.
- Preserve the original block UUID as the Logseq-side identity.
- Avoid duplicate remote tasks when the same block is synchronized repeatedly.

## Phase 3: State synchronization

- Propagate TODO/DONE changes from Logseq to the remote task.
- Pull remote completion state back into Logseq.
- Synchronize title, priority, and dates.
- Define deterministic conflict rules and timestamps.

## Phase 4: UX and hardening

- Add explicit sync/status commands and useful error messages.
- Add automated mapping/state-machine tests.
- Keep real API regression tests in GitHub Actions.
- Limit final human testing to Logseq installation and UI behavior.
