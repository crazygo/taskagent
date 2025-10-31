# Development Philosophy

## Core Principles

### Root Cause Analysis
**Critical**: The user strongly prefers finding and fixing root causes rather than applying superficial fixes ("garbage code"). When debugging or implementing features:
- Investigate underlying issues thoroughly
- Understand the system behavior before making changes
- Avoid quick patches that don't address the fundamental problem
- Take time to understand architectural patterns and constraints

### Code Quality Standards
- Follow existing conventions strictly (documented in `AGENTS.md`, `CLAUDE.md`)
- Maintain TypeScript strict mode compliance
- Prefer functional programming patterns with React hooks
- Use proper type safety throughout the codebase

### Communication Approach
- Use ASCII art and user stories where appropriate for complex features
- Keep the user informed of plans and progress
- Explain reasoning behind architectural decisions
- Document important patterns and conventions