# API compatibility

The plugin supports both Dida365 and TickTick through the same task client abstraction.

| Service | API base | OAuth token endpoint | Web app |
| --- | --- | --- | --- |
| Dida365 | `https://api.dida365.com/open/v1` | `https://dida365.com/oauth/token` | `https://dida365.com/webapp` |
| TickTick | `https://api.ticktick.com/open/v1` | `https://ticktick.com/oauth/token` | `https://ticktick.com/webapp` |

The real Dida API smoke test validates project listing and task CRUD using the repository secret. It also validates the request shape currently emitted by the Logseq command when creating a task without an explicit project ID.
