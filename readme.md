# Logseq Dida365 / TickTick Sync

A Logseq plugin for linking Logseq task blocks with Dida365 or TickTick tasks. Dida365 is the default backend.

This is an unofficial community plugin and is not affiliated with Dida365 or TickTick.

## Current capabilities

- Create a Dida365/TickTick task from a Logseq task block.
- Link an existing remote task to an existing Logseq block.
- Keep one canonical Logseq block for each linked remote task.
- Synchronize task title, priority, scheduled/start date, deadline/due date, and completion state.
- Synchronize first-level checklist items from direct child task blocks.
- Import unlinked open Dida365 tasks into `[[Dida Inbox]]` while Logseq is running.
- Automatically reconcile linked tasks with a saved last-sync baseline.
- Detect two-sided edits and destructive/ambiguous checklist changes instead of silently overwriting data.
- Keep the Logseq block and detach the link if the remote task was deleted.

## Task model

A typical linked task looks like this:

```markdown
TODO Prepare detector analysis [#A]
SCHEDULED: <2026-09-10 Thu>
DEADLINE: <2026-09-12 Sat>
  TODO Re-run calibration
  DONE Export figures
  Notes and ordinary child blocks are not checklist items.
```

Only **direct child blocks with a task marker** are synchronized as Dida checklist items. Supported markers are:

- `TODO`
- `DONE`
- `DOING`
- `NOW`
- `LATER`
- `WAITING`

Ordinary child blocks are left entirely in Logseq.

## Installation

### Packaged build

Download the ZIP artifact produced by the `Package Plugin` GitHub Actions workflow, unzip it, then in Logseq Desktop:

1. Enable **Developer mode** in Logseq settings.
2. Open the Plugins dashboard.
3. Choose **Load unpacked plugin**.
4. Select the extracted `logseq-ticktick-plugin` directory.

### Development build

```bash
pnpm install --frozen-lockfile
pnpm build
```

Then load the repository directory as an unpacked Logseq plugin.

## Configuration

Open the plugin settings in Logseq and configure:

- **Task Service**: `dida` or `ticktick`.
- **Access Token**: the access token for the selected service.
- **Auto Sync Dida**: automatically reconcile linked tasks and refresh `[[Dida Inbox]]` while Logseq is running.

Do not commit access tokens to this repository.

## Commands

The plugin registers these slash commands:

- `/Dida Create / Sync` — create a remote task or push changes to an already linked task.
- `/Dida Pull Remote` — safely pull the linked remote task. Unsynchronized local changes or structural checklist conflicts block the pull before any local fields are overwritten.
- `/Dida Pull All Linked` — safely pull remote-only changes for all linked tasks; local-only changes are kept local and true conflicts are marked.
- `/Dida Link Existing` — search open remote tasks and link one to the current block.
- `/Dida Unlink` — remove only the relationship; the remote task is kept.
- `/Dida Refresh Inbox` — refresh `[[Dida Inbox]]`.
- `/Dida Resolve Conflict - Keep Logseq` — explicitly choose the Logseq state after a conflict.
- `/Dida Resolve Conflict - Use Dida` — explicitly choose the remote state after a conflict.
- `/TT` — legacy alias for create/sync.

## Conflict and deletion safety

The plugin stores a last-synchronized snapshot for each linked task. If only one side changes, that side can normally be propagated automatically. If both sides change, the block is marked with a sync conflict and neither side is silently selected.

Pulling is two-phase: the plugin first classifies the current local, baseline, and remote states and plans checklist changes. Local blocks are modified only after the plan is considered safe. This prevents a remote parent-title change from being applied before a destructive checklist conflict is discovered.

Checklist synchronization is deliberately conservative because Dida365 regenerates checklist item IDs when a parent task is updated. The plugin therefore treats checklist state as an ordered snapshot rather than relying on item IDs.

Automatic synchronization and normal pulls will not silently perform ambiguous or destructive checklist operations such as:

- deleting remote checklist items because a Logseq child disappeared;
- deleting Logseq child blocks because remote checklist items disappeared;
- interpreting checklist reorder or middle insertion as an identity-preserving edit.

If you explicitly choose **Use Dida** for a structural checklist conflict, existing Logseq checklist blocks are not deleted. Their task markers are removed so they become ordinary Logseq context and retain their text and nested notes; the authoritative remote checklist is then added as fresh task blocks.

## Known API limitation

The Dida365 Open API does not reliably reopen an already completed task by updating it back to an open status. If a remote task has already been completed and you want to reopen it, reopen it in Dida365 first and then continue synchronization.

The API also exposes `modifiedTime`, but real integration tests found that it does not reliably change after task edits, so the plugin does not use it for last-write-wins conflict resolution.

## Automated validation

GitHub Actions currently checks:

- Reproducible dependency installation using the committed pnpm lockfile.
- TypeScript/Vite production build.
- Pure synchronization-state regression tests.
- Checklist apply-planner tests for positional edits, append, deletion, reorder, and middle insertion.
- Real Dida365 API authentication and task lifecycle tests using a repository secret.
- Date, completion, reopen, timestamp, and checklist behavior probes.
- Final plugin ZIP structure, manifest entry point, bundled assets, and critical slash commands.

The remaining validation gap is a true desktop Logseq UI smoke test. Logseq's supported unpacked-plugin flow currently requires Developer mode and an interactive file picker, so CI intentionally does not pretend that a brittle mouse-coordinate automation is a stable test interface.
