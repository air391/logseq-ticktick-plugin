# API compatibility

The plugin supports both Dida365 and TickTick through the same task client abstraction.

| Service | API base | OAuth token endpoint | Web app |
| --- | --- | --- | --- |
| Dida365 | `https://api.dida365.com/open/v1` | `https://dida365.com/oauth/token` | `https://dida365.com/webapp` |
| TickTick | `https://api.ticktick.com/open/v1` | `https://ticktick.com/oauth/token` | `https://ticktick.com/webapp` |

The real Dida API smoke test validates project listing and task CRUD using the repository secret. It also validates the request shape currently emitted by the Logseq command when creating a task without an explicit project ID.

## Dida task date semantics

Dida's OpenAPI task representation does **not** expose `startDate` and `dueDate` as two independently reliable task timestamps. Real API probes created isolated tasks with several request shapes and immediately read them back:

- sending only `startDate` makes both returned `startDate` and `dueDate` equal that value;
- sending only `dueDate` makes both returned fields equal that value;
- sending different `startDate` and `dueDate` values makes the returned fields both equal `dueDate`;
- sending `startDate` plus `endDate` leaves `endDate` absent and makes both returned date fields equal `startDate`;
- explicitly setting `timeZone` does not change this normalization;
- the same collapse happens for all-day tasks;
- updating an existing dated task with both `startDate: null` and `dueDate: null` succeeds and clears the remote date.

The plugin therefore treats the Dida OpenAPI task date as **one canonical remote date/time**. Its Logseq mapping is intentionally narrower than the Dida desktop/web UI model:

- Logseq `DEADLINE` is the remote-managed date and maps to the Dida canonical task date.
- Logseq `SCHEDULED` is local planning metadata. It is preserved during remote pulls and does not participate in Dida conflict detection.
- when reading a remote task, `dueDate` is preferred and `startDate` is accepted as a compatibility fallback.
- when updating a task after the Logseq `DEADLINE` was removed, both remote date fields are explicitly sent as `null`, preventing a stale Dida reminder from surviving locally deleted deadline metadata.

This is deliberate data-loss prevention: mapping `SCHEDULED` and `DEADLINE` to two Dida OpenAPI fields would appear to work at request time but Dida normalizes them back to one timestamp.

## Dida system Inbox

Dida's system Inbox is an OpenAPI special case. A task created without `projectId` is assigned a concrete project ID such as `inbox1028940311`, but that system project is **not returned by** `GET /project`.

Real API probes confirm all of the following:

- `GET /project/inbox/data` succeeds and lists system Inbox tasks.
- `GET /project/<returned-inbox-id>/data` also succeeds and lists those tasks.
- `GET /project/<returned-inbox-id>/task/<task-id>` can directly read a known Inbox task.
- the system Inbox project itself is absent from the ordinary `/project` collection.

For Dida365, open-task enumeration therefore combines ordinary project-data responses with one extra `GET /project/inbox/data` request and de-duplicates tasks by task ID. This is required for `Dida Link Existing` and the plugin's `[[Dida Inbox]]` projection to include tasks that live in Dida's own system Inbox.

TickTick does not use this Dida-specific extra enumeration path.

## Logseq graph compatibility

The current supported runtime target is a traditional **File Graph** (Markdown/Org graph).

Logseq DB Graph uses a different data model for block text, task status, priority, scheduled/deadline values, and property queries. The plugin now has a graph-aware property-query layer: File Graph queries use `:block/properties`, while DB Graph property lookup resolves the actual plugin property ident through `Editor.getProperty()` before querying. This prevents the binding/index layer from hard-coding a DB property namespace.

That query work is only groundwork, not a claim of complete DB Graph support. The task synchronization layer still models Logseq tasks from File Graph text such as `TODO`, `[#A]`, `SCHEDULED`, and `DEADLINE`, and still reads the legacy block `content` field in several runtime paths. DB Graph uses first-class task/property data and `title` instead of the same File Graph representation.

The runtime therefore detects a DB Graph at startup, displays a warning, and does not start synchronization hooks or polling. Until the task/content adapters are implemented and tested against a real DB Graph, DB Graph synchronization is unsupported rather than partially enabled.
