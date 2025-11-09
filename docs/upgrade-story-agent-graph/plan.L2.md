# Upgrade Story Agent to Graph-Based Architecture – L2 Plan

## 1. Current State (Summary)
Story remains a mostly linear stack-agent anchored on `story_builder`, lacking automated diff/review/commit steps. Mediator already showcases the desired graph-based Looper workflow, fully integrated with the Task Manager and reviewer tooling.

## 2. Requirements Snapshot
Maintain Story’s user-facing role, but internally adopt a multi-step update → diff → review → commit flow with automatic summarization, alignment with the unified agent architecture, and preservation of conversational + file-update modes.

## 3. Research Highlights
- Reuse existing `story_builder`, reviewer logic, git-diff utilities, and any commit helpers from Mediator to avoid duplication.
- Ensure approval gates (file selection, write consent) remain explicit before automated stages run.
- Commit automation must handle dirty trees gracefully and surface failures back to Story for reporting.

## 4. Solution Directions (Recap)
1. Sequential Stack Pipeline (fast but rigid)
2. Looper-Style Graph (structured, future-proof)
3. Toolbox Invocation (flexible, less deterministic)

## 5. Design Proposal (L2)
**Recommended Direction:** Adopt the Looper-style graph orchestration (Direction 2).

**Rationale**
- Matches Mediator’s proven architecture, making long-term integration or merging straightforward.
- Provides built-in support for conditional flows (e.g., re-running Update if Review fails) without ad-hoc logic.
- Keeps Task Manager interactions uniform (agents array, session handling, tool telemetry).

**Key Decisions**
- Implement Story as a StackAgent/PromptAgent pair whose `agents` list includes Update, Diff, Review, and Commit sub-agents modeled after Mediator’s components.
- Extend `story_builder` (or successor) to emit structured outputs consumable by downstream sub-agents (e.g., metadata for diff context).
- Integrate git diff and reviewer tooling reused from Mediator, adapting reviewer criteria to Story-specific quality checks (format, acceptance criteria completeness).
- Invoke a commit tool as the final sub-agent, wrapping responses in `<tool_result>` tags so Story can acknowledge the commit in its summary.
- Enhance Story’s system prompt to require a closing summary referencing updates, diff findings, review verdicts, and commit details.

**Trade-Offs**
- Higher upfront effort versus a simple sequential wrapper, since it requires porting Looper scaffolding and ensuring Story’s prompts fit the graph model.
- Slightly more complex debugging/testing due to additional orchestration layers; mitigated by sharing Mediator’s utilities and test harnesses.
- Potential overkill for purely conversational sessions, but architecture allows early exit when no file update is requested.
