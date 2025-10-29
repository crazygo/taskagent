---

# Memory Agents Router

This is a routing-only index for Memory-related agents. Each level acts as a router. Only the final leaf pages describe detailed generation logic.

## Routes

- `/memory/chat` → Chat Memory Store (leaf)
  - Path: `memory/chat/AGENTS.md`
  - Purpose: Store conversation-derived structured memories as JSONL (events/facts/skills)

- `/memory/docs` → Docs Memory Store (leaf)
  - Path: `memory/docs/AGENTS.md`
  - Purpose: Store analysis/plan documents and document-derived structured memories


Notes:
- Do not write to the root `memory/` directory directly; choose `memory/chat/` or `memory/docs/` as appropriate.
