# Design Optimization Proposal

Based on Callback vs EventBus analysis, here are the optimizations needed for workflow-agents and L2 architecture.

---

## Issues Identified

### Issue 1: L2 Architecture - EventCollector/SummaryTimer should NOT be in CodingLoop
**Current L2 diagram** shows:
```
CodingLoop (LoopAgent)
  |- EventCollector
  |- SummaryTimer
```

**Problem**: Violates Single Responsibility Principle
- CodingLoop has TWO jobs: loop control + summarization
- Not aligned with ADK callback pattern (cross-cutting concerns should be pluggable)

**Solution**: Extract to SummarizationCallback
```
CodingLoop (LoopAgent)
  |- callbacks: AgentCallback[]
       |- SummarizationCallback
            |- EventCollector (internal)
            |- SummaryTimer (internal)
```

---

### Issue 2: L2 Architecture - Judge placement is incorrect
**Current L2 diagram** shows:
```
SinglePass
  ├─ CoderAgent
  ├─ ReviewerAgent
  └─ JudgeAgent
```

**Problem**: Judge is NOT a work agent, it's a decision agent
- Refactoring analysis (refactoring-analysis.md) already corrected this:
  - "SinglePass = Coder → Review only"
  - "CodingLoop.shouldContinue() calls Judge separately"

**Solution**: Remove Judge from SinglePass
```
SinglePass (SequentialAgent)
  ├─ CoderAgent
  └─ ReviewerAgent

CodingLoop
  └─ shouldContinue() calls JudgeAgent
```

---

### Issue 3: LoopAgent - Missing callback support
**Current LoopAgent.ts**: No callback mechanism

**Problem**: Can't implement ADK-style pluggable observers
- No way to attach SummarizationCallback
- Forces summarization logic into subclass (violates SRP)

**Solution**: Add minimal callback support
```typescript
export abstract class LoopAgent implements RunnableAgent {
    protected callbacks: AgentCallback[] = [];
    protected currentSinks?: AgentStartSinks;
    
    /**
     * Attach a callback for observing loop execution
     */
    addCallback(callback: AgentCallback): void {
        this.callbacks.push(callback);
    }
    
    /**
     * Emit event to parent agent
     */
    protected emit(event: { type: string; payload: any }): void {
        this.currentSinks?.onEvent?.({
            level: 'info',
            message: `${this.id}:${event.type}`,
            ...event,
        } as any);
    }
    
    /**
     * Notify all callbacks of lifecycle event
     */
    protected notifyCallbacks(method: keyof AgentCallback, ...args: any[]): void {
        this.callbacks.forEach(cb => {
            const fn = cb[method];
            if (typeof fn === 'function') {
                fn.apply(cb, args);
            }
        });
    }
}
```

---

### Issue 4: README.md - EventBus mapping is misleading
**Current README.md** line 125:
```
| EventBus | Callback | 观测与事件处理 |
```

**Problem**: Implies they're equivalent, but they serve different purposes
- EventBus: Infrastructure for cross-agent communication
- Callback: Workflow-level observers for cross-cutting concerns

**Solution**: Clarify the distinction
```
| EventBus + Callback | ADK Callback | 混合模式：EventBus 用于基础设施，Callback 用于工作流观测 |
```

---

### Issue 5: README.md - Missing Callback pattern documentation
**Current README.md**: No mention of callback pattern

**Problem**: Developers won't know how to extract cross-cutting concerns

**Solution**: Add Callback section
```markdown
## Callback Pattern (Cross-Cutting Concerns)

For extracting observability/metrics/summarization from workflow logic:

### AgentCallback Interface
```typescript
interface AgentCallback {
    onAgentStart?(agentId: string): void;
    onToolUse?(agentId: string, event: any): void;
    onAgentEnd?(agentId: string, result: string): void;
}
```

### Example: SummarizationCallback
```typescript
class SummarizationCallback implements AgentCallback {
    private eventCollector = new EventCollector();
    
    onToolUse(agentId: string, event: any): void {
        this.eventCollector.add(event);
        if (this.eventCollector.shouldSummarize()) {
            this.generateSummary(agentId);
        }
    }
}

// Usage
const loop = new CodingLoop();
loop.addCallback(new SummarizationCallback(summarizerAgent));
```

### When to Use Callbacks vs EventBus
- **Callbacks**: Scoped to one workflow, injected at construction
- **EventBus**: Cross-process communication, runtime subscription
- **Hybrid**: Callbacks listen to EventBus internally (adapter pattern)
```

---

## Optimization Proposals

### Proposal 1: Add Callback Interface Definition
**Location**: `packages/agents/workflow-agents/AgentCallback.ts`

```typescript
/**
 * AgentCallback - Observer interface for workflow lifecycle events
 * 
 * Inspired by ADK Callback pattern for extracting cross-cutting concerns
 * (observability, metrics, summarization) from core workflow logic.
 * 
 * Usage:
 * - Create callback class implementing this interface
 * - Attach to LoopAgent/SequentialAgent via addCallback()
 * - Callback receives lifecycle notifications
 * - Can listen to EventBus internally (hybrid pattern)
 */
export interface AgentCallback {
    /**
     * Called when an agent starts execution
     */
    onAgentStart?(agentId: string, context?: any): void;

    /**
     * Called when an agent uses a tool
     */
    onToolUse?(agentId: string, toolName: string, event: any): void;

    /**
     * Called when an agent emits text
     */
    onText?(agentId: string, chunk: string): void;

    /**
     * Called when an agent completes execution
     */
    onAgentEnd?(agentId: string, result: string): void;

    /**
     * Called when an agent fails
     */
    onAgentFailed?(agentId: string, error: string): void;

    /**
     * Called at the start of each loop iteration (LoopAgent only)
     */
    onIterationStart?(iteration: number, task: string): void;

    /**
     * Called at the end of each loop iteration (LoopAgent only)
     */
    onIterationEnd?(iteration: number, result: string): void;
}
```

---

### Proposal 2: Update LoopAgent with Callback Support
**Location**: `packages/agents/workflow-agents/LoopAgent.ts`

**Add these members/methods** (minimal changes):

```typescript
import type { AgentCallback } from './AgentCallback.js';

export abstract class LoopAgent implements RunnableAgent {
    // ... existing code ...
    
    // ADD: Callback support
    protected callbacks: AgentCallback[] = [];
    protected currentSinks?: AgentStartSinks;
    
    /**
     * Attach a callback for observing loop execution
     */
    addCallback(callback: AgentCallback): void {
        this.callbacks.push(callback);
    }
    
    /**
     * Emit event to parent agent
     */
    protected emit(event: { type: string; payload: any }): void {
        this.currentSinks?.onEvent?.({
            level: 'info',
            message: `${this.id}:${event.type}`,
            ...event,
        } as any);
    }
    
    /**
     * Notify all callbacks of lifecycle event
     */
    protected notifyCallbacks(method: keyof AgentCallback, ...args: any[]): void {
        this.callbacks.forEach(cb => {
            const fn = cb[method];
            if (typeof fn === 'function') {
                fn.apply(cb, args);
            }
        });
    }
    
    start(userInput: string, context: AgentStartContext, sinks: AgentStartSinks): ExecutionHandle {
        this.currentSinks = sinks; // SAVE REFERENCE
        // ... rest of implementation
    }
}
```

---

### Proposal 3: Update SequentialAgent with Callback Support (Optional)
**Location**: `packages/agents/workflow-agents/SequentialAgent.ts`

**Add callback forwarding** (for completeness, but CodingLoop doesn't need this):

```typescript
import type { AgentCallback } from './AgentCallback.js';

export abstract class SequentialAgent implements RunnableAgent {
    // ... existing code ...
    
    // ADD: Optional callback support
    protected callbacks: AgentCallback[] = [];
    
    addCallback(callback: AgentCallback): void {
        this.callbacks.push(callback);
    }
    
    protected notifyCallbacks(method: keyof AgentCallback, ...args: any[]): void {
        this.callbacks.forEach(cb => {
            const fn = cb[method];
            if (typeof fn === 'function') {
                fn.apply(cb, args);
            }
        });
    }
}
```

**Note**: This is optional. CodingLoop can attach callbacks and forward events itself.

---

### Proposal 4: Update L2 Architecture Diagram
**Location**: `.askman/tasks/.../L2-architecture.md`

**Change from**:
```
CodingLoop (LoopAgent)
  |- EventCollector
  |- SummaryTimer
  
SinglePass (SequentialAgent)
  ├─ CoderAgent
  ├─ ReviewerAgent
  └─ JudgeAgent
```

**Change to**:
```
CodingLoop (LoopAgent)
  |- callbacks: AgentCallback[]
       └─ SummarizationCallback
            |- EventCollector (internal)
            |- SummaryTimer (internal)
  |- JudgeAgent (called by shouldContinue())

SinglePass (SequentialAgent)
  ├─ CoderAgent
  └─ ReviewerAgent
```

**Updated diagram**:
```
+------------------------------+
|          User / CLI          |
+---------------+--------------+
                |
                v
        +----------------------+
        |  DevHubCoordinator   |
        +-----------+----------+
                    |
                    v
            +------------------+
            |   CodingLoop     |  (LoopAgent)
            | + callbacks[]    |
            +--------+---------+
                     |
                     ├─ (每次迭代调用)
                     |      v
                     |  +------------------+
                     |  |   SinglePass     |  (SequentialAgent)
                     |  +----+-----+-------+
                     |       |     |
                     |       v     v
                     |  +---------+ +-----------+
                     |  | Coder   | | Reviewer  |
                     |  +---------+ +-----------+
                     |
                     └─ (shouldContinue 调用)
                            v
                       +-------------+
                       | JudgeAgent  |
                       +-------------+

Callbacks (pluggable):
  SummarizationCallback
    |- EventCollector
    |- SummaryTimer
    └─ triggers SummarizerAgent
```

---

### Proposal 5: Update README.md
**Location**: `packages/agents/workflow-agents/README.md`

**Section to add** (after "架构模式"):

```markdown
## Callback Pattern for Cross-Cutting Concerns

### Motivation
Following ADK design patterns, cross-cutting concerns (logging, metrics, summarization) should be **pluggable** rather than embedded in workflow logic.

### AgentCallback Interface
```typescript
interface AgentCallback {
    onAgentStart?(agentId: string): void;
    onToolUse?(agentId: string, event: any): void;
    onAgentEnd?(agentId: string, result: string): void;
    // ... see AgentCallback.ts for full interface
}
```

### Example: SummarizationCallback
```typescript
class SummarizationCallback implements AgentCallback {
    private eventCollector = new EventCollector();
    
    constructor(
        private summarizerAgent: RunnableAgent,
        private onSummary: (summary: string) => void
    ) {}
    
    onToolUse(agentId: string, event: any): void {
        this.eventCollector.add(event);
        if (this.eventCollector.shouldSummarize()) {
            this.triggerSummary(agentId);
        }
    }
    
    private async triggerSummary(agentId: string): Promise<void> {
        const events = this.eventCollector.flush();
        const summary = await callSummarizer(this.summarizerAgent, events);
        this.onSummary(`[${agentId}] ${summary}`);
    }
}
```

### Usage with LoopAgent
```typescript
const loop = new CodingLoop();

// Attach callbacks
loop.addCallback(new SummarizationCallback(summarizerAgent, onProgress));
loop.addCallback(new MetricsCallback());
loop.addCallback(new DebugLoggingCallback());

// Callbacks receive lifecycle notifications automatically
loop.start(task, context, sinks);
```

### Callback vs EventBus

| Aspect | Callback | EventBus |
|--------|----------|----------|
| **Scope** | Workflow-level (scoped to one agent) | Infrastructure-level (cross-agent) |
| **Coupling** | Passed at construction/method call | Runtime subscription |
| **Use Case** | Observability, metrics, summarization | Agent communication, UI updates |
| **Example** | SummarizationCallback | DevHub ↔ Looper events |

### Hybrid Pattern (Recommended)
Callbacks can listen to EventBus internally:
```typescript
class SummarizationCallback implements AgentCallback {
    attachToEventBus(eventBus: EventBus, agentId: string) {
        eventBus.on('agent:event', (e) => {
            if (e.agentId === agentId) {
                this.onToolUse(e.agentId, e.payload);
            }
        });
    }
}
```

This allows callbacks to leverage existing EventBus infrastructure while maintaining clean separation of concerns.
```

**Update ADK mapping table**:
```markdown
| 本项目 | Google ADK | 说明 |
|--------|-----------|------|
| SequentialAgent | SequentialAgent | 顺序编排模式 |
| LoopAgent | LoopAgent | 循环编排模式 |
| PromptAgent | LlmAgent | LLM 驱动的代理 |
| RunnableAgent | Agent | 统一代理接口 |
| AgentCallback | Callback | 工作流观测与横切关注点 |
| EventBus | (无直接对应) | 基础设施层跨代理通信 |
```

---

## Summary of Changes

### Code Changes (Minimal)
1. **New file**: `AgentCallback.ts` (interface definition)
2. **LoopAgent.ts**: Add 3 members + 3 methods (30 lines)
3. **SequentialAgent.ts**: Optional, same pattern (can skip for now)
4. **Export**: Add `export { AgentCallback }` to `index.ts`

### Documentation Changes
1. **L2-architecture.md**: 
   - Move EventCollector/Timer to SummarizationCallback
   - Remove Judge from SinglePass
   - Update diagram
2. **README.md**: 
   - Add Callback Pattern section
   - Update ADK mapping table
   - Add usage examples

### Benefits
- ✅ Aligns with ADK best practices
- ✅ Separates concerns (CodingLoop = loop control only)
- ✅ Enables pluggable observers (metrics, logging, summary)
- ✅ Minimal code changes (backward compatible)
- ✅ Keeps EventBus for cross-agent communication

---

## Recommendation

**Accept all proposals** except Proposal 3 (SequentialAgent callbacks - defer until needed).

**Rationale**:
- Minimal code changes (only LoopAgent)
- Big architectural win (SRP compliance)
- Enables future extensibility
- Aligns with industry best practices (ADK)
- No breaking changes to existing code
