# Bug: Duplicate System Message Rendering (Red Circle Marker)

**Date**: 2025-11-05  
**Status**: ✅ Fixed  
**Scope**: CLI UI Rendering Layer

---

## Problem Symptom

When an agent completes execution, the system message (red circle marker `🔴🔴🔴 RESULT EVENT BLOCKED`) is printed twice in the terminal:

```
✦ Hello world! How can I help you...

[i] 🔴🔴🔴 RESULT EVENT BLOCKED: cost=$0.003375... ← 1st occurrence
[i] 🔴🔴🔴 RESULT EVENT BLOCKED: cost=$0.003375... ← 2nd occurrence (duplicate)
[i] ◼︎ 2025-11-05T16:16:05.167Z
```

**Key Characteristics**:
- Only the "last newly added system message" is duplicated
- The 2nd duplicate appears simultaneously with the `◼︎` square marker
- Other messages (msg1-4) are not duplicated

---

## Root Cause

### 1. Message Order Change Triggers Ink Static Re-rendering

**Problem Chain**:
```typescript
// Initial state (message creation)
messages = [
  msg1 (system),
  msg2 (user),
  msg3 (assistant, isPending=true),  ← Placeholder
  msg4 (assistant, isPending=false), ← Streaming text
  msg5 (system, isPending=false)     ← Red circle
]

// version=7: After partitionMessages
frozen = [msg1, msg2, msg4, msg5]  // Skip pending msg3
active = [msg3]

// version=8: handleCompleted triggers finalizeConversation
// Old logic: mutateMessage(msg3, { isPending: false })
// Result: msg3's state changes, but physical position unchanged (index=2)

messages = [msg1, msg2, msg3, msg4, msg5]  // msg3 stays in place
frozen = [msg1, msg2, msg3, msg4, msg5]    // msg3 inserted in middle!
//                    ↑ Causes subsequent element index changes
```

**Duplicate Rendering Mechanism**:

1. **version=7→8**: Add red circle (msg5)
   - `messageStore.appendMessage(msg5)` → `emit('change')`
   - `useSyncExternalStore` listens → `getPartitionedMessages()`
   - ChatPanel renders: `frozenMessages = [1,2,4,5]`
   - Ink Static prints: msg1, msg2, msg4, **msg5(red circle)** ✅

2. **version=8→9**: Finalize placeholder (msg3)
   - `mutateMessage(msg3, isPending=false)` → `emit('change')`
   - `getPartitionedMessages()` → `frozen = [1,2,3,4,5]`
   - **Critical**: frozen array changes from `[1,2,4,5]` to `[1,2,3,4,5]`
   - msg3 inserts at index=2, causing position shift of subsequent elements
   - ChatPanel passes full `frozenMessages` to Ink Static
   - **Ink Static detects array structure change (length 4→5, order changed)**
   - Static re-prints all frozen items
   - Result: **msg5(red circle) is duplicated** ❌

3. **version=9→10**: Add square marker (msg6)
   - `appendMessage(msg6)` → `emit('change')`
   - `frozen = [1,2,3,4,5,6]`
   - Ink appends msg6, but may not re-duplicate msg5 due to render batching or optimization

### 2. Why Didn't React Key Prevent Duplication?

```typescript
// version=7 Static items
items = [
  <MessageComponent key="frozen-1" />,  // msg1
  <MessageComponent key="frozen-2" />,  // msg2
  <MessageComponent key="frozen-4" />,  // msg4
  <MessageComponent key="frozen-5" />,  // msg5 (red circle)
]

// version=8 Static items
items = [
  <MessageComponent key="frozen-1" />,  // msg1
  <MessageComponent key="frozen-2" />,  // msg2
  <MessageComponent key="frozen-3" />,  // msg3 ← Newly inserted
  <MessageComponent key="frozen-4" />,  // msg4
  <MessageComponent key="frozen-5" />,  // msg5 (red circle) ← Same key, but position changed
]
```

- **React key's role**: Identifies "which component", avoids unnecessary recreation
- **Ink Static's behavior**: Prints to terminal based on items array order
- **Issue**: React knows `key="frozen-5"` hasn't changed, but Ink sees the entire array structure changed. To maintain terminal output consistency with array order, it re-prints the entire group

---

## Two Fix Approaches Compared

### ❌ Approach A: Incremental Rendering in ChatPanel (Incomplete)

```typescript
const lastPrintedCountRef = React.useRef(0);

// Only pass newly added messages
const newFrozenMessages = frozenMessages.slice(lastPrintedCountRef.current);
lastPrintedCountRef.current = frozenMessages.length;

staticItems = [...newFrozenMessages.map(...)];
```

**Problem**:
```
// version=7: frozen=[1,2,4,5], lastPrinted=0
slice(0) = [1,2,4,5] → print 4 items → lastPrinted=4 ✅

// version=8: frozen=[1,2,3,4,5], lastPrinted=4
slice(4) = [5] → Only prints msg5 ❌ msg3 is skipped!
```

**Risk**:
- msg3's position in array is index=2 (earlier), but it's newly added to frozen
- `slice(4)` only takes tail elements, **msg3 will never be rendered**
- Coincidentally msg3 is an empty placeholder (`content=""`), so this bug wasn't exposed
- If msg3 had actual content (like reasoning), it would cause content loss

**Conclusion**: This approach only works when "all messages append to end", cannot handle "middle insertion" scenarios.

---

### ✅ Approach B: Preserve Frozen Append Order (Root Solution)

**Core Idea**: Ensure frozen array strictly sorts by "time of first entering frozen", avoiding middle insertion.

**Implementation**:
```typescript
// packages/cli/hooks/useAgentEventBridge.ts

const finalizeConversation = useCallback((tabId: string, updater?: (message: Message) => Message) => {
  const current = queue.shift()!;
  
  // Move message to end to preserve frozen append order
  const messages = messageStore.getMessagesForTab(tabId);
  const index = messages.findIndex(m => m.id === current.assistantMessageId);
  if (index !== -1) {
    const msg = messages[index];
    if (msg.isPending) {
      // 1. Remove from current position
      messageStore.removeMessage(tabId, current.assistantMessageId);
      
      // 2. Append to end
      const finalized = updater ? updater(msg) : {
        ...msg,
        isPending: false,
        queueState: 'completed' as const,
      };
      messageStore.appendMessage(tabId, finalized);
    }
  }
  // ...
}, [messageStore]);
```

**Effect**:
```
// version=7: After adding red circle
messages = [msg1, msg2, msg3(pending), msg4, msg5]
frozen = [msg1, msg2, msg4, msg5]
active = [msg3]

// version=8: Finalize msg3
// Execute removeMessage(msg3) → messages = [msg1, msg2, msg4, msg5]
// Execute appendMessage(msg3_done) → messages = [msg1, msg2, msg4, msg5, msg3]

frozen = [msg1, msg2, msg4, msg5, msg3]  ← msg3 at end!
active = []

// Key: frozen array changes from [1,2,4,5] to [1,2,4,5,3]
// - New item at end
// - msg5(red circle)'s position and index unchanged
// - Ink Static doesn't think it needs to re-print first 4 items
```

**Advantages**:
- ✅ frozen array strictly append-only, no middle insertion
- ✅ Red circle position stable, won't trigger duplicate rendering
- ✅ Even if msg3 has content, it will render correctly (at end)
- ✅ Matches terminal output intuition: sorted by "completion time"

---

## Key Log Analysis

### Timeline Triggering the Bug

```
[12:16:04 am.318] version=7: appendSystemMessage(red circle) completed
[MessageStore] frozen=[1,2,4,5] active=[3]
→ Ink prints red circle ✅

[12:16:05 am.167] version=8: finalizeConversation(msg3)
[MessageStore] frozen=[1,2,3,4,5] active=[]  ← msg3 inserted in middle
→ Ink re-prints all frozen → red circle duplicated ❌

[12:16:05 am.168] version=9: appendSystemMessage(square)
[MessageStore] frozen=[1,2,3,4,5,6] active=[]
→ Ink appends square ✅
```

### Timeline After Fix

```
[version=7] appendSystemMessage(red circle)
frozen=[1,2,4,5] active=[3]
→ Ink prints red circle ✅

[version=8] finalizeConversation(msg3)
removeMessage(3) → messages=[1,2,4,5]
appendMessage(3) → messages=[1,2,4,5,3]
frozen=[1,2,4,5,3] active=[]  ← msg3 at end!
→ Ink only appends msg3, doesn't duplicate red circle ✅

[version=9] appendSystemMessage(square)
frozen=[1,2,4,5,3,6] active=[]
→ Ink appends square ✅
```

---

## Lessons Learned

### 1. Ink Static Component Behavior Characteristics
- Static judges whether re-printing is needed based on items array **structure** (length, order)
- Even with same React keys, array order changes trigger re-printing
- Suitable scenario: **append-only** message streams

### 2. Incremental Rendering Pitfall
- `slice(lastCount)` only works with strict append
- Cannot handle "middle insertion" or "order changes"
- Appears effective but hides bugs (like msg3 being skipped)

### 3. State Machine Design Principles
- **Data structure should reflect business logic**: frozen should sort by "completion order" not "creation order"
- **Avoid in-place state mutation**: finalize should "delete + append", not "mutate state"
- **Maintain monotonicity**: frozen array should only grow, order unchanged

### 4. Debugging Techniques
- Add full dump of `getPartitionedMessages` (including message content)
- Record version changes and trigger reasons
- Compare UI phenomenon with Store state to find inconsistencies

---

## Related Files

- `packages/cli/hooks/useAgentEventBridge.ts` - finalizeConversation logic
- `packages/cli/store/MessageStore.ts` - removeMessage, appendMessage
- `packages/cli/components/ChatPanel.tsx` - Ink Static rendering

---

## References

- Ink Static documentation: https://github.com/vadimdemedes/ink#static
- React key mechanism: https://react.dev/learn/rendering-lists#keeping-list-items-in-order-with-key
