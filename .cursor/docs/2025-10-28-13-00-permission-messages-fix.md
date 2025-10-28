# 权限消息显示问题修复

## 用户反馈的问题

**状态1（权限请求时）**：✅ 正确
```
> run ping google.com 3 times
✦
ℹ️ [Agent] Waiting for permission #2 on "Bash"… (queued)
[权限弹框]
```

**状态2（批准后）**：❌ 有问题
```
> run ping google.com 3 times
✦
ℹ️ [Agent] Approved permission #2 for "Bash".
```
- 缺少权限弹框的详细信息（command, input 等）

**状态3（Agent返回内容）**：❌ 有问题
```
> run ping google.com 3 times
✦ ## 📡 Ping Results...
```
- 权限框和操作信息都消失了

## 问题根源

1. **权限 placeholder 被删除**：
   ```typescript
   // 旧代码
   setActiveMessages(prev => prev.filter(msg => msg.id !== request.placeholderMessageId));
   ```
   权限批准后，placeholder 被直接删除，权限详情丢失

2. **只添加简单的操作消息**：
   ```typescript
   appendSystemMessage(`[Agent] Approved permission #${id}...`);
   ```
   只显示批准结果，不包含权限详情

3. **完成时没有包含权限消息**：
   ```typescript
   const completedMessages = [userMessage, assistantMessage];
   setFrozenMessages(prev => [...prev, ...completedMessages]);
   ```
   只移动用户和助手消息，权限消息被遗漏

## 修复方案

### 修复1：更新 placeholder 而不是删除

```typescript
const resolveAgentPermission = (...) => {
    // 更新 placeholder 消息，显示权限详情和操作结果
    if (request.placeholderMessageId !== undefined) {
        setActiveMessages(prev => prev.map(msg => {
            if (msg.id !== request.placeholderMessageId) {
                return msg;
            }
            
            let resultContent: string;
            if (decision.kind === 'allow') {
                const rememberNote = ...;
                // 包含完整的权限详情
                resultContent = `[Agent] Permission #${id} · ${toolName}\n\n${request.summary}\n\n✅ Approved${rememberNote}`;
            } else {
                resultContent = `[Agent] Permission #${id} · ${toolName}\n\n${request.summary}\n\n❌ Denied: ${reason}`;
            }
            
            // 移除 isPending 属性，这样不显示 (queued)，但也不会被立即 finalize
            const { isPending, ...msgWithoutPending } = msg;
            return {
                ...msgWithoutPending,
                content: resultContent,
            };
        }));
    }
};
```

**效果**：
- 权限消息被保留和更新，包含完整详情
- 移除 `isPending`，不显示 "(queued)"
- 消息保持在 activeMessages 中

### 修复2：完成时 finalize 所有消息

```typescript
const startAgentPrompt = async (...) => {
    try {
        // ... Agent 返回内容 ...
        
        // 更新 assistant 消息到最终状态
        setActiveMessages(prev =>
            prev.map(msg => (msg.id === assistantMessageId ? assistantMessage : msg))
        );

        // 将所有非 isPending 的消息移到 frozenMessages
        // 包括用户消息、助手消息、权限消息等
        finalizeActiveMessages();
        
        return true;
    } catch (error) {
        // 错误时也 finalize 所有消息
        finalizeActiveMessages();
        appendSystemMessage(`[Agent] Error: ${combinedMessage}`, true);
        return false;
    }
};
```

**效果**：
- 完成时，一次性移动所有消息（用户、助手、权限）到 frozenMessages
- 保证消息的完整性和顺序

## isPending 的状态变化

### 用户消息和助手消息
- 创建时：无 `isPending` 属性
- 处理中：保持无 `isPending`
- 完成：通过 `finalizeActiveMessages()` 移到 frozenMessages

### 权限消息
- 创建时：`isPending: true`（显示 "queued"）
- 操作后：移除 `isPending` 属性（不显示 "queued"）
- 完成：通过 `finalizeActiveMessages()` 移到 frozenMessages

## 修复后的完整流程

```
1. 发送消息
activeMessages:
  userMessage (无 isPending)
  assistantPlaceholder (无 isPending)

2. 权限请求
activeMessages:
  userMessage
  assistantPlaceholder
  permissionMessage (isPending: true, 显示 queued) ✅

3. 批准权限
activeMessages:
  userMessage
  assistantPlaceholder
  permissionMessage (无 isPending, 显示详情和结果) ✅

4. Agent 返回内容
activeMessages:
  userMessage
  assistantPlaceholder → assistantMessage (更新内容)
  permissionMessage ✅

5. 完成
finalizeActiveMessages() 被调用：
- 所有消息移到 frozenMessages
- activeMessages 清空

frozenMessages:
  [历史消息...]
  userMessage ✅
  assistantMessage ✅
  permissionMessage ✅
```

## 关键改进

1. ✅ 权限详情完整保留（包含 command, input 等）
2. ✅ 操作结果清晰显示（✅ Approved 或 ❌ Denied）
3. ✅ 所有消息按顺序累积显示，不会消失
4. ✅ 权限操作后不显示 "(queued)"
5. ✅ 完成后所有消息一起进入历史记录

