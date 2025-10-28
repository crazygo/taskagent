# Code Structure
- `ui.tsx` — main Ink app: renders ChatPanel/InputBar, manages tabs, sessions, permissions, and agent streaming.
- `src/agent/` — agent runtime utilities and flow definitions (e.g., `runtime/runClaudeStream.ts`, `flows/baseClaudeFlow.ts`).
- `src/components/` — Ink UI components (ChatPanel, StatusControls, TaskSpecificView, InputBar).
- `src/domain/` — state stores for tasks and conversations.
- `src/hooks/` — reusable streaming/message hooks.
- `src/drivers/` — specialized agent graphs (e.g., Plan-Review-Do flow config).
- `task-manager.ts` — orchestrates queued tasks and integrates with Claude Agent SDK.
- `src/logger.ts` / `debug.log` — runtime logging utilities.