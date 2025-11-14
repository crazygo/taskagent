# Rebuild Multi-Agent Communication (Quick Dev Flow Demo)

## Requirement (2025-11-14T16:13:10.912Z)
- The Feature-Plan stage MUST support interrupt/abort when it detects conflicts with existing requirements.
- On interrupt, the sequential pipeline MUST short-circuit and emit a structured failure payload (e.g., { ok: false, code: 'CONFLICT', message, details }) or a controlled abort that the orchestrator maps to a failure, preventing downstream stages (feature-edit, YAML validator, report).

- Task ID: 20251114-2255-rebuild-multi-agent-comm-demo
- Goal: Rebuild/streamline multi-agent communication (DevHub ↔ LoopAgent/SequentialAgent) for a quick development flow demo.
- Notes:
  - Focus on task-id centric collaboration across agents
  - Keep CLI UX stable; prefer npx usage
  - Prepare minimal demo path via DevHub + Blueprint + Coder/Review

## Additional Notes (2025-11-14T15:00:15.263Z)
- Atomic agent types: Prompt Agent and Programming Agent
- Prompt Agent is prompt-driven, focusing on a specific task type's working method
- Programming Agent can have multiple nodes; nodes are connected via program logic, and can be defined so each node can be emitted independently

## Design Target & Use Case (2025-11-14T15:08:00.563Z)
- Agent design is centered on artifacts + working method, not just raw prompts.
- Use Case: feature-updater agent
  - Goal: After edits, ensure features.yaml remains well-structured.
  - Validate: No duplicate or conflicting feature entries (避免重复/冲突).
  - Problem with pure Prompt Agent: LLM can introduce subtle structural mistakes that propagate downstream.
  - Decision: Use Programming Agent architecture (multi-node, logic-enforced) to guarantee deterministic validation & merge rules before committing updates.
- Rationale: Programming Agent nodes can emit structured events (parse, diff, validate, normalize) ensuring post-edit artifact integrity and reducing cascading errors in later workflow stages.

## Code Review By Features Agent (2025-11-14T15:40:26.943Z)
- Purpose: Verify whether new code changes (commit diffs) risk breaking previously implemented features.
- Context: When adding new features quickly, we validate the new one but often skip deep regression of old ones.
- Approach: Iterate existing features (from features.yaml or feature artifacts) and cross-check each feature's logic paths against changed code segments.
- Detection: Identify overlaps (cross points) where modified functions, modules, or data contracts intersect a feature's required invariants.
- Output: Structured report listing per-feature risk status, with:
  - feature_id / name
  - risk_level (none/low/medium/high)
  - impacted elements (files, functions, lines)
  - rationale (what change introduces the potential break)
- Architecture Choice: Programming Agent (multi-node) for deterministic traversal: nodes = [collect_diff, enumerate_features, map_dependencies, detect_cross, score_risk, generate_report].
- Benefit: Early surfacing of silent regressions without full test suite expansion.

## Planned Upgrade: Feature-Updater Sequential Agent (2025-11-14T15:59:12.767Z)
- Goal: Upgrade to feature-updater with a sequential architecture; rename feature-writer to feature-edit.
- Composition:
  - Feature-Plan (Prompt Agent; new agent)
  - Loop (LoopAgent; current: blueprint loop)
    - Stage: feature-edit (Prompt Agent; renamed from feature-writer; supports add/delete/change) → YAML validator
  - Feature-Changes Review (Prompt Agent) to check and produce a report
- Pipeline: feature-plan → loop(feature-edit → yaml validator) → feature-changes report.
- Rationale: Combine prompt-driven ideation with programmatic validation to reduce LLM-induced structural errors while producing a final human-readable risk/change report.

> 2025-11-14T16:00:41.950Z: Note — feature-edit is a Prompt Agent.
