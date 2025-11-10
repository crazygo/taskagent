# Looper Progress Summary Feature Plan

**Created**: 2025-11-07  
**Status**: Design Phase

---

## Current State

When Coder/Review agents execute (taking 2-5 minutes), external observers (Looper, DevHub, user) see no progress updates, causing "is it stuck?" anxiety.

**Symptoms**:
- User sees `[AUTO] 启动 Coder...` then silence for minutes
- No visibility into what Coder is doing (reading files? writing code? running tests?)
- User cannot distinguish between "working" and "frozen"

---

## Requirements

**Primary Goal**: Let users perceive Coder/Review internal progress to reduce anxiety.

**Acceptance Criteria**:
- User sees periodic progress updates (e.g., every 30s or every 10 events)
- Updates are concise summaries, not raw tool calls
- Updates automatically mirror to DevHub tab (via parentAgentId hierarchy)
- Solution scales to future child agents without code changes

**Non-Goals**:
- Not showing every single tool call (information overload)
- Not requiring Coder/Review to modify their prompts

---

## Research

### Current Architecture

**Looper starts Coder/Review**:
```typescript
const { task, emitter } = taskManager.startBackground(agent, task, {
  parentAgentId: 'looper'
});
```

**TaskManager emits events**:
```typescript
emitter.emit('event', { 
  type: 'tool_use', 
  name: 'Write', 
  input: { file_path: '/test.py', content: '...' }
});
emitter.emit('event', { 
  type: 'text', 
  content: 'Creating test file...' 
});
```

**Looper already has the emitter** - no need for global EventBus!

### Content Truncation Rules

**File content** (`Write`, `Edit`, `Read`):
- Keep: `file_path` (full)
- Truncate: `content` → first 3 lines + `...` + last 3 lines

**Command** (`Bash`):
- Keep: `command` (full, usually short)
- Keep: `description`

**Diff** (`Edit`):
- Truncate: max 20 lines

**General**:
- Any `content` > 200 chars → truncate with "..."

---

## Solution Directions (L1)

### Direction A: Built-in Summarizer (Selected)

**Approach**: Looper listens to child agent emitter, collects events, uses SummarizerAgent (PromptAgent) to generate periodic summaries.

**Flow**:
```
Coder emits tool_use/text 
  → Looper.emitter.on('event')
  → EventCollector buffers & truncates
  → (30s timer OR 10 events accumulated)
  → SummarizerAgent generates summary
  → Looper.pushMessage("[Coder] 正在...")
  → Auto-mirrors to DevHub
```

**Pros**:
- ✅ Self-contained within Looper
- ✅ Uses existing emitter mechanism
- ✅ Automatic for all child agents (just set parentAgentId='looper')

**Cons**:
- ⚠️ AI call cost (mitigated by using lightweight model)
- ⚠️ 1-2s latency per summary

### Direction B: Pre-defined Phase Detection

Hard-code rules: Read/Grep → "analyzing", Edit/Write → "modifying", Bash → "testing".

**Rejected**: Too rigid, doesn't adapt to new tools or patterns.

### Direction C: Child Agent Self-Reporting

Modify Coder/Review prompts to output progress markers.

**Rejected**: Requires changing every agent, not scalable.

---

## Design Proposal (L2)

### Recommended Direction: A (Built-in Summarizer)

**Rationale**: 
- Looper already orchestrates child agents and has access to their event streams
- AI-based summarization adapts to any tool/pattern without hardcoding
- EventCollector keeps solution clean and testable

---

### Key Components

#### 1. EventCollector

**Responsibilities**:
- Buffer child agent events (tool_use, text)
- Truncate large content (file_path preserved, content shortened)
- Trigger summary on time (30s) or count (10 events)

**Interface**:
```typescript
class EventCollector {
  add(event: any): void;           // Add event to buffer
  shouldSummarize(): boolean;      // Check trigger conditions
  flush(): TruncatedEvent[];       // Get & clear buffer
}
```

**Truncation Logic**:
- `tool_use.input.content`: first 3 + last 3 lines
- `tool_use.input.diff`: max 20 lines
- `text` output: first 100 chars

---

#### 2. SummarizerAgent (PromptAgent)

**Definition**: `packages/agents/looper/summarizer/summarizer.agent.md`

**Prompt**:
```
You are a progress summarizer for code execution agents.

Input: List of tool calls and text outputs from Coder/Review.
Output: Single-sentence summary (< 30 chars) in Chinese, present continuous tense.

Examples:
- Tools: Write /test.py, Bash: pytest
  Summary: 正在编写测试文件并运行测试

- Tools: Read /main.ts, Edit /main.ts
  Summary: 正在修改 main.ts

Rules:
- Concise (< 30 characters)
- Focus on main action
- Use 正在... format
- Mention key file names if relevant
```

**Integration**:
```typescript
this.summarizerAgent = await createSummarizerAgent();
const summary = await this.callSummarizer(truncatedEvents);
this.pushMessage(`[${agentName}] ${summary}`);
```

---

#### 3. Looper Integration

**Modifications to `LooperGraphAgent`**:

```typescript
class LooperGraphAgent {
  private summarizerAgent?: RunnableAgent;
  private eventCollector: EventCollector;
  private summaryTimer?: NodeJS.Timeout;
  
  async initialize() {
    this.judgeAgent = await createJudgeAgent();
    this.summarizerAgent = await createSummarizerAgent(); // NEW
    this.eventCollector = new EventCollector();           // NEW
  }
  
  private async runAgent(agent: string, task: string) {
    const { task: bgTask, emitter } = this.taskManager.startBackground(...);
    
    // NEW: Listen to child events
    emitter.on('event', (e) => this.handleChildEvent(e));
    
    // NEW: Start summary timer
    this.startSummaryTimer(agent);
    
    const result = await this.waitForTask(emitter);
    
    // NEW: Stop timer & final summary
    this.stopSummaryTimer();
    await this.generateFinalSummary(agent);
    
    return result;
  }
  
  private handleChildEvent(event: any) {
    this.eventCollector.add(event);
    if (this.eventCollector.shouldSummarize()) {
      this.triggerSummary();
    }
  }
  
  private async triggerSummary(agentName: string) {
    const events = this.eventCollector.flush();
    if (events.length === 0) return;
    
    const summary = await this.callSummarizer(events);
    this.pushMessage(`[${agentName}] ${summary}`);
  }
}
```

---

### Trigger Mechanisms

**Time-based**: Every 30 seconds
```typescript
this.summaryTimer = setInterval(() => {
  if (this.eventCollector.hasEvents()) {
    this.triggerSummary(agentName);
  }
}, 30000);
```

**Event-based**: Every 10 events
```typescript
if (this.eventCollector.count() >= 10) {
  this.triggerSummary(agentName);
}
```

**Completion**: Final summary when agent finishes
```typescript
await this.waitForTask(emitter);
await this.generateFinalSummary(agentName);
```

---

### Data Flow

```
┌─────────────┐
│ Coder Agent │ executes Write, Bash, Edit...
└──────┬──────┘
       │ emitter.emit('event', toolUse)
       ↓
┌──────────────────┐
│ EventCollector   │ buffers & truncates
│ - Write /test.py │ (content: 3 lines...3 lines)
│ - Bash: pytest   │
│ - Text: "..."    │
└──────┬───────────┘
       │ 30s OR 10 events
       ↓
┌──────────────────┐
│ SummarizerAgent  │ AI generates summary
└──────┬───────────┘
       │ "正在编写测试文件并运行测试"
       ↓
┌──────────────────┐
│ Looper.pushMsg   │ "[Coder] 正在编写测试..."
└──────┬───────────┘
       │ parentAgentId='devhub'
       ↓
┌──────────────────┐
│ DevHub mirrors   │ User sees update
└──────────────────┘
```

---

### Trade-offs

**Advantages**:
- ✅ **Scalable**: New child agents (e.g., Analyzer, Deployer) work automatically
- ✅ **Non-invasive**: No changes to Coder/Review prompts
- ✅ **Adaptive**: AI understands context, not just pattern matching
- ✅ **Clean architecture**: EventCollector is testable unit

**Disadvantages**:
- ⚠️ **AI cost**: ~$0.0001 per summary (using lightweight model)
- ⚠️ **Latency**: 1-2s delay per summary call
- ⚠️ **Accuracy risk**: AI might misinterpret tool sequence

**Mitigation**:
- Use lightweight model (e.g., claude-haiku) for summaries
- Cache common patterns (future optimization)
- Provide clear examples in SummarizerAgent prompt

---

### Success Metrics

**Before**:
- User sees: `[AUTO] 启动 Coder...` → silence for 3 minutes → `[AUTO] Coder 完成`
- User anxiety: High

**After**:
- User sees:
  ```
  [AUTO] 启动 Coder...
  [Coder] 正在分析项目结构         (30s)
  [Coder] 正在编写游戏逻辑         (60s)
  [Coder] 正在添加测试代码         (90s)
  [Coder] 正在运行测试             (120s)
  [AUTO] Coder 完成
  ```
- User anxiety: Low

---

## Implementation Checklist

### Phase 1: Core Infrastructure
- [ ] Create `EventCollector` class with truncation logic
- [ ] Create `SummarizerAgent` (summarizer.agent.md)
- [ ] Add `summarizerAgent` to LooperGraphAgent
- [ ] Implement `handleChildEvent` to buffer events

### Phase 2: Summary Triggers
- [ ] Implement 30s timer mechanism
- [ ] Implement 10-event threshold
- [ ] Implement final summary on completion
- [ ] Add cleanup on agent termination

### Phase 3: Integration
- [ ] Wire emitter.on('event') in runAgent()
- [ ] Build summary prompt from truncated events
- [ ] Call SummarizerAgent and pushMessage result
- [ ] Test with Coder agent (write file, run bash, etc.)

### Phase 4: Refinement
- [ ] Tune truncation thresholds (3 lines? 5 lines?)
- [ ] Tune trigger timing (30s? 45s?)
- [ ] Tune event threshold (10? 15?)
- [ ] Test with Review agent
- [ ] Add error handling (summary fails → graceful skip)

---

## Future Enhancements

- [ ] Model selection: Allow lightweight model config (Haiku vs GLM)
- [ ] Pattern caching: Cache summaries for identical tool sequences
- [ ] User preferences: Configurable summary frequency
- [ ] Multi-language: Detect user language and adapt summary language
- [ ] Progress bars: Convert summaries to progress percentage estimates

---

## References

- Looper architecture: `packages/agents/looper/index.ts`
- TaskManager events: `packages/shared/task-manager.ts`
- Agent hierarchy: `AGENTS.md` → "How to Work with Humans"
- DevHub mirroring: `packages/agents/devhub/index.ts` (line 44-69)
