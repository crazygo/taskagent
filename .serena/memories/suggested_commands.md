# Suggested Commands
- `yarn install` — install dependencies (Yarn Berry PnP).
- `yarn start` — launch the interactive TaskAgent CLI (long-running).
- `yarn start:test` — 5-second smoke test for startup/rendering (uses concurrently to auto-exit).
- `tsx ui.tsx -- <args>` — run the CLI entry directly for custom invocation.
- `yarn tsc --noEmit` — type-check the TypeScript codebase.
- `tail -f debug.log` — follow runtime diagnostics logged by the agent.
- Standard tooling: `git status`, `git diff`, `rg <pattern>`, `ls`, `sed`, `cat` for navigation and inspection.