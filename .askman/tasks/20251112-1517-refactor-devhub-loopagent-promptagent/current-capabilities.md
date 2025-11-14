# DevHub Current Capabilities Analysis

## 1. DevHub Coordinator (Entry Point)
**Location**: `packages/agents/devhub/index.ts`, `coordinator.agent.md`

**Capabilities**:
- Parse natural language user commands
- Route tasks to Looper via `run_dev_loop` or `devhub_command_tool`
- Subscribe to EventBus for child agent events (`agent:text`, `agent:event`)
- Mirror child agent output to DevHub tab via MessageStore
- Handle `looper:result` events and trigger AI to process results
- Manage event listener lifecycle (register/cleanup)
- Provide MCP tool interface for external agents

**Dependencies**:
- LooperAgent (created via `createLooperAgent()`)
- EventBus (for agent communication)
- MessageStore (for UI updates)
- TabExecutor (for triggering follow-up AI execution)

---

## 2. Looper Agent (Loop Controller)
**Location**: `packages/agents/devhub/looper/index.ts`

**Capabilities**:
- **Dual-path architecture**: Response path (immediate) + Execution path (async loop)
- **State machine**: IDLE ↔ RUNNING, with sub-states (WAITING_CODER, WAITING_REVIEW, JUDGE)
- **Command handling**: start, stop, status, add_pending
- **Task queue**: Pending tasks added during loop execution
- **Loop execution**:
  1. Run Coder agent via TaskManager.startBackground()
  2. Run Review agent (if Coder succeeded)
  3. Run Judge agent to decide continue/terminate
  4. Update task based on Judge decision
  5. Repeat until maxIterations or shouldStop
- **Event collection**: Listen to child agent events via emitter
- **Summarization**: 
  - Periodic (30s timer)
  - Threshold-based (event count)
  - On task completion
- **Result emission**: Emit `looper:progress` and `looper:result` events

**Dependencies**:
- TaskManager (for running child agents in background)
- JudgeAgent (for continue/terminate decision)
- SummarizerAgent (for progress summaries)
- EventCollector (for event buffering)

---

## 3. Command Parser
**Location**: `packages/agents/devhub/looper/command.ts`

**Capabilities**:
- Parse JSON commands: `{ type: 'start', task: '...' }`
- Parse natural language: "停止", "状态", etc.
- Default to `start` command with task description

---

## 4. State Management
**Location**: `packages/agents/devhub/looper/state.ts`

**Capabilities**:
- Define state structure: status, iteration, currentTask, pendingQueue
- Provide state factory: `createInitialState()`
- State predicates: `canStartLoop()`, `shouldTerminate()`

---

## 5. Event Collector
**Location**: `packages/agents/devhub/looper/event-collector.ts`

**Capabilities**:
- Buffer child agent events (tool_use, text)
- Truncate large content (file content, diffs)
- Trigger conditions:
  - Count threshold (10 events)
  - Time threshold (30 seconds)
- Flush events for summarization
- Event truncation strategies:
  - File content: first 3 + last 3 lines
  - Diff: max 20 lines
  - Text: max 200 chars

---

## 6. Judge Agent
**Location**: `packages/agents/devhub/looper/judge/index.ts`, `judge.agent.md`

**Capabilities**:
- Analyze Coder/Review results
- Consume pending task queue
- Decide: CONTINUE vs TERMINATE
- Output structured decision:
  - `nextTask`: Updated task for next iteration
  - `reason`: Explanation
  - `result`: (optional) Final result for TERMINATE

**Output Schema**:
```
CONTINUE
<next_task>Updated task description</next_task>
<reason>Explanation</reason>

TERMINATE
<reason>Explanation</reason>
<result>Final deliverable</result>
```

---

## 7. Summarizer Agent
**Location**: `packages/agents/devhub/looper/summarizer/summarizer.agent.md`

**Capabilities**:
- Generate single-sentence progress summary
- Analyze tool calls and text outputs
- Output format: max 30 Chinese chars / 50 English chars
- Present continuous tense: "正在编写测试文件"
- Prioritize file names and key actions

**Input Format**:
```
Tools:
- Write /game24.py (truncated)
- Bash: python game24.py

Text:
- "Creating game logic"
```

---

## 8. Workflow Tools
**Location**: `packages/agents/devhub/workflows.ts`

**Capabilities**:
- `run_dev_loop`: Start development loop (public tool)
- `devhub_command_tool`: Send commands to Looper (operator tool, DevHub tab only)
- Both tools call LooperBridge
- Error handling and logging

---

## 9. Looper Bridge
**Location**: `packages/agents/devhub/index.ts` (`createLooperBridge()`)

**Capabilities**:
- Wrap LooperAgent.start() with standardized interface
- Emit events to EventBus
- Handle command responses
- Error translation

---

## 10. Child Agent Integration
**Current**: Coder and Review are PromptAgents loaded from registry
**How Looper calls them**:
1. Get agent factory from AgentRegistry
2. Call TaskManager.startBackground()
3. Listen to emitter events
4. Wait for completion
5. Collect output

---

## Summary: Key Data Flows

### User Command Flow
```
User Input 
  → DevHub Coordinator (parse intent)
  → LooperBridge.startLoop() / sendCommand()
  → LooperAgent.start()
  → Parse command
  → Response path: immediate response
  → Execution path: runLoopAsync()
```

### Loop Iteration Flow
```
runLoopAsync()
  → Run Coder (via TaskManager)
  → Listen to events → EventCollector
  → Run Review (if Coder succeeded)
  → Run Judge (with Coder/Review results + pending queue)
  → Decision: CONTINUE → update task, next iteration
           TERMINATE → emit result, exit loop
```

### Event Flow
```
Child Agent (Coder/Review)
  → emitter.emit('event')
  → EventCollector.add()
  → Check threshold
  → Trigger Summarizer
  → Build prompt from events
  → SummarizerAgent.start()
  → Emit summary as looper:progress
```

### Result Flow
```
Judge → TERMINATE decision
  → Looper emits looper:result
  → DevHub listens to agent:event
  → Append to MessageStore
  → Trigger AI via TabExecutor
  → AI processes result and responds to user
```
