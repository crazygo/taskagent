# Coding Style & Conventions
- Language: TypeScript (ESM, strict), React functional components with Ink for TUI rendering.
- Messages split between `activeMessages` and `frozenMessages`; finalize messages immediately after completion.
- Use functional `setState` updates and avoid sharing mutable closures across async updates.
- Assistant reasoning shown via `message.reasoning`; maintain ASCII-safe output and minimal terminal re-renders.
- Errors: show concise boxed system message, log full stack/details to `debug.log`.
- Permissions: queue requests, show approval status, and freeze the resulting system message.
- Follow existing component/layout patterns in `src/components` and streaming hooks; prefer incremental updates over bulk rewrites.