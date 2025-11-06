# Design Documents

This directory contains architectural design documents for the TaskAgent project.

## Core System Design

### Monitor/Mediator/Looper Architecture

- **[monitor_mediator_looper.md](./monitor_mediator_looper.md)** - Technical Implementation Design (Latest)
  - EventBus cross-tab messaging
  - Mediator Agent: Dialog router and task orchestrator
  - Looper Agent: Loop execution engine (Coder ↔ Review ↔ JUDGE)
  - JUDGE Agent: LLM-based decision node with structured output
  - CLI testing strategy

- **[sonnet_design_monitor_mediator_architecture.md](./sonnet_design_monitor_mediator_architecture.md)** - Initial Architecture Proposal
  - Original conceptual design
  - Historical reference

## Related Directories

- `/packages/agents/monitor/` - Current implementation base (to be refactored to mediator/)
- `/packages/agents/monitor/TODO.md` - Implementation checklist and detailed decisions
- `/docs/features/` - User-facing feature specifications
- `/packages/agents/coder/` - Coder Agent implementation
- `/packages/agents/review/` - Review Agent implementation

## Document Purpose

**monitor_mediator_looper.md** is the primary technical design document for developers. It includes:
- Current codebase analysis
- Integration points with existing systems
- ASCII diagrams for interfaces
- Implementation phases
- CLI testing commands
- Risk assessment

## For Developers

When implementing the Monitor/Mediator/Looper system:
1. Read `monitor_mediator_looper.md` for technical details
2. Check `packages/agents/monitor/TODO.md` for current status
3. Run CLI tests from the testing section
4. Follow the implementation phases (Phase 1 → 2 → 3)

## Naming Convention

**Why "Monitor/Mediator/Looper"?**
- **Monitor Tab**: User-facing tab name (UI concept)
- **Mediator Agent**: Backend agent handling Monitor Tab (implementation)
- **Looper Agent**: Independent execution engine (architecture component)

The documents use all three terms to maintain clarity at different abstraction levels.
