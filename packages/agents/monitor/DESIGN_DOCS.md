# Technical Design Documentation

This directory's technical design documentation has been moved to the project-level docs directory for better discoverability.

## Design Documents

Please refer to:
- **[/docs/design/monitor_mediator_looper.md](../../../docs/design/monitor_mediator_looper.md)** - Main technical implementation design
- **[/docs/design/README.md](../../../docs/design/README.md)** - Design directory overview

## Local Documentation

This directory (`packages/agents/monitor/`) contains:
- **TODO.md** - Implementation checklist and detailed decisions
- **features/** - Feature specifications
- Implementation files (index.ts, coder/, review/)

## Why the Move?

The technical design documents describe a system-wide architecture (Mediator, Looper, JUDGE, EventBus) that spans multiple agent directories. Keeping them at the project root makes them easier to find for all developers.
