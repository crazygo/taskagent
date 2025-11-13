# DevHub Refactoring Analysis - L2 Architecture

Based on the L2 architecture with SequentialAgent + LoopAgent, here's how each current capability maps to the new design.

---

## 1. DevHub Coordinator → **Remains as PromptAgent**

**Current**: Entry point, routes commands, mirrors events
**New Design**: Keep as-is (PromptAgent)

### Why no change?
- Already a clean PromptAgent with single responsibility
- Natural language understanding fits PromptAgent pattern
- Event mirroring and tool provision are infrastructure concerns, not workflow concerns

### Modifications needed:
- Update internal dependency: point to new `CodingLoop` instead of `LooperGraphAgent`
- Update LooperBridge to call `CodingLoop.start()` instead
- No changes to coordinator.agent.md prompt or tool definitions

---

## 2. Looper Agent → **Split into CodingLoop (LoopAgent) + SinglePass (SequentialAgent)**

**Current**: Monolithic loop controller with inline Coder→Review→Judge execution
**New Design**: Two-layer architecture

### 2a. CodingLoop (extends LoopAgent)

**Location**: `packages/agents/devhub/looper/CodingLoop.ts`

**Responsibilities**:
- Command parsing (start/stop/status/add_pending)
- Dual-path architecture (response + async execution)
- State management (IDLE/RUNNING, iteration count, task queue)
- Loop control (maxIterations, shouldStop)
- Call SinglePass each iteration
- Event collection (via EventCollector)
- Summarization orchestration (timer + threshold + completion)
- Emit looper:progress and looper:result events

**Dependencies**:
- SinglePass (SequentialAgent) - the work unit per iteration
- JudgeAgent - for shouldContinue() decision
- SummarizerAgent - for progress summaries
- EventCollector - for event buffering

**Key Methods**:
```typescript
class CodingLoop extends LoopAgent {
    protected readonly subAgents = [singlePassAgent];
    protected readonly maxIterations = 5;

    // Implement abstract method from LoopAgent
    protected async shouldContinue(iterationResult: string) {
        // Call JudgeAgent
        // Parse decision
        // Return { continue: boolean, nextTask?: string, reason: string }
    }

    // Override start() to handle commands
    start(userInput: string, context, sinks) {
        const command = parseCommand(userInput);
        // Response path: immediate response
        // Execution path: if command.type === 'start', launch runLoopAsync()
    }

    // Private: async loop execution
    private async runLoopAsync(initialTask: string) {
        while (iteration < maxIterations && !shouldStop) {
            // Call SinglePass.start()
            // Wait for completion
            // Call shouldContinue()
            // If continue: update task, next iteration
            // If terminate: emit result, exit
        }
    }
}
```

**Changes from current**:
- No longer directly calls Coder/Review/Judge
- Delegates one-iteration execution to SinglePass
- Simplified: loop control + state + summarization only

---

### 2b. SinglePass (extends SequentialAgent)

**Location**: `packages/agents/devhub/looper/SinglePass.ts`

**Responsibilities**:
- Execute Coder → Review → Judge in sequence
- Aggregate results (Judge's output is the iteration result)
- Forward events from child agents to parent (CodingLoop)

**Dependencies**:
- CoderAgent (PromptAgent)
- ReviewerAgent (PromptAgent)
- JudgeAgent (PromptAgent)

**Key Properties**:
```typescript
class SinglePass extends SequentialAgent {
    readonly id = 'single-pass';
    readonly description = 'Execute one iteration of Coder→Review→Judge';
    
    protected readonly subAgents = [coderAgent, reviewerAgent, judgeAgent];
    protected readonly failFast = false; // Continue to Judge even if Coder/Review fails
    protected readonly contextMode = 'none'; // Each agent uses original task

    // Override aggregateResults to return Judge's output
    protected aggregateResults(results: string[]): string {
        return results[2] || ''; // Judge is the 3rd agent
    }
}
```

**Changes from current**:
- New component (extracted from LooperGraphAgent.runLoopAsync)
- Makes single-iteration logic testable in isolation
- Clear responsibility: sequence only, no loop control

---

## 3. Command Parser → **Keep as-is**

**Current**: `command.ts` - parse JSON/NL into LooperCommand
**New Design**: No changes needed

**Why**: Pure utility, used by CodingLoop.start()

---

## 4. State Management → **Keep as-is**

**Current**: `state.ts` - define LooperState, factory, predicates
**New Design**: No changes needed

**Why**: Still used by CodingLoop (extends LoopAgent)

**Note**: State is now encapsulated in CodingLoop, not shared with SinglePass

---

## 5. Event Collector → **Keep as-is**

**Current**: `event-collector.ts` - buffer/truncate events, trigger threshold
**New Design**: No changes needed

**Why**: Still used by CodingLoop for summarization

**Integration**: CodingLoop listens to SinglePass's child agent events and feeds EventCollector

---

## 6. Judge Agent → **Dual Role**

**Current**: Standalone PromptAgent, called by Looper to decide continue/terminate
**New Design**: Used in TWO places

### 6a. As sub-agent in SinglePass
- Runs as the 3rd step in Coder→Review→Judge sequence
- Output is the iteration result

### 6b. As decision agent in CodingLoop
- CodingLoop.shouldContinue() calls Judge with:
  - Iteration result (from SinglePass)
  - Pending task queue
- Parses Judge output to get decision

**Question**: Should Judge be called TWICE per iteration?
**Answer**: NO. SinglePass should NOT include Judge.

### Corrected Design:
- **SinglePass** = Coder → Review only
- **CodingLoop.shouldContinue()** calls Judge separately after SinglePass completes

**Why**: Judge makes a meta-level decision (loop control), not a work-level task

### Updated SinglePass:
```typescript
class SinglePass extends SequentialAgent {
    protected readonly subAgents = [coderAgent, reviewerAgent]; // NO Judge
    
    protected aggregateResults(results: string[]): string {
        // Return combined Coder+Review output
        return JSON.stringify({ 
            coderOutput: results[0], 
            reviewOutput: results[1] 
        });
    }
}
```

### Updated CodingLoop.shouldContinue():
```typescript
protected async shouldContinue(iterationResult: string): Promise<...> {
    // iterationResult = SinglePass output (Coder + Review results)
    // Build Judge input:
    //   - Current task
    //   - Iteration count
    //   - Coder/Review results (from iterationResult)
    //   - Pending queue
    
    // Call JudgeAgent.start()
    // Parse output
    // Return { continue, nextTask, reason }
}
```

---

## 7. Summarizer Agent → **Keep as PromptAgent, called by CodingLoop**

**Current**: PromptAgent, called by Looper with event summaries
**New Design**: No changes to agent itself

**Integration**:
- CodingLoop listens to SinglePass→Coder/Review events
- EventCollector buffers events
- When threshold/timer triggers, CodingLoop calls Summarizer
- Emit summary as looper:progress

---

## 8. Workflow Tools → **Update to call CodingLoop**

**Current**: `workflows.ts` - defines `run_dev_loop` and `devhub_command_tool`
**New Design**: Update LooperBridge to instantiate CodingLoop

**Changes**:
```typescript
// Old
const looperAgent = await createLooperAgent({ taskManager });

// New
const looperAgent = await createCodingLoopAgent({ taskManager });
```

**Where**: `packages/agents/devhub/index.ts` (createAgent function)

---

## 9. Looper Bridge → **Update to use CodingLoop**

**Current**: Wraps LooperGraphAgent.start()
**New Design**: Wraps CodingLoop.start()

**No interface changes**: Bridge API remains the same

---

## 10. Child Agent Integration (Coder/Review) → **Update to use SequentialAgent**

**Current**: CodingLoop calls TaskManager.startBackground() for Coder/Review
**New Design**: SinglePass calls Coder/Review via SequentialAgent pattern

### Challenge:
- SequentialAgent.start() expects to call subAgent.start() directly
- Current implementation uses TaskManager.startBackground() for async execution

### Solution Options:

#### Option A: SinglePass calls agents directly (no TaskManager)
- Simpler, cleaner
- Loses async task tracking
- **Recommended if TaskManager is only for UI progress tracking**

#### Option B: Wrap TaskManager calls in adapter
- Keep TaskManager for observability
- SinglePass.start() internally uses TaskManager
- More complex

**Recommendation**: Option A (direct calls)
- SinglePass.start() calls coderAgent.start() directly
- CodingLoop manages summarization/events, not TaskManager

---

## Summary: New Component Structure

```
DevHub (PromptAgent)
  └─ CodingLoop (LoopAgent)
       ├─ SinglePass (SequentialAgent)
       │    ├─ CoderAgent (PromptAgent)
       │    └─ ReviewerAgent (PromptAgent)
       ├─ JudgeAgent (PromptAgent) - called by shouldContinue()
       ├─ SummarizerAgent (PromptAgent) - called periodically
       └─ EventCollector (utility)
```

---

## Migration Path (Ordered)

### Phase 1: Create SequentialAgent + LoopAgent base classes
- Already done: `packages/agents/workflow-agents/`

### Phase 2: Create SinglePass (SequentialAgent)
- New file: `packages/agents/devhub/looper/SinglePass.ts`
- Implement: Coder → Review sequence
- Test: Run one iteration in isolation

### Phase 3: Refactor LooperGraphAgent → CodingLoop (LoopAgent)
- Rename: `LooperGraphAgent` → `CodingLoop`
- Extend: `LoopAgent` base class
- Update: Use SinglePass instead of inline Coder/Review calls
- Implement: `shouldContinue()` with JudgeAgent
- Keep: Command parsing, state management, event collection, summarization

### Phase 4: Update DevHub entry point
- Update: `createLooperAgent()` to return CodingLoop
- Test: End-to-end flow

### Phase 5: Cleanup
- Remove: Old inline loop logic
- Update: Type definitions
- Add: Tests for SinglePass and CodingLoop

---

## Key Decisions

### 1. Judge placement
**Decision**: Judge is called by CodingLoop.shouldContinue(), NOT part of SinglePass
**Reason**: Judge makes loop-level decisions, not work-level outputs

### 2. TaskManager usage
**Decision**: Remove TaskManager from loop execution, call agents directly
**Reason**: Simplifies design, TaskManager was only for async tracking

### 3. Event flow
**Decision**: SinglePass emits events → CodingLoop listens → EventCollector
**Reason**: Maintains summarization without changing EventCollector

### 4. State encapsulation
**Decision**: State lives in CodingLoop only, not shared with SinglePass
**Reason**: Loop state is loop-level concern, SinglePass is stateless

---

## Benefits of New Design

1. **Testability**: SinglePass can be tested independently
2. **Clarity**: Clear separation of concerns (sequence vs loop)
3. **Reusability**: SinglePass can be used in other workflows
4. **Maintainability**: Easier to modify single-iteration logic
5. **Extensibility**: Easy to add new agents to sequence or change order
6. **Alignment**: Matches ADK/industry patterns for workflow composition
