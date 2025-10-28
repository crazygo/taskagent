# 普通消息 AI 回应消失问题分析

## 用户反馈

发送普通消息（不会触发工具调用、权限类），看到 AI 回应的消息后**很快就消失了**。

## Git Diff 关键变化

### 变化1：`startAgentPrompt` 完成逻辑的修改

**旧代码（直接操作）**：
```typescript
const completedMessages: Types.Message[] = [
    userMessage,
    {
        id: assistantMessageId,
        role: 'assistant',
        content: assistantContent,
        reasoning: assistantReasoning,
    },
];

setFrozenMessages(prev => [...prev, ...completedMessages]);
```

**新代码（分两步）**：
```typescript
const assistantMessage: Types.Message = {
    id: assistantMessageId,
    role: 'assistant',
    content: assistantContent,
    reasoning: assistantReasoning,
};

// 步骤1：先更新 assistant 消息到最终状态
setActiveMessages(prev =>
    prev.map(msg => (msg.id === assistantMessageId ? assistantMessage : msg))
);

// 步骤2：将所有非 isPending 的消息移到 frozenMessages
finalizeActiveMessages();
```

### 变化2：`finalizeActiveMessages` 的实现

```typescript
const finalizeActiveMessages = useCallback(() => {
    let completed: Types.Message[] = [];
    setActiveMessages(prev => {
        // 过滤出非 isPending 的消息
        completed = prev.filter(msg => !msg.isPending);
        // 只保留 isPending 的消息
        return prev.filter(msg => msg.isPending);
    });
    if (completed.length > 0) {
        setFrozenMessages(prev => [...prev, ...completed]);
    }
}, []);
```

### 变化3：finally 块依然存在

```typescript
finally {
    setActiveMessages(prev => prev.filter(msg => msg.isPending));
    setIsAgentStreaming(false);
    ...
}
```

## 问题根源分析

### 问题1：React 状态更新的批处理和时序问题 ⚠️

完成时的代码执行顺序：
```typescript
// 调用1：更新 assistant 消息
setActiveMessages(prev =>
    prev.map(msg => (msg.id === assistantMessageId ? assistantMessage : msg))
);

// 调用2：finalizeActiveMessages 内部
setActiveMessages(prev => {
    completed = prev.filter(msg => !msg.isPending);  // ← 这里的 prev 是什么？
    return prev.filter(msg => msg.isPending);
});

// 调用3：finalizeActiveMessages 内部
setFrozenMessages(prev => [...prev, ...completed]);

// 调用4：finally 块
setActiveMessages(prev => prev.filter(msg => msg.isPending));  // ← 这里又过滤一次
```

**React 状态更新规则：**
- `setState` 是异步的
- 多个 `setState` 调用会被批处理
- 函数式更新 `setState(prev => ...)` 中的 `prev` 是**基于上一个排队的更新结果**

**但是问题来了：**

调用2（finalizeActiveMessages 内部）执行时：
- 它的 `prev` **应该**是调用1更新后的结果
- 但由于调用2和调用3是在 `finalizeActiveMessages` 内部，是**同步**执行的
- `completed` 变量在调用2中捕获，在调用3中使用
- 这个 `completed` 可能包含更新后的 assistant 消息，也可能不包含（取决于调用1是否生效）

调用4（finally 块）执行时：
- 它的 `prev` 应该是调用2的结果（已经过滤掉非 isPending 的消息）
- 所以这一步理论上不会改变什么

### 问题2：状态更新的外部闭包变量 ⚠️⚠️⚠️

```typescript
const finalizeActiveMessages = useCallback(() => {
    let completed: Types.Message[] = [];  // ← 闭包变量
    
    // setState 1: 安排异步更新
    setActiveMessages(prev => {
        completed = prev.filter(msg => !msg.isPending);  // ← 捕获到闭包
        return prev.filter(msg => msg.isPending);
    });
    
    // setState 2: 立即使用闭包变量
    if (completed.length > 0) {
        setFrozenMessages(prev => [...prev, ...completed]);  // ← 使用闭包变量
    }
}, []);
```

**这是一个经典的 React 状态更新陷阱！**

虽然 React 保证函数式更新的 `prev` 是最新的，但是：
1. `setActiveMessages` 的回调函数会立即同步执行（用于计算新状态）
2. `completed` 变量会被立即赋值
3. 然后 `setFrozenMessages` 使用这个 `completed`

**看起来没问题？**

但是，当 `finalizeActiveMessages()` 被调用时：
```typescript
// 调用1：更新 assistant 消息
setActiveMessages(prev => prev.map(...));  // ← 安排更新A

// 调用2：finalizeActiveMessages
finalizeActiveMessages();  // ← 这里面的 prev 能看到更新A吗？
```

**答案是：能！** React 保证函数式更新能看到前面排队的更新。

**那为什么消息会消失？**

### 问题3：真正的问题 - 消息没有 userMessage！ 🔴

让我重新看完成时的代码：

```typescript
// 更新 assistant 消息
setActiveMessages(prev =>
    prev.map(msg => (msg.id === assistantMessageId ? assistantMessage : msg))
);

// finalize
finalizeActiveMessages();
```

`finalizeActiveMessages()` 会把所有非 isPending 的消息移到 frozenMessages。

但是，**只更新了 assistantMessage**！`userMessage` 呢？

让我检查 `userMessage` 和 `assistantPlaceholder` 的创建：

```typescript
const userMessage: Types.Message = {
    id: userMessageId,
    role: 'user',
    content: rawInput,
    // ← 没有 isPending
};

const assistantPlaceholder: Types.Message = {
    id: assistantMessageId,
    role: 'assistant',
    content: '',
    reasoning: '',
    // ← 没有 isPending
};

setActiveMessages(prev => {
    const retainedPending = prev.filter(msg =>
        msg.isPending && !(pendingMessageIds?.includes(msg.id))
    );
    return [...retainedPending, userMessage, assistantPlaceholder];
});
```

所以 activeMessages 中有：
- `userMessage` (无 isPending)
- `assistantPlaceholder` (无 isPending)

在完成时：
```typescript
// 更新 assistant 到最终状态
setActiveMessages(prev =>
    prev.map(msg => (msg.id === assistantMessageId ? assistantMessage : msg))
);
```

现在 activeMessages 中有：
- `userMessage` (无 isPending)
- `assistantMessage` (最终内容，无 isPending)

然后调用 `finalizeActiveMessages()`：
```typescript
setActiveMessages(prev => {
    completed = prev.filter(msg => !msg.isPending);  // ← [userMessage, assistantMessage]
    return prev.filter(msg => msg.isPending);  // ← []
});
setFrozenMessages(prev => [...prev, ...completed]);  // ← 添加 [userMessage, assistantMessage]
```

这看起来是对的！消息应该被移到 frozenMessages。

**那为什么会消失？**

### 问题4：时间窗口 - 消息短暂显示然后消失 🔴🔴🔴

用户说"看到 AI 回应的消息后**很快就消失了**"，说明：
1. 消息确实被渲染了
2. 然后消失了

这说明：
1. 消息被添加到 frozenMessages（所以能看到）
2. 但又被移除或隐藏了

**可能的原因：**

在 `finalizeActiveMessages` 中：
```typescript
let completed: Types.Message[] = [];

setActiveMessages(prev => {
    completed = prev.filter(msg => !msg.isPending);
    return prev.filter(msg => msg.isPending);
});

if (completed.length > 0) {
    setFrozenMessages(prev => [...prev, ...completed]);
}
```

如果在调用 `finalizeActiveMessages()` 之前，`setActiveMessages(prev => prev.map(...))` 的更新还没生效，那么：
- `completed` 可能只包含旧的 assistantPlaceholder（空内容）
- 或者因为某种状态不一致，assistant 消息丢失

**或者，更可能的是：**

在完成后，somewhere 又调用了某个函数，导致消息被错误处理。

让我检查是否有其他地方会影响...

**等等！我发现了！**

看这个：
```typescript
finally {
    setActiveMessages(prev => prev.filter(msg => msg.isPending));
    ...
}
```

这一行会把所有非 isPending 的消息从 activeMessages 中移除。

但是，如果 `finalizeActiveMessages()` 的更新还没生效（消息还没真正移到 frozenMessages），这一行就会导致消息丢失！

## 总结

**问题根源：状态更新的时序不确定性**

```typescript
// 完成时
setActiveMessages(prev => prev.map(...));     // 更新1：更新 assistant
finalizeActiveMessages();                      // 更新2+3：移动到 frozenMessages
// finally
setActiveMessages(prev => prev.filter(...));  // 更新4：清空 activeMessages
```

虽然 React 保证函数式更新的 `prev` 是正确的，但是：
1. 更新1、2、3、4 被批处理
2. 在某些情况下（可能是 React 的批处理策略），更新2+3 可能没有正确捕获更新1的结果
3. 或者，更新3（setFrozenMessages）和更新4（清空 activeMessages）的顺序导致问题

**关键问题：外部闭包变量 `completed` 的使用，破坏了状态更新的原子性**

`finalizeActiveMessages` 试图在一个函数中完成两个状态更新：
1. 从 activeMessages 移除消息
2. 添加到 frozenMessages

但它使用了外部闭包变量 `completed` 来传递数据，这在 React 的异步更新模型中是**不安全**的。

