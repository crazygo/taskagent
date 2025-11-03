# Task Agent Architecture Implementation

**Date**: 2025-11-04  
**Branch**: feature/task-listener  
**Status**: ✅ Completed (Phase 0-4) + Console Cleanup

---

## 📋 User Story

**As a** developer working on taskagent  
**I want** a clean Agent-Task architecture with background task support  
**So that** I can run long-running monitoring tasks independently from chat tabs

---

## 🎯 Acceptance Criteria

### Scenario 1: Agent Type System

**Given** that we need to distinguish between different agent execution patterns  
**When** defining agent types  
**Then** the system should provide:
- `AtomicAgent`: Base abstract class with `getPrompt()`, `getTools()`, `getModel()`, `parseOutput()`
- `StackAgent`: Extended class supporting sub-agent orchestration
- `DefaultAtomicAgent`: Pass-through implementation for direct Chat/Agent tab usage

### Scenario 2: Background Task Execution

**Given** that users need long-running monitoring tasks  
**When** invoking `/bg:log-monitor <prompt>`  
**Then** the system should:
- Create a task with agent via `createTaskWithAgent()`
- Return an EventEmitter for event subscription
- Execute in background with session support
- Emit events ('event', 'completed', 'failed', 'cancelled') to source tab

### Scenario 3: LogMonitor Implementation

**Given** that we need to monitor debug.log for changes  
**When** LogMonitor agent executes  
**Then** it should:
- Read last 100 lines of debug.log every 30 seconds
- Parse output for `[EVENT:level] message` patterns
- Use tools: 'Read', 'Glob' (not 'ReadFile', 'FileSearch')
- Self-manage loop via prompt instructions

### Scenario 4: SDK Configuration

**Given** that Claude Code SDK requires specific options  
**When** configuring SDK for background tasks  
**Then** the options must include:
- `systemPrompt: { type: 'preset', preset: 'claude_code' }`
- `extraArgs: { 'session-id': uuid }` for new sessions
- `resume: sessionId` for initialized sessions
- `canUseTool: async () => undefined` for auto-approval
- **MUST NOT** include `allowedTools` or `permissionMode` (causes exit code 1)

### Scenario 5: Clean Terminal Output

**Given** that console.log clutters the Ink UI  
**When** cleaning up logging statements  
**Then** the system should:
- Remove all `console.log()` from implementation files (task-manager.ts, registry.ts)
- Preserve all `addLog()` calls for debug.log file logging
- Keep console.log only in CLI help and startup errors
- Result: Clean terminal UI + detailed file debugging

---

## 💡 Problems Solved

### Critical Bug: SDK Exit Code 1
**Problem**: Background tasks crashed with "Claude Code process exited with code 1"  
**Root Cause**: Adding `allowedTools` or `permissionMode` to SDK options conflicts with 'claude_code' preset  
**Solution**: Remove those options, keep only `canUseTool` callback matching Story/Agent flow

### Session Management Mismatch
**Problem**: Background tasks missing session context  
**Root Cause**: Driver handler not passing session from runtime context  
**Solution**: Added `requiresSession: true` to LOG_MONITOR driver, passed session via context

### Wrong Tool Names
**Problem**: LogMonitor using 'ReadFile', 'FileSearch' tool names  
**Root Cause**: Mismatched with Claude Code SDK expectations  
**Solution**: Changed to 'Read', 'Glob' matching SDK tool registry

### UI Clutter
**Problem**: Excessive console.log statements making terminal unreadable  
**Root Cause**: Debug logging mixed with UI code  
**Solution**: Separated concerns - console for essential UI, addLog() for debug.log file

---

## 📂 Files Created/Modified

### Created Files
1. **`src/agent/types.ts`** (156 lines)
   - `AtomicAgent` abstract class
   - `StackAgent extends AtomicAgent`
   - `DefaultAtomicAgent` implementation
   - `GenericAtomicAgent` implementation
   - `AgentContext` interface

2. **`src/agents/log-monitor/LogMonitor.ts`** (89 lines)
   - LogMonitor class implementing AtomicAgent
   - `getPrompt()`: Self-managed loop instructions
   - `parseOutput()`: Regex for `[EVENT:level] message`
   - `getTools()`: Returns ['Read', 'Glob']

3. **`src/agents/log-monitor/index.ts`** (11 lines)
   - `createLogMonitor()` factory function

### Modified Files
1. **`task-manager.ts`** (449 lines)
   - Added `TaskExtended` interface with agent, session, events, timeoutSec
   - Added `createTaskWithAgent()` method
   - Added `runTaskWithAgent()` method with SDK configuration
   - Cleaned up: Removed all console.log, kept addLog

2. **`src/drivers/registry.ts`** (225 lines)
   - Added LOG_MONITOR background_task driver
   - Handler creates LogMonitor, subscribes to events
   - Event mapping: info→ℹ️, warning→⚠️, error→❌
   - Cleaned up: Removed all console.log, kept addLog

3. **`src/domain/taskStore.ts`**
   - Updated `createTaskWithAgent` to accept session in context
   - Ensures sourceTabId defaults to 'unknown'

4. **`ui.tsx`**
   - `DriverRuntimeContext` includes session object
   - Background tasks get session via `ensureAgentSession()` when `requiresSession: true`

5. **`src/types.ts`**
   - Added `TaskEventLevel`: 'info' | 'warning' | 'error'
   - Added `TaskEvent`: { level, message, ts }

---

## 🔑 Key Technical Decisions

### 1. Agent vs Task Separation
- **Agent**: Execution scheme (how to do work) - reusable, stateless
- **Task**: Runtime instance (this concrete run) - one-time, stateful
- **Benefit**: Clear separation of concerns, enables agent reuse

### 2. EventEmitter Pattern
- Each task gets its own EventEmitter stored in Map
- Events: 'event' (TaskEvent), 'completed', 'failed', 'cancelled'
- **Benefit**: Decouples task execution from UI updates

### 3. Session Handling Strategy
```typescript
if (session.initialized) {
  options.resume = session.id;  // Continue existing session
} else {
  options.extraArgs = { 'session-id': session.id };  // Start new session
}
```
- **Benefit**: Matches Story/Agent flow exactly, ensures consistent behavior

### 4. Dual Logging Strategy
- **Console**: Essential user-facing messages only (events, completion)
- **File (addLog)**: Detailed debugging info (SDK options, message counts, etc.)
- **Benefit**: Clean UI + comprehensive debugging capability

### 5. Self-Managed Loop via Prompt
Instead of external orchestration loop:
```typescript
getPrompt(userInput: string, context: AgentContext): string {
  return `Monitor ${logFile} in a self-managed loop:
  1. Take initial snapshot
  2. Loop every ${intervalSec}s: read, compare, emit [EVENT:level]
  3. Continue until cancelled`;
}
```
- **Benefit**: Agent owns its execution logic, simpler orchestration

---

## 📊 Validation Results

### Test Run: `/bg:log-monitor 11122`
✅ **Success**
- Task created with ID: `{uuid}`
- Session: `6a5dcff5-ef03-473d-bdd6-34dd5acc9e54` (initialized: false)
- Output: `"Initial snapshot taken. Now monitoring for changes..."`
- Completion: `"✅ [Log Monitor] 监控任务已完成"`
- Events: Properly emitted to source tab with icons

### SDK Configuration Validation
✅ **Working Pattern**
```typescript
{
  model: 'anthropic/claude-3-5-sonnet',
  cwd: '/workspace/path',
  systemPrompt: { type: 'preset', preset: 'claude_code' },
  extraArgs: { 'session-id': 'new-uuid' },
  canUseTool: async () => undefined
}
```

❌ **Broken Pattern** (Exit Code 1)
```typescript
{
  // ... above options
  allowedTools: ['Read', 'Glob'],  // ❌ Causes crash
  permissionMode: 'auto'            // ❌ Causes crash
}
```

### Console Cleanup Validation
- ✅ `task-manager.ts`: 0 console.log matches
- ✅ `src/drivers/registry.ts`: 0 console.log matches
- ✅ Debug.log: Contains full detailed logging
- ✅ Terminal: Shows only essential messages

---

## 🎓 Lessons Learned

### 1. Claude Code SDK Preset Behavior
The 'claude_code' preset automatically provides tool access. Explicitly specifying `allowedTools` or `permissionMode` conflicts with the preset's internal configuration.

**Takeaway**: When using presets, rely on `canUseTool` callback for permission control, not explicit allow lists.

### 2. Session Management Consistency
Background tasks must follow the exact same session pattern as view drivers (Story/Agent). The SDK treats sessions differently based on initialization state.

**Takeaway**: Always pass session context through driver runtime, use `requiresSession` flag to enforce.

### 3. Tool Name Precision
SDK tool names must match exactly. 'Read' ≠ 'ReadFile', 'Glob' ≠ 'FileSearch'.

**Takeaway**: Refer to SDK tool registry documentation, don't assume tool names.

### 4. Logging Strategy Matters
Mixing debug logging with console output creates unreadable terminal interfaces, especially in Ink TUI applications.

**Takeaway**: Always separate concerns - console for user, files for debugging.

### 5. Comparison-Driven Debugging
When a feature works in one flow (Story) but fails in another (Background), comparing implementation details line-by-line is the fastest path to resolution.

**Takeaway**: Establish working reference implementations early, align new features to match.

---

## 🚀 Future Enhancements (Not Implemented)

### Phase 5: Story/Glossary StackAgent Refactor
- Refactor Story driver to use StackAgent with builder sub-agent
- Refactor Glossary driver to use StackAgent with searcher/planner/editor
- **Blocked by**: Need to validate StackAgent coordination patterns first

### Phase 6: Agent Tab DefaultAtomicAgent
- Migrate Agent tab from direct query() to DefaultAtomicAgent
- **Benefit**: Consistent agent interface across all tabs

### Phase 7: Advanced Monitoring Agents
- Project health monitor (task.md + git diff)
- Test coverage monitor (pytest --cov)
- Memory usage monitor (process stats)

---

## 📚 Related Documentation

- **Agent Architecture**: See `docs/task-architecture-high-level.md`
- **Conversation Memory**: See `memory/chat/2025-10-31-06-42-53-cli-enhancements.jsonl`
- **Source Code Conventions**: See `src/AGENTS.md`
- **Memory Systems**: See `memory/AGENTS.md`

---

## ✅ Completion Checklist

- [x] Phase 0: Agent type system (AtomicAgent, StackAgent, DefaultAtomicAgent)
- [x] Phase 1: LogMonitor implementation with parseOutput
- [x] Phase 2: TaskManager refactor (createTaskWithAgent, runTaskWithAgent)
- [x] Phase 3: EventEmitter system integration
- [x] Phase 4: CLI integration with /bg:log-monitor command
- [x] Bug Fix: SDK options configuration (removed allowedTools/permissionMode)
- [x] Bug Fix: Session handling (requiresSession, extraArgs/resume)
- [x] Bug Fix: Tool names (Read/Glob)
- [x] Optimization: Console.log cleanup
- [x] Validation: End-to-end test successful
- [x] Documentation: Memory and docs updated

---

**Implementation Notes**: This work establishes the foundation for background task execution with agent-based orchestration. The key breakthrough was identifying the SDK configuration incompatibility and aligning with the proven Story/Agent flow pattern. The console cleanup ensures a clean user experience while maintaining comprehensive debugging capability.
