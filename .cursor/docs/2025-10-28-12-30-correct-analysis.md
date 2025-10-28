# 用户消息消失问题的正确分析

## 用户的真实诉求

1. **不显示 (queued)**：只有真正排队等待时才显示
2. **消息始终可见**：从发送到完成的全过程中保持可见
3. **完整对话流**：发送 → 权限提示 → 操作结果 → AI 输出，全程可见

## 当前问题

我的修改添加了 `isPending: true`，导致所有消息都显示 "(queued)"：
```
> 运行 ping google.com 5 times (queued)  ❌
✦   (queued)  ❌
ℹ️ [Agent] Waiting for permission #1 on "Bash"… (queued)  ❌
```

## 真正的根本原因

**问题不在于是否添加 isPending，而在于 `handleAgentPermissionRequest` 错误地调用了 `finalizeActiveMessages()`！**

```typescript
const handleAgentPermissionRequest = useCallback((...) => {
    finalizeActiveMessages();  // ❌ 这里不应该调用！
    
    const placeholderMessage = { ... isPending: true };
    setActiveMessages(prev => [...prev, placeholderMessage]);
}, []);
```

**为什么不应该调用？**
- `finalizeActiveMessages` 的作用是把"已完成"的消息移到 frozenMessages
- 但在权限请求时，用户消息和助手占位符**还没有完成**
- 过早调用导致消息被错误地移动，造成显示问题

## 正确的流程

### 期望的消息状态变化

**阶段1：发送消息**
```
activeMessages: [
  { role: 'user', content: '运行 ping...', isPending: undefined },
  { role: 'assistant', content: '', isPending: undefined }
]
frozenMessages: [历史消息]
```

**阶段2：权限请求**
```
activeMessages: [
  { role: 'user', content: '运行 ping...' },
  { role: 'assistant', content: '' },
  { role: 'system', content: 'Waiting for permission...', isPending: true }  // 只有这个有 isPending
]
frozenMessages: [历史消息]
```

**阶段3：权限批准**
```
activeMessages: [
  { role: 'user', content: '运行 ping...' },
  { role: 'assistant', content: '' }
]
frozenMessages: [历史消息, 权限批准消息]
```

**阶段4：Agent 返回内容**
```
activeMessages: [
  { role: 'user', content: '运行 ping...' },
  { role: 'assistant', content: '正在执行...' }
]
frozenMessages: [历史消息, 权限批准消息]
```

**阶段5：完成**
```
activeMessages: []
frozenMessages: [历史消息, 权限批准消息, 用户消息, 助手消息]
```

## 正确的解决方案

1. **移除用户/助手消息的 `isPending` 标记**（恢复到修改前的状态）
2. **移除 `handleAgentPermissionRequest` 中的 `finalizeActiveMessages()` 调用**（关键修复！）
3. **只给权限提示消息添加 `isPending: true`**

这样：
- 用户消息和助手消息不显示 (queued)
- 权限提示消息显示 (queued)，表示"等待操作"
- 权限提示消息在操作后被正确移除
- 所有对话消息保持在 activeMessages 中可见，直到真正完成

## 为什么之前会消失？

之前的代码在权限请求时错误地调用了 `finalizeActiveMessages()`，导致：
1. 用户消息和助手占位符被**过早地**移到 frozenMessages
2. 由于 React 状态更新的批处理和时序问题，消息可能在移动过程中丢失
3. 或者虽然移到了 frozenMessages，但 Static 组件的更新时机不对，导致显示异常

**真正的 bug 是 `finalizeActiveMessages()` 在权限请求时被错误地调用了！**

## 已实施的修复

### 修改1：回滚 isPending 标记
```typescript
const userMessage: Types.Message = {
    id: userMessageId,
    role: 'user',
    content: rawInput,
    // ✅ 移除了 isPending: true
};

const assistantPlaceholder: Types.Message = {
    id: assistantMessageId,
    role: 'assistant',
    content: '',
    reasoning: '',
    // ✅ 移除了 isPending: true
};
```

### 修改2：移除权限请求时的 finalizeActiveMessages 调用
```typescript
const handleAgentPermissionRequest = useCallback((...) => {
    // ✅ 移除了 finalizeActiveMessages() 调用
    
    const placeholderMessage: Types.Message = {
        id: placeholderMessageId,
        role: 'system',
        content: `[Agent] Waiting for permission #${requestId} on "${toolName}"…`,
        isPending: true,  // ✅ 只有这个有 isPending
    };
    setActiveMessages(prev => [...prev, placeholderMessage]);
}, []);
```

### 修改3：简化 updateAssistant
```typescript
const updateAssistant = () => {
    setActiveMessages(prev =>
        prev.map(msg =>
            msg.id === assistantMessageId
                ? { ...msg, content: assistantContent, reasoning: assistantReasoning }
                : msg
        )
    );
};
```

### 修改4：改进 appendSystemMessage，支持不 finalize
```typescript
const appendSystemMessage = (content: string, boxed = false, shouldFinalize = true) => {
    if (shouldFinalize) {
        finalizeActiveMessages();  // 只在需要时 finalize
    }
    const systemMessage = { ... };
    if (shouldFinalize) {
        setFrozenMessages(prev => [...prev, systemMessage]);  // 添加到历史
    } else {
        setActiveMessages(prev => [...prev, systemMessage]);  // 添加到活动区域
    }
};
```

### 修改5：权限操作消息不触发 finalize
```typescript
// 权限批准/拒绝时，不 finalize，消息添加到 activeMessages
appendSystemMessage(`[Agent] Approved permission #${id}...`, false, false);
appendSystemMessage(`[Agent] Denied permission #${id}...`, false, false);
```

**为什么需要这个修改？**
- 如果权限操作时 finalize，会把 userMessage 和 assistantPlaceholder 移到 frozenMessages
- 然后 Agent 继续返回内容，但 assistantPlaceholder 已经不在 activeMessages 里了，无法更新
- 通过不 finalize，所有消息保持在 activeMessages 中，Agent 可以继续更新 assistantPlaceholder

## 修复后的效果

**用户看到的流程：**

```
1. 发送消息
activeMessages:
  > 运行 ping google.com 5 times  ✅ 无 (queued)
  ✦   ✅ 无 (queued)

2. 权限请求
activeMessages:
  > 运行 ping google.com 5 times  ✅ 消息保留
  ✦   ✅ 占位符保留
  ℹ️ [Agent] Waiting for permission #1 on "Bash"… (queued)  ✅ 只有这个有 (queued)
[权限弹框]

3. 批准权限
activeMessages:
  > 运行 ping google.com 5 times  ✅ 消息保留
  ✦   ✅ 占位符保留
  ℹ️ [Agent] Approved permission #1 for "Bash".  ✅ 操作结果显示

4. Agent 返回内容
activeMessages:
  > 运行 ping google.com 5 times  ✅ 消息保留
  ✦ PING google.com (142.250.185.46)...  ✅ 内容实时更新

5. 完成
所有消息移到 frozenMessages，永久显示在历史区域
```

**关键改进：**
- ✅ 用户消息和 AI 消息不再显示 (queued)
- ✅ 权限操作结果显示在活动区域，不触发提前 finalize
- ✅ assistantPlaceholder 保持在 activeMessages 中，可以持续更新
- ✅ 完整的对话流程清晰呈现，所有消息保持可见

