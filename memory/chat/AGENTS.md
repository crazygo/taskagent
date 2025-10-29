---

# Chat Memory Agent (Leaf)

This page defines the detailed generation logic for Chat-derived memories.

## Goal
Extract structured memories from conversations and store them as JSONL lines.

## Memory Types
- event: Time-bound occurrences with context (who/when/where/what)
- fact: Stable preferences, rules, configurations
- skill: Procedures, workflows, executable steps

## Output Format
- File path: `memory/chat/{YYYY-MM-DD-HH-mm-ss}-{topic}.jsonl`
- Each memory item is one JSON line with fields:
  - type: "event" | "fact" | "skill"
  - content: string
  - metadata: object (e.g., { confidence: number, tags: string[], source: "conversation" })
  - timestamp: ISO8601 string

Example line:
```json
{"type":"fact","content":"User prefers quick non-interactive checks via yarn start:test","metadata":{"confidence":0.9,"tags":["workflow"],"source":"conversation"},"timestamp":"2025-10-29T10:00:00Z"}
```

## Quality Bar
- Deduplicate semantically equivalent items
- Keep items granular and actionable
- Include useful tags for retrieval

## Do / Don’t
- Do: Write only to `memory/chat/` with JSONL
- Don’t: Write MCP named memories here (those are managed via tools)


