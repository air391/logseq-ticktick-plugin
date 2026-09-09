# Changelog

All notable changes to this fork are documented in this file.

## Unreleased

### Added
- Dida365 as a first-class task backend alongside TickTick.
- Bidirectional task synchronization with persisted block/task mappings and sync baselines.
- Searchable existing-task picker and `[[Dida Inbox]]` projection for unlinked Dida tasks.
- Automatic local push with debounce and remote polling/reconciliation.
- Explicit conflict-resolution commands for local-wins and remote-wins workflows.
- First-level Logseq task children mapped to Dida checklist items with conflict-safe structural handling.
- Real Dida API smoke tests, date-capability probes, pure sync/date/inbox regression tests, and packaged ZIP contract checks.

### Changed
- Dida system Inbox tasks are enumerated through `/project/inbox/data` in addition to ordinary `/project` project-data traversal.
- Date synchronization now uses one canonical remote task date: Logseq `DEADLINE` is synchronized, while `SCHEDULED` remains local-only planning metadata. This follows real Dida OpenAPI behavior, which normalizes `startDate` and `dueDate` to a single timestamp.
- Removing a Logseq `DEADLINE` explicitly clears both Dida date fields so stale remote reminders do not survive.
- Remote pulls preserve local `SCHEDULED` lines and ordinary block body content.
- DB Graph synchronization is explicitly disabled at runtime until the separate DB task/content model is implemented; File Graph is the supported target.
- Plugin lifecycle cleanup now unregisters settings/database hooks and clears polling/debounce/suppression state on unload.
- Switching the configured task backend no longer silently rebinds an already-linked block to another service; explicit unlinking is required first.

### Safety
- Inbox projection blocks are deleted automatically only when they are provably untouched and childless. Edited, annotated, or legacy projections are retired without deleting user content.
- Remote checklist deletion, reorder, or middle insertion is blocked unless the user explicitly chooses a conflict resolution path.
- Existing Logseq checklist blocks are preserved as ordinary context when destructive remote structure is explicitly accepted.
- Remote task deletion keeps the Logseq block and removes only the mapping.
- Completed Dida tasks are not automatically treated as reopenable because real API tests show `status: 0` can leave completion metadata behind.

## 1.1.2

- Original upstream release history is preserved by Git history. This fork's Dida365 synchronization work is tracked under `Unreleased` above.
