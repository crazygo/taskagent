Good direction. I'll tighten the concepts and show what this means for naming, lifecycle, and minimal architecture changes.

> **Implementation Status (2025-11-04)**: ✅ Phase 0-4 completed. Background task system operational with LogMonitor agent. See `memory/docs/2025-11-04-task-agent-implementation.md` for details.

## Quick glossary

- **Agent**: An execution scheme (Prompt or Stack). It defines "how" to do work.
  - `PromptAgent`: Base class with `getPrompt()`, `getTools()`, `getModel()`, `parseOutput()`
  - `StackAgent`: Extended class supporting sub-agent orchestration
  - `DefaultAtomicAgent`: Pass-through implementation for direct Chat/Agent tab usage
- **Task**: A runtime instance of an Agent execution. It defines "this concrete run".
  - State: pending → in_progress → completed | failed | cancelled
  - Properties: id, agent, prompt, status, output, events, session, timeoutSec
- **Foreground Task**: Runs in the current tab (Story tab messages are FG tasks). Interactive permissions; outputs go to ChatPanel.
- **Background Task**: Runs detached. Has EventEmitter; permissionMode=auto; emits events to source tab.
  - **Implemented**: `/bg:log-monitor` - monitors debug.log, emits TaskEvents

Background tasks are invoked via /bg:* commands. The legacy /task alias has been removed.

## Commands and naming

- **`/bg:log-monitor <description>`** ✅ **Implemented**
  - Start background log monitoring task from any tab
  - Monitors debug.log file for changes
  - Emits events (ℹ️ info, ⚠️ warning, ❌ error) to source tab
  - Uses session support (`requiresSession: true`)
  
- `/bg <description>`
  - Start a generic background task from any tab
  - Options:
    - `--stay`: don't auto-switch to the Task tab (current behavior auto-switches; this flag prevents it)
    - `--name "<label>"`: attach a friendly task label
    
- Optional: `/fg <description>`
  - Explicitly run a foreground task in the current tab (clarifies intent vs. background)
  
- Natural language integrations:
  - "看看监控状态" in the source tab should route to a PromptAgent that reads the task log and summarizes

## Lifecycle and contracts (concise)

> **Implementation Note**: TaskManager.startForeground()/startBackground() call agent.start() to implement these contracts.

- **Task states**: pending → in_progress → completed | failed | cancelled
- **Create**
  - Input: `{ agent: PromptAgent, userPrompt: string, context: { sourceTabId, workspacePath?, timeoutSec?, session? } }`
  - Output: `{ task: TaskExtended, emitter: EventEmitter }`
  - Implementation: `TaskManager.startBackground()` (for background tasks) and `TaskManager.startForeground()` (for in-tab streaming)
- **Observe**
  - Event: `{ level: 'info'|'warning'|'error', message: string, ts: number }`
  - EventEmitter events: 'event', 'completed', 'failed', 'cancelled'
  - Parsing: Agent's `parseOutput()` method extracts events from LLM output
- **Cancel**
  - Input: `{ taskId }`, Output: `{ ok: boolean }`
  - Implementation: `TaskManager.cancelTask()`
- **Permission policy**
  - FG: interactive permission prompts (existing behavior)
  - BG: `canUseTool: async () => undefined` (auto-approve), limited to Read/Glob tools

## Orchestration: tying Agent to Task

> **Implementation**: LogMonitor demonstrates the PromptAgent pattern with self-managed loops.

- **Agent Selection**
  - Driver registry maps slash commands to agents (e.g., `/bg:log-monitor` → LogMonitor agent)
  - Orchestrator in driver handler creates agent instance and calls `startBackground()`
  
- **Background Context**
  - Isolated sessionId per task; bind taskId ↔ sourceTabId
  - Session handling: `extraArgs: { 'session-id': uuid }` for new, `resume: sessionId` for initialized
  - Pass workspacePath to agent context for absolute paths
  
- **LogMonitor Implementation** ✅ **Working**
  - Type: PromptAgent (self-managed loop via prompt)
  - Loop cycle: Every 30 seconds, read last 100 lines of debug.log
  - Tools: `['Read', 'Glob']` (exact SDK tool names)
  - Output parsing: `/^\[EVENT:(info|warning|error)\]\s*(.+)$/i`
  - Event emission: TaskEvent → EventEmitter → UI with icons (ℹ️⚠️❌)
  
- **Monitor Stack-Agent** (future: graph-style, borrow from plan-review-do)
  - loop:
    - @read_context (Atomic): read source conversation snapshot/state
    - @analyze_progress (Atomic): assess plan/implementation status vs. description
    - if severity >= urgent: emit_event("monitor.severity", payload)
    - wait(60s); goto loop
    
- **Log Reader** (future: Atomic)
  - @task_log_reader: read logs/{taskId}.log, summarize, return status on demand ("看看监控状态")

## Why this framing helps

- Keeps Agent vs Task clean: Agents are plans (Atomic/Stack); Tasks are instances (FG/BG).
- Adds a consistent mental model: foreground = conversational, background = autonomous with events and logs.
- Reuses plan-review-do style graphs for robust monitor flows.
- Requires small, incremental changes to the current codebase.

## ✅ Implementation Achievements (2025-11-04)

### Core Architecture
- **Agent Type System**: `PromptAgent`, `StackAgent`, `DefaultAtomicAgent` defined in `src/agent/types.ts`
- **Task Extensions**: `TaskExtended` interface with agent, session, events, timeoutSec
- **EventEmitter Integration**: Each task gets EventEmitter with 'event', 'completed', 'failed', 'cancelled'
- **TaskManager Methods**: `startForeground()`, `startBackground()`, `waitTask()`, `cancelTask()` fully functional

### LogMonitor Agent
- **Location**: `src/agents/log-monitor/LogMonitor.ts`
- **Capabilities**: Monitors debug.log, 100 lines tail, 30-second intervals
- **Self-Managed**: Loop logic in prompt, no external orchestration needed
- **Event Parsing**: Regex-based extraction of `[EVENT:level] message` patterns

### Critical Bug Fixes
1. **SDK Configuration**: Removed `allowedTools` and `permissionMode` (caused exit code 1 with presets)
2. **Session Handling**: Aligned with Story/Agent flow (extraArgs vs resume based on initialized flag)
3. **Tool Names**: Corrected to 'Read', 'Glob' matching SDK registry
4. **Console Cleanup**: Separated UI logs from debug file logs for clean terminal

### Validation
- ✅ End-to-end test: `/bg:log-monitor 11122` executed successfully
- ✅ Output: "Initial snapshot taken. Now monitoring for changes..."
- ✅ Events: Emitted to source tab with level-based icons
- ✅ Completion: "✅ [Log Monitor] 监控任务已完成"

### Documentation
- **Implementation Details**: `memory/docs/2025-11-04-task-agent-implementation.md`
- **Chat Memory**: `memory/chat/2025-11-04-task-agent-implementation.jsonl`
- **This Document**: Updated with implementation status and learnings


## Scenarios and investigation methods

Event model
- Background/foreground Tasks emit events with shape: { level: info | warning | error, message: string, ts: number }.
- timeoutSec is the only outer control; looping cadence is described inside the Agent prompt/instructions.

### Scenario 1 — Log-tail → summary (Atomic, BG)
- Purpose: Periodically read the last N lines of a log file and push concise NL summaries only.
- Agent type: PromptAgent (self-managed loop via prompt). Task mode: Background.
- Data to read:
  - Target file path (e.g., logs/app.log)
  - Tail size N (e.g., 100–500 lines)
  - Optional: patterns/keywords to watch (ERROR, WARN, custom regex)
- Investigation method:
  - Compare current tail with previous snapshot to detect deltas.
  - Extract counts by severity and recurring signatures.
  - Surface top anomalies (new error types, bursty frequency).
  - Produce an NL summary; avoid step-by-step traces.
- Prompt template (NL):
  - “Every 30 seconds, read the last 200 lines of logs/app.log. Compare with the prior cycle, summarize only changes. Report as natural language with severity (info/warning/error). Do not stream intermediate steps.”
- Event examples:
  - info: “Log stable. 2 warnings, 0 errors in last 200 lines.”
  - warning: “Spikes in WARN: rate 3x baseline; top source: CacheMiss.”
  - error: “5 new ERROR entries from PaymentService: timeout to gateway.”
- Exit suggestions:
  - Manual cancel, timeoutSec reached, or no changes for K cycles.

### Scenario 2 — Project health monitor (Atomic, BG, long-live)
- Purpose: Assess progress/health from task.md + git diff + related task logs; push periodic updates; escalate risks.
- Agent type: PromptAgent (self-managed loop via prompt). Task mode: Background.
- Data to read:
  - Task list file (task.md) with items and statuses.
  - Git diff window (since last cycle or since baseline branch).
  - Logs of related background tasks (glob: logs/task-*.log).
- Investigation method:
  - Parse task.md to infer current completion ratio and blocked items.
  - Summarize git diff (files touched, test changes, high-risk areas).
  - Cross-reference logs for failures or repeated warnings.
  - Synthesize an NL health assessment (progress, risks, recommended next steps).
- Prompt template (NL):
  - “Every 60 seconds, read task.md, read the latest git diff since the previous cycle, and scan logs/task-*.log for failures. Summarize progress and health in natural language. Use info/warning/error based on risk level. Push only concise summaries.”
- Event examples:
  - info: “Progress ~45%. Health good. Recent diffs focus on UI; tests passing.”
  - warning: “Health moderate. Item ‘task-3’ idle for 40 min; suggest unblocking.”
  - error: “Health poor. CI failures detected in 3 specs; rollbacks may be needed.”
- Exit suggestions:
  - The supervised execution finishes (detected via logs/status), manual cancel, or timeoutSec reached.

### Scenario 3 — Deep research cycle (Stack, BG or FG)
- Purpose: Research → review → decide; iterate if continuation criteria met.
- Agent type: Stack-Agent (coordinator + sub-Prompt agents). Task mode: Background preferred (can be FG for interactive checkpoints).
- Sub-agents (Atomic):
  - @research: gather findings with citations and source notes.
  - @review: critique coverage, identify gaps, remove duplication.
  - @decide_continue: evaluate coverage/novelty; decide continue/stop and focus areas for next round.
- Investigation method (per cycle):
  - Sources: official docs, product pages, pricing, SDK/docs, benchmarks, case studies, recent releases/changelogs, reputable analyses.
  - Axes: capabilities (reasoning, coding, multimodal), latency/cost, context length, safety/compliance, ecosystem tooling, enterprise features, TCO.
  - Quality controls: cite sources, deduplicate, highlight contradictions, mark unknowns with next probes.
  - Continuation criteria: material gaps remain, conflicting claims unresolved, key dimension lacks data.
- Coordinator graph (conceptual):
  - research → review → decide_continue → (continue? loop : exit with final).
- Prompt templates (NL):
  - Coordinator: “Run a research cycle on ‘Claude competitors’. Maintain concise checkpoints. Stop when marginal gains are low.”
  - @research: “Collect newest, credible info; note URLs and dates; prefer primary sources.”
  - @review: “Consolidate, remove duplicates, surface gaps and contradictions.”
  - @decide_continue: “Assess coverage/novelty. If gaps remain, specify next-focus; else produce final conclusion.”
- Event examples:
  - info: “Round 1 complete: identified GPT-4, Gemini, Llama; preliminary capability matrix drafted.”
  - warning: “Pricing data inconsistent across sources; need updated enterprise SKUs.”
  - error: “Rate-limited by sources; backing off; retry later.”
- Exit suggestions:
  - decide_continue=stop, manual cancel, or timeoutSec reached.

## Interfaces and invocation examples

This section specifies the external, unified Task interface and shows how to invoke it for the three scenarios. Atomic and Stack agents share the same interface; they differ only in internal design.

### Task interfaces (high-level)

```ts
// Event model (kept intentionally simple)
export type TaskEventLevel = 'info' | 'warning' | 'error';
export type TaskEvent = { level: TaskEventLevel; message: string; ts: number };

// Start a Task (Foreground or Background)
export type StartTaskInput = {
  agent: unknown; // PromptAgent | StackAgent instance (resolved by registry/driver)
  prompt: string; // Natural-language instruction
  context: {
    sourceTabId: string;         // Originating tab
    messageIdFrom?: string;      // Include chat history from this message id onward
    workspacePath?: string;      // Optional working directory
  };
  timeoutSec?: number;           // Hard kill after N seconds (optional)
};

export type StartTaskResult = {
  taskId: string;
  emitter: {
    on(event: 'event', handler: (e: TaskEvent) => void): void;
    on(event: 'completed', handler: () => void): void;
    on(event: 'failed', handler: (error: string) => void): void;
    on(event: 'cancelled', handler: () => void): void;
  };
};

// Observation & control (read-only + management)
export type TaskStatus = {
  state: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  lastEvent?: TaskEvent;
  cycles?: number; // optional, if the agent exposes cycle counts
};

declare function startTask(input: StartTaskInput): StartTaskResult;
declare function getStatus(taskId: string): TaskStatus;
declare function getSummary(taskId: string): string;  // concise, human-friendly
declare function readLog(taskId: string): string;      // full textual log
declare function cancelTask(taskId: string): { ok: boolean };
```

Notes
- timeoutSec is the only outer control; looping cadence and exit conditions are defined inside the Agent (prompt/instructions).
- EventEmitter exposes a single payload shape { level, message, ts }; health/progress should be natural language in message.

### CLI mapping (illustrative)

```
# Background tasks
/bg:log-monitor   --timeout=3600 "每 30 秒监控 debug.log 最后 100 行"
/bg:health        --timeout=7200 "监控 task.md 执行进度和健康度"
/bg:research      --timeout=1800 "调研与 Claude 有关的竞品"
```

### Programmatic invocation examples

Below snippets demonstrate startTask + event handling. Replace agent resolution with your registry/driver mechanism.

#### Scenario 1 — Log-tail → summary (Atomic, BG)

```ts
const agent = registry.get('log-monitor'); // PromptAgent instance
const { taskId, emitter } = startTask({
  agent,
  prompt: '每 30 秒读取 debug.log 最后 100 行，对比上次变化，仅用自然语言总结变化，按 info/warning/error 分级',
  context: { sourceTabId, messageIdFrom },
  timeoutSec: 3600,
});

emitter.on('event', ({ level, message, ts }) => ui.pushSystemMessage(sourceTabId, level, message, ts));
emitter.on('completed', () => ui.pushSystemMessage(sourceTabId, 'info', '日志监控已完成'));
emitter.on('failed', (error) => ui.pushSystemMessage(sourceTabId, 'error', `日志监控失败：${error}`));
```

#### Scenario 2 — Project health monitor (Atomic, BG, long-live)

```ts
const agent = registry.get('project-health'); // PromptAgent instance
const { taskId, emitter } = startTask({
  agent,
  prompt: '每 60 秒读取 task.md、最新 git diff 与相关任务日志，输出进度与健康度（自然语言），必要时发出告警',
  context: { sourceTabId, messageIdFrom, workspacePath },
  timeoutSec: 7200,
});

emitter.on('event', ({ level, message, ts }) => ui.pushSystemMessage(sourceTabId, level, message, ts));
emitter.on('completed', () => ui.pushSystemMessage(sourceTabId, 'info', '健康度监控完成'));
```

#### Scenario 3 — Deep research cycle (Stack, BG or FG)

```ts
const agent = registry.get('research-cycle'); // StackAgent coordinator instance
const { taskId, emitter } = startTask({
  agent,
  prompt: '调研与 Claude 有关的竞品：保持简洁检查点；当边际收益低时停止，并给出最终结论',
  context: { sourceTabId },
  timeoutSec: 1800,
});

emitter.on('event', ({ level, message, ts }) => ui.pushSystemMessage(sourceTabId, level, message, ts));
emitter.on('completed', () => ui.pushSystemMessage(sourceTabId, 'info', '研究周期已结束'));
```

Formatting guideline for UI
- Map level to visual style: info (ℹ️), warning (⚠️), error (❌).
- message is always natural language (include health/progress summaries as sentences).

## Implementation plan (phased, minimal diffs first)

This plan turns the blueprint into shippable increments. Each phase lists target files, contracts, and acceptance checks. Prioritize Phase 0–3 for the MVP; 4–7 harden and expand; 8–9 polish and compat.

### Phase 0 — Contracts and scaffolding (no behavior change yet)

- Files
  - `src/types.ts`: add Task contracts
  - `src/domain/taskStore.ts`: light task registry + event emitters
  - `src/task-logger.ts`: verify per-task log writer helper
- Add types (exact names may be adjusted to match local conventions)
  - `TaskEventLevel = 'info'|'warning'|'error'`
  - `TaskEvent = { level: TaskEventLevel; message: string; ts: number }`
  - `StartTaskInput`, `StartTaskResult`, `TaskStatus`
- Task store (minimal)
  - Keep an in-memory map: `taskId -> { state, startedAt, emitter, lastEvent, sourceTabId }`
  - Expose functions (no-op stubs OK to start):
    - `startTask(input): StartTaskResult` (returns `taskId` + emitter)
    - `getStatus(taskId): TaskStatus`
    - `getSummary(taskId): string` (initially lastEvent.message or "(no summary)")
    - `readLog(taskId): string` (reads `logs/{taskId}.log` if present)
    - `cancelTask(taskId): { ok: boolean }`
- Logging helper
  - Ensure `src/task-logger.ts` exposes: `append(taskId: string, line: string): Promise<void>` and creates `logs/{taskId}.log`
- Acceptance
  - Type-check passes. No UI change. Creating and reading dummy entries in the store works in unit tests.

### Phase 1 — CLI surface and routing (/bg)

- Files
  - `src/cli/args.ts`: parse `/bg` with options: `--stay`, `--name "<label>"`, `--timeout=<sec>`
  - `src/cli/help.ts`: add usage docs
  - `src/cli/config.ts` (if applicable): wire defaults
- Behavior
  - When user enters `/bg ...`, emit an intent that includes: `description`, flags, `sourceTabId` (current), and `messageIdFrom` (current selection if any)
  - For MVP, support explicit subcommands (no NLP): `/bg:log-monitor`, `/bg:health`, `/bg:research`
- Acceptance
  - Parsing unit tests for flags and aliases
  - Help text shows new commands

### Phase 2 — UI wiring (tabs, events, and stay flag)

- Files
  - `ui.tsx`: handle `/bg:*` intents → call `startTask(...)`
  - `src/components/TaskSpecificView.tsx`: display task status and hint the log path `logs/{taskId}.log`
  - `src/components/StatusControls.tsx` (or tab container): respect `--stay` (don’t auto-switch tab when set)
- Behavior
  - On new background task: create a `Task N` tab bound to `taskId`; if `--stay` not set, auto-switch to that tab
  - Route task events back to the source tab as system messages: map `level` to visuals and print `message`
  - Show last event and state in the Task tab; provide a Cancel action
- Acceptance
  - Manual run shows tab creation and event routing
  - `--stay` keeps focus on the current tab

### Phase 3 — Agent registry and minimal agents (MVP functionality)

- Files
  - `src/drivers/registry.ts`: register three new entries
  - `src/drivers/monitor/agents/log_tail.agent.md`: PromptAgent prompt for Scenario 1
  - `src/drivers/health/agents/project_health.agent.md`: PromptAgent prompt for Scenario 2
  - `src/drivers/research/coordinator.agent.md` + `agents/*.agent.md`: Stack agent skeleton for Scenario 3
  - `src/drivers/*/index.ts`: export driver metadata for selection
- Behavior
  - `/bg:log-monitor` resolves a PromptAgent instance and calls `startBackground`
  - `/bg:health` resolves a PromptAgent instance and calls `startBackground`
  - `/bg:research` resolves Stack coordinator instance and calls `startTask`
- Acceptance
  - Each command kicks off a task and emits at least one info-level event in < 5s (use short timeouts in dev)

### Phase 4 — Orchestrator selection (opt-in NLP later)

- Files
  - `src/drivers/registry.ts` and/or a lightweight selector: map subcommands → agent instances
- Behavior
  - Start with explicit subcommands only (deterministic). Optionally add a heuristic to map free-form `/bg "..."` to agents later.
- Acceptance
  - Clear errors for unknown subcommands; suggest available ones

### Phase 5 — Permission policy (BG auto, FG interactive)

- Files
  - `src/components/AgentPermissionPrompt.tsx` (+ `.types.ts`): add policy input or context
  - `ui.tsx` / task start call-site: set `permissionMode = 'auto'` for BG
- Behavior
  - Background tasks auto-allow a small allowlist (Read/FS, EventEmit, LogRead). Foreground remains interactive.
- Acceptance
  - BG tasks run without prompting, only within allowlist

### Phase 6 — Timeouts and cancellation

- Files
  - `src/domain/taskStore.ts`: enforce `timeoutSec` per task, transition state to `cancelled` on timeout
  - `ui.tsx` + `TaskSpecificView.tsx`: Cancel button calls `cancelTask(taskId)`
- Acceptance
  - Tasks stop on timeout and on manual cancel; UI reflects `cancelled`

### Phase 7 — Tests (unit + e2e)

- Files
  - `tests/e2e/cli.test.ts`: new cases for `/bg:log-monitor` and `--stay`
  - `tests/e2e/automation.test.ts`: assert Task tab creation and event message presence
  - `tests/helpers/run-command.ts`: minor helpers if needed
- Behavior
  - Use `yarn start:test` to bound runtime during e2e
- Acceptance
  - All tests PASS locally and in CI

### Phase 8 — Documentation and help

- Files
  - `README.md`: add /bg usage and examples
  - `AGENTS.md`: reference Atomic vs Stack examples and the new drivers
  - `src/cli/help.ts`: examples and flags
- Acceptance
  - New docs accurately reflect the shipped surface

### Phase 9 — Backwards compatibility and cleanup

- Behavior
  - The `/task` alias has been removed in favor of explicit `/bg:*` commands
  - Story/Glossary unaffected
- Acceptance
  - Regression tests for Story/Glossary still PASS

## Minimal file-by-file change map (cheat sheet)

- `src/types.ts`
  - Add: `TaskEventLevel`, `TaskEvent`, `StartTaskInput`, `StartTaskResult`, `TaskStatus`
- `src/domain/taskStore.ts`
  - New: in-memory store + `startTask/getStatus/getSummary/readLog/cancelTask`
- `src/task-logger.ts`
  - Ensure: `append(taskId, line)` writes to `logs/{taskId}.log`
- `src/cli/args.ts`
  - Add: parse `/bg:*`; options `--stay`, `--name`, `--timeout`
- `src/cli/help.ts`
  - Add usage for new commands
- `ui.tsx`
  - Add: `/bg:*` dispatch → `startTask(...)`; event routing to source tab; respect `--stay`
- `src/components/TaskSpecificView.tsx`
  - Show: status, last event, Cancel, and log path hint
- `src/drivers/registry.ts`
  - Register: `log-monitor`, `project-health`, `research-cycle`
- `src/drivers/*`
  - Add agent markdowns and indexes per existing conventions

## Contracts and edge cases

- Inputs/Outputs (contract)
  - Input: `StartTaskInput` with `agent`, `prompt`, `context:{sourceTabId, messageIdFrom?, workspacePath?}`, `timeoutSec?`
  - Output: `{ taskId, emitter }` and log at `logs/{taskId}.log`
- Error modes
  - Invalid agent or subcommand → user-facing error message
  - Permission denied (BG outside allowlist) → error event + `failed`
  - Log file IO error → warn event but continue (fallback to memory-only)
  - Timeout → `cancelled` with final event
- Edge cases
  - Rapid event bursts: throttle UI updates (existing 100ms throttle can be reused)
  - Large logs: tail-only in agents, avoid whole-file reads
  - Workspace absent or readonly: degrade gracefully; write logs next to process cwd

## Test plan (essentials)

- Unit
  - `args`: parse `/bg:log-monitor --timeout=5 --stay "..."`
  - `taskStore`: start → event → complete; timeout & cancel transitions
  - `task-logger`: creates file and appends lines
- E2E
  - Start app with `/bg:log-monitor -p "..."` and confirm:
    - Task tab created, or `--stay` respected
    - A system message appears in the source tab with level mapping
    - A log file `logs/{taskId}.log` exists and contains an event line
  - Alias `/task:log-monitor` behaves the same

## Notes and recommended sequencing

- Ship 0→2 fast to get UI + task skeleton visible. Then 3 for real value (log-monitor).
- Prefer explicit `/bg:subcommand` to avoid early NLP misroutes; add heuristic selection later.
- Keep BG permissions tight at first; expand the allowlist only when necessary.

## Foreground tabs: Story / UI / Glossary (current behavior)

- Concept
  - These are specialized tabs (views) with a default Agent bound to each tab.
  - Messages sent in these tabs run as Foreground Tasks and stream results to the ChatPanel in-place.
- Default agent bindings
  - Story tab → Stack-Agent `drivers/story/` (coordinator + builder agent)
  - Glossary tab → Stack-Agent `drivers/glossary/` (searcher → planner → editor)
  - UI tab (UI Review) → Agent(s) under `drivers/ui-review/` (prompt-driven checks)
- Semantics
  - Execution mode: Foreground (interactive). The user can be prompted for permissions before edits.
  - Output: Streamed to the current tab’s ChatPanel with throttled updates (100ms).
  - Context: Uses the tab’s conversation state (frozen + active messages) as input.
  - Logging: No per-task file log by default; background-style `logs/{taskId}.log` is only for BG tasks.
- Interop with Background Tasks
  - From any of these tabs, issuing `/bg:*` will spawn a Background Task with its own Task tab; events are pushed back to the source tab as system messages.
  - Foreground semantics remain unchanged for normal messages typed in these tabs.
- Practical notes
  - “同步显示结果”应理解为“流式输出显示”：结果边生成、边渲染到当前 ChatPanel。
  - 当触发文件编辑或外部操作时，前台遵循交互式权限提示；后台则使用受限 allowlist 的自动策略。

