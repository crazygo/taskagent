# Rebuild Multi-Agent Communication (Quick Dev Flow Demo)

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
