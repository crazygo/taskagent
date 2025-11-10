# Upgrade Story Agent to Graph-Based Architecture – L1 Plan

## 1. Current State
- Story Agent is a linear stack-agent coordinating mainly with `story_builder`, producing story markdown in one pass after dialogue.
- DevHub branch already implements a graph/Looper workflow with orchestrated sub-agents (coder, reviewer, monitor) and automated diff/review behaviors.
- Task Manager and agent SDK expect agents to expose standardized multi-step workflows; Story currently falls short, limiting reuse and automation (no built-in diff, review, or commit steps).

## 2. Requirements
- Preserve Story’s outward identity/purpose while adopting an internal multi-step (update → diff → review → commit) workflow.
- Provide automatic diff visibility, quality review, and repository commit once updates are approved.
- Summarize results to the user after the workflow completes, capturing key changes and commit confirmation.
- Conform to unified agent/task-manager architecture (PromptAgent/StackAgent definitions, background task support, standard tool invocation tags).
- Respect existing approval/confirmation flow for selecting target story files and supporting both conversational and direct file-update modes.

## 3. Research & Constraints
- Need to inventory available sub-agents/tools: `story_builder` for file writes, existing git diff tooling (used by Reviewer/DevHub), reviewer prompts that can be adapted for story quality, and any commit helpers.
- Automating commits must align with repository policies (ensuring clean working tree, handling failure states, respecting user approval before writing).
- Conversation-first workflows must still allow Q&A before entering the multi-step pipeline; file path confirmation remains mandatory per current UX guidance.
- Graph workflow must remain modular so Story can later merge into DevHub without bespoke code paths.

## 4. Solution Directions (L1)
1. **Sequential Stack Pipeline** – Wrap the current Story coordinator in a fixed StackAgent sequence (Update → Diff → Review → Commit) using existing tools; fastest path but rigid for future loops.
2. **Looper-Style Graph** – Replicate DevHub’s Looper graph structure for Story, enabling conditional branches (e.g., review retry), while keeping Story-specific prompts/content.
3. **Toolbox Invocation** – Keep Story as a coordinator that can invoke diff/review/commit tools on demand rather than a predetermined pipeline, trading determinism for flexibility.
