# 用户消息消失问题分析

## 1. 观察到的现象

### 发送消息前
```
> Mesa 1
✦ Hi! How can I help you with your Z-Work project today?
```

### 发送消息后（短暂显示）
```
> Mesa 1
✦ Hi! How can I help you with your Z-Work project today?
> 运行 shell 命令，检查文件的行数最大是多少
✦
```

### 权限提示出现后（2秒后）
```
> Mesa 1
✦ Hi! How can I help you with your Z-Work project today?
[权限提示框]
```

**关键现象：新发送的用户消息 "运行 shell 命令，检查文件的行数最大是多少" 消失了！**

## 2. isPending 的设计意图与实际作用

### isPending 的设计意图
- 标记消息为"待处理/排队中"状态
- 在 `finalizeActiveMessages()` 时，只移动**非 isPending** 的消息到 frozenMessages
- **保留 isPending 的消息**在 activeMessages 中，直到它们被处理完成

### isPending 当前在代码中的使用

#### 在 `startAgentPrompt` (716-830行)
```typescript
const userMessage: Types.Message = {
    id: nextMessageId(),
    role: 'user',
    content: rawInput,
    // ❌ 没有 isPending 标记！
};

const assistantPlaceholder: Types.Message = {
    id: assistantMessageId,
    role: 'assistant',
    content: '',
    reasoning: '',
    // ❌ 也没有 isPending 标记！
};
```

#### 在 `handleAgentPermissionRequest` (448-528行)
```typescript
finalizeActiveMessages();  // ⚠️ 这会移动所有非 isPending 的消息

const placeholderMessage: Types.Message = {
    id: placeholderMessageId,
    role: 'system',
    content: `[Agent] Waiting for permission #${requestId} on "${toolName}"…`,
    isPending: true,  // ✅ 这个有 isPending
};

// ⚠️ 这里又调用了一次 setActiveMessages，可能导致状态竞争
setActiveMessages(prev => [...prev.filter(msg => msg.isPending), placeholderMessage]);
```

#### 在 `finalizeActiveMessages` (325-340行)
```typescript
const finalizeActiveMessages = useCallback(() => {
    let completed: Types.Message[] = [];
    
    // 第1步：过滤掉非 isPending 的消息
    setActiveMessages(prev => {
        completed = prev.filter(msg => !msg.isPending);
        return prev.filter(msg => msg.isPending);
    });
    
    // 第2步：将 completed 消息添加到 frozenMessages
    if (completed.length > 0) {
        setFrozenMessages(prev => [...prev, ...completed]);
    }
}, []);
```

## 3. 问题的根本原因

### 问题1：消息没有 isPending 标记
- `startAgentPrompt` 创建的 `userMessage` 和 `assistantPlaceholder` **没有** `isPending` 标记
- 当 `handleAgentPermissionRequest` 调用 `finalizeActiveMessages()` 时，这两条消息被视为"已完成"
- 它们被**立即移动**到 `frozenMessages`

### 问题2：React 状态更新的竞争条件

在 `handleAgentPermissionRequest` 中：
```typescript
// 调用1：finalizeActiveMessages 内部
setActiveMessages(prev => prev.filter(msg => msg.isPending));  

// 调用2：handleAgentPermissionRequest 自己
setActiveMessages(prev => [...prev.filter(msg => msg.isPending), placeholderMessage]);
```

这两次 `setActiveMessages` 调用可能导致：
1. 如果 React 批处理状态更新，第二次调用的 `prev` 可能是**旧状态**
2. 第二次调用基于旧状态进行过滤，可能导致消息丢失或重复

### 问题3：为什么 frozenMessages 的更新没有显示？

理论上，消息被移动到 `frozenMessages` 后，应该被 `Static` 组件渲染出来。但有两种可能：

1. **状态更新竞争**：由于两次 `setActiveMessages` 调用的竞争，`finalizeActiveMessages` 中的 `setFrozenMessages` 可能基于错误的 `completed` 列表
2. **React 批处理**：多个状态更新被批处理时，中间状态可能不一致

## 4. 为什么 "Mesa 1" 始终可见？

"Mesa 1" 和 "Hi! How can I help..." 是**之前就已经在 frozenMessages** 中的消息，它们已经被 `Static` 组件永久打印到终端。

`Static` 组件的特性：
- 一旦内容被渲染，就会永久保留在终端
- 新增的 items 会被追加到下方
- 不会重新渲染已有内容

## 5. 解决方案

### 方案A：给消息添加 isPending 标记（推荐）

在 `startAgentPrompt` 中，给新创建的消息添加 `isPending: true`：

```typescript
const userMessage: Types.Message = {
    id: nextMessageId(),
    role: 'user',
    content: rawInput,
    isPending: true,  // ✅ 添加这个
};

const assistantPlaceholder: Types.Message = {
    id: assistantMessageId,
    role: 'assistant',
    content: '',
    reasoning: '',
    isPending: true,  // ✅ 添加这个
};
```

然后在适当的时机（比如流式响应开始时）移除 `isPending` 标记。

### 方案B：改进 finalizeActiveMessages 的实现

使用 React 的函数式更新，避免状态竞争：

```typescript
const finalizeActiveMessages = useCallback(() => {
    setActiveMessages(prev => {
        const completed = prev.filter(msg => !msg.isPending);
        const remaining = prev.filter(msg => msg.isPending);
        
        if (completed.length > 0) {
            setFrozenMessages(frozen => [...frozen, ...completed]);
        }
        
        return remaining;
    });
}, []);
```

### 方案C：在 handleAgentPermissionRequest 中避免重复调用

移除 `handleAgentPermissionRequest` 中的重复 `setActiveMessages` 调用：

```typescript
const placeholderMessage: Types.Message = {
    id: placeholderMessageId,
    role: 'system',
    content: `[Agent] Waiting for permission #${requestId} on "${toolName}"…`,
    isPending: true,
};

// ✅ 直接添加 placeholder，不要再次过滤
setActiveMessages(prev => [...prev, placeholderMessage]);
```

## 6. 推荐解决方案

结合方案A和方案B：

1. **在 `startAgentPrompt` 中给消息添加 `isPending: true`**
   - 防止消息在权限请求时被立即移动到 frozenMessages
   
2. **改进 `finalizeActiveMessages` 的实现**
   - 避免状态更新竞争
   
3. **在 `handleAgentPermissionRequest` 中简化逻辑**
   - 移除重复的过滤调用

这样可以确保：
- 用户消息和助手占位符在权限请求期间保持在 activeMessages 中
- 只有真正"完成"的消息才会被移动到 frozenMessages
- 避免状态更新的竞争条件

## 7. 已实施的修复

### 修改1：在 startAgentPrompt 中添加 isPending 标记
```typescript
const userMessage: Types.Message = {
    id: userMessageId,
    role: 'user',
    content: rawInput,
    isPending: true,  // ✅ 添加
};

const assistantPlaceholder: Types.Message = {
    id: assistantMessageId,
    role: 'assistant',
    content: '',
    reasoning: '',
    isPending: true,  // ✅ 添加
};
```

### 修改2：改进 finalizeActiveMessages 避免状态竞争
```typescript
const finalizeActiveMessages = useCallback(() => {
    setActiveMessages(prev => {
        const completed = prev.filter(msg => !msg.isPending);
        if (completed.length === 0) {
            return prev;
        }
        
        // ✅ 在同一个状态更新中处理，避免竞争
        if (completed.length > 0) {
            setFrozenMessages(frozen => [...frozen, ...completed]);
        }
        
        return prev.filter(msg => msg.isPending);
    });
}, []);
```

### 修改3：简化 handleAgentPermissionRequest
```typescript
// finalizeActiveMessages 已经过滤了非 isPending 的消息，这里直接追加即可
setActiveMessages(prev => [...prev, placeholderMessage]);
```

### 修改4：在流式响应时移除 isPending
```typescript
const updateAssistant = () => {
    setActiveMessages(prev =>
        prev.map(msg => {
            if (msg.id === assistantMessageId) {
                return { ...msg, content: assistantContent, reasoning: assistantReasoning, isPending: false };
            }
            if (msg.id === userMessageId) {
                return { ...msg, isPending: false };  // ✅ 移除 isPending
            }
            return msg;
        })
    );
};
```

### 修改5：在完成/错误时移除 isPending
```typescript
// 成功完成时
const completedMessages: Types.Message[] = [
    { ...userMessage, isPending: false },  // ✅ 移除 isPending
    {
        id: assistantMessageId,
        role: 'assistant',
        content: assistantContent,
        reasoning: assistantReasoning,
        isPending: false,  // ✅ 移除 isPending
    },
];

// 错误时
setFrozenMessages(prev => [...prev, { ...userMessage, isPending: false }]);  // ✅ 移除 isPending
```

## 8. 修复效果

修复后的行为：

1. **发送消息时**：
   - 用户消息和助手占位符被添加到 activeMessages，带有 `isPending: true`
   
2. **权限请求时**：
   - `finalizeActiveMessages()` 被调用，但因为消息有 `isPending: true`，它们**不会被移动**到 frozenMessages
   - 权限 placeholder 被添加到 activeMessages
   - 用户可以看到：用户消息 + 助手占位符 + 权限提示
   
3. **流式响应时**：
   - 第一次收到内容时，`isPending` 被设置为 `false`
   - 消息开始正常显示内容更新
   
4. **完成时**：
   - 消息被移动到 frozenMessages，`isPending` 确保为 `false`
   - 永久显示在 Static 区域

**关键改进：用户消息不再消失，在整个处理过程中保持可见！**

