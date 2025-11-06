# Claude Agent SDK 集成架构

## 概述
TaskAgent 使用 `@anthropic-ai/claude-agent-sdk` 作为核心 AI 运行时。本文档描述集成架构、调用链路和 Session 管理机制。

## 核心文件位置
- `src/agent/runtime/runClaudeStream.ts` - SDK 调用封装层
- `src/agent/runtime/runPromptAgentStart.ts` - PromptAgent 运行时构建器
- `src/agent/flows/baseClaudeFlow.ts` - UI 流程封装（旧架构，重构后废弃）
- `src/agent/types.ts` - Agent 接口定义（RunnableAgent, PromptAgent）

## 调用链路

### 当前架构（重构前）
```
ui.tsx (React)
  ↓
createBaseClaudeFlow() 或 Driver.handler()
  ↓
runClaudeStream() 或 buildPromptAgentStart()
  ↓
query() from @anthropic-ai/claude-agent-sdk
```

### 目标架构（重构后）
```
CLI (Ink UI)
  ↓
TabExecutor
  ↓
MessageAdapter.createSinks()
  ↓
RunnableAgent.start()
  ↓
buildPromptAgentStart() [内部调用]
  ↓
runClaudeStream()
  ↓
query() from @anthropic-ai/claude-agent-sdk
  ↓
Event Bus ← 通过 MessageAdapter
```

## Session 管理机制

### Session 状态
```typescript
interface Session {
    id: string;              // UUID 或服务器返回的 session_id
    initialized: boolean;    // true = resume, false = new
}
```

### 三种 Session 模式

1. **New Session** (initialized=false)
   - 传递 `extraArgs: { 'session-id': sessionId }`
   - SDK 创建新会话
   - 服务器返回正式 session_id（通过 system event）

2. **Resume Session** (initialized=true)
   - 传递 `resume: sessionId`
   - 继续现有会话上下文

3. **Fork Session** (initialized=true + forkSession=true)
   - 传递 `resume: sessionId` + `forkSession: true`
   - 基于现有会话创建分支（用于后台任务）

### Session 初始化逻辑
```typescript
// runClaudeStream.ts 中的逻辑
if (session.initialized) {
    options.resume = session.id;
    log(`Using RESUME logic for session: ${session.id}`);
} else {
    options.extraArgs = { 'session-id': session.id };
    log(`Using EXTRA_ARGS (new session) logic for session: ${session.id}`);
}

if (queryOptions.forkSession) {
    options.forkSession = true;
}
```

## Agent 构建流程

### PromptAgent 基类
- 抽象类，定义 `getSystemPrompt()` 和 `getAgentDefinitions()` 等方法
- 子类实现特定的提示词和 sub-agent 配置

### buildPromptAgentStart() 作用
将 PromptAgent 适配为 RunnableAgent 接口：
1. 调用 adapter 的 `getPrompt()` 生成用户提示
2. 调用 `getSystemPrompt()` 获取系统提示
3. 调用 `getAgentDefinitions()` 获取 sub-agents
4. 包装 sinks（onText, onReasoning, onEvent 等）
5. 调用 `runClaudeStream()` 执行
6. 返回 ExecutionHandle（包含 cancel 和 sessionId）

### 典型 Agent 实现示例
```typescript
export class LogMonitor extends PromptAgent {
    getSystemPrompt(): string {
        return `You are a log monitoring agent...`;
    }
    
    getAgentDefinitions(): Record<string, AgentDefinition> | undefined {
        return undefined; // 无 sub-agents
    }
}

// 使用 buildPromptAgentStart 创建 start 方法
agent.start = buildPromptAgentStart({
    getPrompt: (input) => agent.getPrompt(input),
    getSystemPrompt: () => agent.getSystemPrompt(),
    getAgentDefinitions: () => agent.getAgentDefinitions(),
    getModel: () => agent.model
});
```

## 在重构架构中的定位

### Phase 3: Agent 统一化
- 保留 `runClaudeStream` 作为底层 SDK 封装
- 保留 `buildPromptAgentStart` 作为 PromptAgent 的运行时构建器
- **新增**: Agent 通过 Event Bus 输出，而非直接操作 UI

### Phase 6: MessageAdapter 集成
MessageAdapter 负责将 Agent 的 sinks 包装为 Event Bus 事件：
```typescript
// 旧方式（重构前）
sinks.onText(chunk) → setActiveMessages() → UI 直接更新

// 新方式（重构后）
sinks.onText(chunk) → eventBus.emit('agent:text') → MessageStore → UI 订阅更新
```

## 关键配置参数

### runClaudeStream 接受的参数
- `model`: 模型名称（从环境变量或 Agent 配置）
- `cwd`: 工作目录
- `canUseTool`: 权限控制函数
- `systemPrompt`: 系统提示（支持 preset: 'claude_code'）
- `agents`: Sub-agent 定义（Coordinator 模式）
- `allowedTools` / `disallowedTools`: 工具白/黑名单
- `permissionMode`: 权限模式
- `forkSession`: 是否 fork session

### Callbacks
- `onTextDelta`: 文本增量更新
- `onReasoningDelta`: 推理过程增量更新
- `onToolUse`: 工具调用开始
- `onToolResult`: 工具调用完成
- `onNonAssistantEvent`: 其他事件（system/user）
- `onSessionId`: 服务器返回的正式 session_id

## 重构注意事项

### 保留部分
✅ `runClaudeStream.ts` - 继续作为 SDK 封装层
✅ `buildPromptAgentStart.ts` - 继续作为 PromptAgent 构建器
✅ Session 管理逻辑 - 继续使用 new/resume/fork 机制

### 废弃部分
❌ `baseClaudeFlow.ts` - 被 MessageAdapter 替代（UI 解耦）
❌ Driver 的 `handleXxxInvocation` - 被 TabExecutor 替代

### 新增部分
➕ MessageAdapter 包装 sinks 为 Event Bus 事件
➕ Agent 通过 EventBus 输出（不直接操作 UI state）
➕ Session 存储可能需要持久化到 TabExecutionState

## 典型流程示例

### Story Agent 执行流程（重构后）
```
1. 用户在 Story tab 输入 "整理需求"
2. TabExecutor.execute('story', 'story', '整理需求')
3. AgentRegistry.create('story') → 创建 StoryAgent 实例
4. MessageAdapter.createSinks() → 包装 sinks
5. StoryAgent.start() 内部调用 buildPromptAgentStart()
6. buildPromptAgentStart() 调用 runClaudeStream()
7. runClaudeStream() 调用 query() [Claude Agent SDK]
8. SDK 返回流式事件 → onTextDelta callback
9. MessageAdapter.onText() → eventBus.emit('agent:text')
10. CLI 订阅 'agent:text' → messageStore.appendMessage()
11. Screen 过滤 selectedTab 消息 → 渲染
```

## 监控和日志

### runClaudeStream 的日志
- `[Agent-PreQuery]`: 查询参数和提示
- `[Agent] Event #N type=X`: 每个 SDK 事件
- `[Agent] ▲ text delta`: 文本增量
- `[Agent] ▲ reasoning delta`: 推理增量
- `[ToolUse] start id=X name=Y`: 工具调用开始
- `[ToolResult] id=X duration_ms=Y`: 工具调用完成
- `[Agent] Stream summary`: 流式统计

### 性能指标
- `assistantChars`: 总文本字符数
- `reasoningChars`: 总推理字符数
- `eventCount`: 事件总数
- `firstEventMillis`: 首个事件延迟
- `firstAssistantMillis`: 首个助手消息延迟
- `totalDurationMillis`: 总耗时
