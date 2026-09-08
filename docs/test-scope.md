# Manual smoke test scope

Human testing should be limited to behavior that GitHub Actions cannot reliably validate in the real Logseq desktop UI.

## Manual checks

- The unpacked plugin loads successfully.
- The settings page renders the Dida/TickTick service selector and access-token field.
- The `TT` slash command is discoverable.
- Running `TT` on a TODO block produces the expected linked task representation.
- Error and success messages are understandable and visually acceptable.

## Automated checks

- Plugin TypeScript/Vite build.
- Real Dida token authentication.
- Project listing.
- Task create/read/update/complete/delete.
- Plugin-shaped task creation without an explicit project ID.
- Packaging an installable plugin ZIP artifact.

The goal is to avoid using manual UI testing as a substitute for API or build validation.
