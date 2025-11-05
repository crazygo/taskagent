# Tool Call Visibility Implementation

## Date
2025-11-05 10:15

## Problem
Users couldn't see tool calls during long-running agent operations, leading to poor UX. Additionally, message ordering was incorrect - permission messages appeared before assistant text even though they occurred later.

## Root Cause
1. **Message Ordering**: Assistant text chunks were accumulated in `activeMessages` (pending) while permission messages were immediately moved to `frozenMessages`, causing display order violations
2. **Tool Visibility**: Tool use/result events were logged but not rendered in the UI

## Solution

### 1. Fix Message Ordering (方案1: Immediate Freezing)
**File**: `packages/cli/main.tsx` (lines 949-1024)

Changed `onText` callback from accumulation mode to immediate freezing:
- **Before**: All text chunks added to single message with `isPending: true`, finalized at end
- **After**: Each text chunk creates independent message, immediately added to `frozenMessages`
- **Rationale**: User confirmed each chunk is a complete sentence, not fragments

```typescript
onText: (chunk: string) => {
    if (!chunk.trim()) return;
    const textMessage: Types.Message = {
        id: nextMessageId(),
        role: 'assistant',
        content: chunk,
        timestamp: Date.now(),
    };
    setFrozenMessages(prev => [...prev, textMessage]);
}
```

### 2. Extend Message Type
**File**: `packages/cli/types.ts` (lines 1-17)

Added tool-specific message roles and fields:
- Roles: `'tool_use'` | `'tool_result'`
- Fields: `toolName`, `toolId`, `toolDescription`, `durationMs`

### 3. Implement onEvent Callback
**File**: `packages/cli/main.tsx` (lines 978-1012)

Parse TaskEvent messages from `runPromptAgentStart.ts`:
- Pattern `"Tool: {name} - {description}"` → create `tool_use` message
- Pattern `"Tool {name} completed (Xs)"` → create `tool_result` message
- All tool messages immediately frozen to maintain chronological order

### 4. Render Tool Messages
**File**: `packages/cli/components/ChatPanel.tsx` (lines 50-77)

Added rendering logic for tool calls:
- **Tool Use**: 🔧 cyan color, shows name + description
- **Tool Result**: ✓ green color, shows name + duration

```typescript
if (message.role === 'tool_use') {
    return (
        <Box paddingLeft={1} flexDirection="row">
            <Text color="cyan">🔧 {message.toolName}</Text>
            {message.toolDescription && <Text color="gray"> - {message.toolDescription}</Text>}
        </Box>
    );
}
```

## Expected Behavior

**Before:**
```
ℹ️ [Permission #1] ... ✅ Approved
ℹ️ [Permission #2] ... ✅ Approved
ℹ️ [Permission #3] ... ✅ Approved
✦ Assistant text (all accumulated at end)
```

**After:**
```
ℹ️ [Permission #1] ... ✅ Approved
🔧 Bash - List project files
✓ Bash completed (0.1s)
✦ Assistant text about results
ℹ️ [Permission #2] ... ✅ Approved
🔧 Read - Check package.json
✓ Read completed (0.05s)
✦ More assistant text
```

## Testing
- Run agent command with tool calls: `yarn start -- --story -p "list my folder"`
- Verify tools appear in real-time as separate messages
- Confirm chronological order maintained between permissions, tools, and text

## Files Modified
1. `packages/cli/types.ts` - Extended Message type
2. `packages/cli/main.tsx` - Fixed message ordering, implemented onEvent
3. `packages/cli/components/ChatPanel.tsx` - Added tool message rendering

## Notes
- User confirmed text chunks are complete sentences (not fragments)
- Immediate freezing prevents accumulation delay
- Tool events parsed from existing TaskEvent infrastructure
- No changes to backend/agent logic needed

