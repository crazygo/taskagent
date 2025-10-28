# Story Driver Workflow

The Story driver turns a stakeholder prompt into a structured, dependency‑aware story document through a three‑node Claude Agent graph. It streams every delta into the UI so tool activity and text stay in chronological order.

## Node Overview
- **@structurer** – Rewrites the raw input into literal Stories + AC without adding scope. Output: `<stories>` XML block.
- **@reviewer** – Audits coverage, listing mandatory gaps with `<add>` blocks only when something is missing.
- **@organizer** – Merges baseline + additions, groups stories by dependency, and emits the final `<story-document>` with group metadata and dependency notes.

All agents run inside `runClaudeStream`, reusing the shared permission handler. Tool usage is disabled for now, so the flow is deterministic and self‑contained.

## UI Entry Points
- Switch to the **Story** tab and submit a prompt; the driver handles the rest.
- Or use the `/story <prompt>` command from any tab – it will auto‑switch, run the flow, and stream results.

System banners mark each checkpoint:
1. Structuring started → structured payload streamed.
2. Coverage review finished → gap analysis streamed.
3. Organizing completed → final grouped document (boxed message) plus detailed streaming transcript.

Errors are surfaced as boxed system messages while full context is logged to `debug.log`.
