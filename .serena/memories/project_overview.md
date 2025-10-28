# TaskAgent Overview
- Terminal-based AI assistant built with React + Ink (TypeScript) providing an interactive CLI for multi-agent workflows.
- Single-file entry `ui.tsx` orchestrates message streaming, task tabs, and Claude Agent SDK integration.
- Supporting modules under `src/` cover components, domain stores, hooks, drivers, and agent runtime utilities.
- Primary goal: manage AI-assisted coding/tasks with streaming Claude responses, tool permissions, and session persistence.