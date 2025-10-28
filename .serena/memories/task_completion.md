# Task Completion Checklist
- Ensure new code aligns with streaming/message management patterns described in `src/AGENTS.md`.
- Run `yarn start:test` for a quick smoke test (expect raw-mode warning in CI-like environments).
- Run `yarn tsc --noEmit` to catch type errors before committing.
- Review changes with `git diff` and ensure assistant/system messages finalize properly.
- Update relevant documentation or logs if new flows or commands are introduced.