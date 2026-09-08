# Testing matrix

| Area | Automated | Manual |
| --- | --- | --- |
| TypeScript/Vite build | Yes | No |
| Dida token authentication | Yes | No |
| Dida task CRUD | Yes | No |
| Create without project ID | Yes | No |
| Plugin packaging | Yes | No |
| Logseq settings rendering | No | Yes |
| Slash command discoverability | No | Yes |
| Desktop UI behavior | No | Yes |

The intended workflow is to keep API/build regressions in CI and reserve manual testing for the Logseq UI surface.
