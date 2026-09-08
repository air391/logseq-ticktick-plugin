# API compatibility

The plugin supports both Dida365 and TickTick through the same task client abstraction.

| Service | API base | OAuth token endpoint | Web app |
| --- | --- | --- | --- |
| Dida365 | `https://api.dida365.com/open/v1` | `https://dida365.com/oauth/token` | `https://dida365.com/webapp` |
| TickTick | `https://api.ticktick.com/open/v1` | `https://ticktick.com/oauth/token` | `https://ticktick.com/webapp` |

The real Dida API smoke test validates project listing and task CRUD using the repository secret. It also validates the request shape currently emitted by the Logseq command when creating a task without an explicit project ID.

## Logseq graph compatibility

The current supported runtime target is a traditional **File Graph** (Markdown/Org graph).

Logseq DB Graph uses a different data model for block text, task status, priority, scheduled/deadline values, and property queries. The plugin now has a graph-aware property-query layer: File Graph queries use `:block/properties`, while DB Graph property lookup resolves the actual plugin property ident through `Editor.getProperty()` before querying. This prevents the binding/index layer from hard-coding a DB property namespace.

That query work is only groundwork, not a claim of complete DB Graph support. The task synchronization layer still models Logseq tasks from File Graph text such as `TODO`, `[#A]`, `SCHEDULED`, and `DEADLINE`, and still reads the legacy block `content` field in several runtime paths. DB Graph uses first-class task/property data and `title` instead of the same File Graph representation.

Until those task/content adapters are implemented and tested against a real DB Graph, treat DB Graph support as **not supported / experimental**. Do not rely on the plugin for production synchronization in a DB Graph yet.
