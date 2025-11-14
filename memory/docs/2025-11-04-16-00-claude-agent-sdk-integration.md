# Claude Agent SDK 集成架构

**日期**: 2025-11-04 16:00  
**来源**: Serena MCP 命名记忆 `claude-agent-sdk-integration`  
**目的**: 详细描述 TaskAgent 与 Claude Agent SDK 交互的上下游逻辑

---

## 📋 概述

TaskAgent 使用 `@anthropic-ai/claude-agent-sdk` 作为核心 AI 运行时。本文档描述：
- SDK 调用链路
- Session 管理机制（new/resume/fork）
- Agent 构建流程
- 在重构架构中的定位

---

## 📂 核心文件位置

| 文件路径 | 作用 | 状态 |
|---------|------|------|
| `src/agent/runtime/runClaudeStream.ts` | SDK 调用封装层，处理流式事件 | ✅ 保留 |
| `src/agent/runtime/runPromptAgentStart.ts` | PromptAgent 运行时构建器 | ✅ 保留 |
| `src/agent/flows/baseClaudeFlow.ts` | UI 流程封装（直接操作 UI state） | ❌ 废弃 |
| `src/agent/types.ts` | Agent 接口定义 | ✅ 保留并扩展 |

---

## 🔄 调用链路

### 当前架构（重构前）

```
┌─────────────────────────────────────────────────┐
│              ui.tsx (React)                      │
│  - handleSubmit()                               │
│  - setActiveMessages()                          │
│  - finalizeMessageById()                        │
└──────────────┬──────────────────────────────────┘
               │
               ├─► createBaseClaudeFlow()  [Chat Mode]
               │     ↓
               │   runClaudeStream()
               │
               └─► Driver.handler()        [Driver Mode]
                     ↓
                   buildPromptAgentStart()
                     ↓
                   runClaudeStream()
                     ↓
┌──────────────────────────────────────────────────┐
│   query() from @anthropic-ai/claude-agent-sdk    │
│   - 流式返回 assistant/tool/user/system 事件     │
└──────────────────────────────────────────────────┘
```

### 目标架构（重构后）

```
┌─────────────────────────────────────────────────┐
│           CLI (Ink UI)                           │
│  - EventBus 订阅                                │
│  - MessageStore 更新                            │
└──────────────┬──────────────────────────────────┘
               │ Event Bus (解耦桥梁)
┌──────────────▼──────────────────────────────────┐
│          TabExecutor                             │
│  - execute(tabId, agentId, userInput)           │
└──────────────┬──────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────┐
│       MessageAdapter                             │
│  - createSinks() → 包装为 Event Bus 事件        │
└──────────────┬──────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────┐
│       RunnableAgent.start()                      │
│  - Story/Glossary/Monitor 等                    │
└──────────────┬──────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────┐
│   buildPromptAgentStart() [内部调用]            │
│  - 构建 prompt                                  │
│  - 配置 systemPrompt 和 agents                  │
└──────────────┬──────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────┐
│        runClaudeStream()                         │
│  - 封装 query() 调用                            │
│  - 处理流式事件                                 │
│  - 统计性能指标                                 │
└──────────────┬──────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────┐
│   query() from @anthropic-ai/claude-agent-sdk    │
└──────────────┬──────────────────────────────────┘
               │ 流式事件
               ↓
     MessageAdapter → Event Bus
               ↓
         CLI 订阅更新 UI
```

---

## 🔐 Session 管理机制

### Session 状态定义

```typescript
interface Session {
    id: string;              // UUID 或服务器返回的 session_id
    initialized: boolean;    // true = resume, false = new
}
```

### 三种 Session 模式

#### 1️⃣ New Session (initialized=false)

**场景**: 首次启动 Agent，需要创建新会话

**SDK 参数**:
```typescript
{
    extraArgs: { 'session-id': sessionId }
}
```

**行为**:
- SDK 创建新的会话上下文
- 服务器返回正式 `session_id`（通过 `system` event）
- 客户端可以记录此 ID 用于后续 resume

**代码位置**: `src/agent/runtime/runClaudeStream.ts:81-82`

```typescript
options.extraArgs = { 'session-id': session.id };
log(`[Agent-RunClaudeStream] Using EXTRA_ARGS (new session) logic for session: ${session.id}`);
```

---

#### 2️⃣ Resume Session (initialized=true)

**场景**: 继续之前的会话，保留上下文

**SDK 参数**:
```typescript
{
    resume: sessionId
}
```

**行为**:
- SDK 恢复会话的完整上下文（历史消息、工具状态等）
- 用户无需重新提供背景信息

**代码位置**: `src/agent/runtime/runClaudeStream.ts:78-79`

```typescript
options.resume = session.id;
log(`[Agent-RunClaudeStream] Using RESUME logic for session: ${session.id}`);
```

---

#### 3️⃣ Fork Session (initialized=true + forkSession=true)

**场景**: 基于现有会话创建分支（用于后台任务）

**SDK 参数**:
```typescript
{
    resume: sessionId,
    forkSession: true
}
```

**行为**:
- 复制现有会话的上下文
- 创建独立的分支，互不影响
- 用于并发任务（如后台监控）

**代码位置**: `src/agent/runtime/runClaudeStream.ts:103-106`

```typescript
if (queryOptions.forkSession) {
    options.forkSession = true;
    log('[Agent-RunClaudeStream] forkSession=true enabled for resume');
}
```

---

### Session 流转示例

```
用户启动 Story Agent
  ↓
Session { id: 'uuid-123', initialized: false }
  ↓
SDK 创建新会话，返回 session_id: 'claude-session-abc'
  ↓
记录到 TabExecutionState (或持久化)
  ↓
用户继续在 Story tab 输入
  ↓
Session { id: 'claude-session-abc', initialized: true }
  ↓
SDK resume 会话，保留上下文
```

---

## 🏗️ Agent 构建流程

### PromptAgent 基类

**定义**: `src/agent/types.ts`

```typescript
export abstract class PromptAgent {
    abstract getSystemPrompt(): string | { type: 'preset'; preset: 'claude_code'; append?: string };
    
    abstract getAgentDefinitions?(): Record<string, AgentDefinition> | undefined;
    
    abstract getPrompt(userInput: string, ctx: { sourceTabId: string; workspacePath?: string }): string;
    
    getModel?(): string | undefined {
        return process.env.ANTHROPIC_MODEL;
    }
}
```

**作用**:
- 提供统一的 Agent 抽象
- 子类只需实现提示词和配置逻辑
- 无需关心 SDK 调用细节

---

### buildPromptAgentStart() 运行时构建器

**文件**: `src/agent/runtime/runPromptAgentStart.ts`

**作用**: 将 `PromptAgent` 适配为 `RunnableAgent` 接口

**核心步骤**:

```typescript
export function buildPromptAgentStart(adapter: {
    getPrompt: (userInput: string, ctx) => string;
    getSystemPrompt?: () => string | { type: 'preset'; preset: 'claude_code' };
    getAgentDefinitions?: () => Record<string, AgentDefinition> | undefined;
    getModel?: () => string | undefined;
}): (userInput, context, sinks) => ExecutionHandle {
    return (userInput, context, sinks) => {
        // 1. 准备 Session
        const session = context.session ?? { id: crypto.randomUUID(), initialized: false };
        
        // 2. 构建 Prompt
        const prompt = adapter.getPrompt(userInput, {
            sourceTabId: context.sourceTabId,
            workspacePath: context.workspacePath
        });
        
        // 3. 配置 Options
        const options = {
            model: adapter.getModel?.() || process.env.ANTHROPIC_MODEL,
            cwd: context.workspacePath,
            canUseTool: sinks.canUseTool,
            systemPrompt: adapter.getSystemPrompt?.() ?? { type: 'preset', preset: 'claude_code' },
            agents: adapter.getAgentDefinitions?.(),
            forkSession: context.forkSession
        };
        
        // 4. 包装 Sinks（转发到 runClaudeStream 的 callbacks）
        const callbacks = {
            onTextDelta: (chunk) => sinks.onText(chunk),
            onReasoningDelta: sinks.onReasoning,
            onSessionId: sinks.onSessionId,
            onToolUse: (event) => sinks.onEvent?.({ level: 'info', message: `Tool: ${event.name}` }),
            onToolResult: (event) => sinks.onEvent?.({ level: 'info', message: `Tool ${event.name} completed` })
        };
        
        // 5. 调用 runClaudeStream
        void runClaudeStream({ prompt, session, queryOptions: options, callbacks, log: addLog })
            .then(() => sinks.onCompleted?.())
            .catch((err) => sinks.onFailed?.(err.message));
        
        // 6. 返回 ExecutionHandle
        return {
            cancel: () => controller.abort(),
            sessionId: session.id
        };
    };
}
```

---

### 典型 Agent 实现示例

#### LogMonitor Agent

**文件**: `src/agents/log-monitor/LogMonitor.ts`

```typescript
export class LogMonitor extends PromptAgent {
    constructor(
        private logPath: string,
        private maxLines: number,
        private checkIntervalSeconds: number
    ) {
        super();
    }
    
    getSystemPrompt(): string {
        return `You are a log monitoring agent...`;
    }
    
    getAgentDefinitions(): undefined {
        return undefined; // 无 sub-agents
    }
    
    getPrompt(userInput: string): string {
        return `Monitor logs at ${this.logPath}, check every ${this.checkIntervalSeconds}s`;
    }
}

// 使用 buildPromptAgentStart 创建 start 方法
const monitor = new LogMonitor('debug.log', 100, 30);
monitor.start = buildPromptAgentStart({
    getPrompt: (input) => monitor.getPrompt(input),
    getSystemPrompt: () => monitor.getSystemPrompt(),
    getAgentDefinitions: () => monitor.getAgentDefinitions()
});
```

---

## 🎯 在重构架构中的定位

### Phase 3: Agent 统一化

**保留**:
- ✅ `runClaudeStream` 继续作为底层 SDK 封装
- ✅ `buildPromptAgentStart` 继续作为 PromptAgent 构建器
- ✅ `RunnableAgent` 接口定义

**新增**:
- ➕ Agent 通过 `EventBus` 输出（不直接操作 UI）
- ➕ `AgentRegistry` 统一管理所有 Agent 实例

**修改**:
```typescript
// 旧方式（重构前）
export class StoryAgent extends PromptAgent {
    // 可能会调用 context.setActiveMessages() 等 UI 方法
}

// 新方式（重构后）
export class StoryAgent extends PromptAgent {
    // 完全不知道 UI 存在
    // 只通过 sinks.onText() 等回调输出
}
```

---

### Phase 6: MessageAdapter 集成

**MessageAdapter 的作用**: 将 Agent 的 sinks 包装为 Event Bus 事件

```typescript
// packages/execution/MessageAdapter.ts
export class MessageAdapter {
    constructor(
        private tabId: string,
        private agentId: string,
        private eventBus: EventBus
    ) {}
    
    createSinks(): AgentSinks {
        return {
            onText: (chunk: string) => {
                this.eventBus.emit({
                    type: 'agent:text',
                    agentId: this.agentId,
                    tabId: this.tabId,
                    timestamp: Date.now(),
                    payload: { chunk },
                    version: '1.0'
                });
            },
            
            onReasoning: (reasoning: string) => {
                this.eventBus.emit({
                    type: 'agent:reasoning',
                    agentId: this.agentId,
                    tabId: this.tabId,
                    timestamp: Date.now(),
                    payload: { reasoning },
                    version: '1.0'
                });
            },
            
            onEvent: (event: TaskEvent) => {
                this.eventBus.emit({
                    type: 'agent:event',
                    agentId: this.agentId,
                    tabId: this.tabId,
                    timestamp: Date.now(),
                    payload: event,
                    version: '1.0'
                });
            },
            
            onCompleted: (fullText: string) => {
                this.eventBus.emit({
                    type: 'agent:completed',
                    agentId: this.agentId,
                    tabId: this.tabId,
                    timestamp: Date.now(),
                    payload: { fullText },
                    version: '1.0'
                });
            },
            
            onFailed: (error: string) => {
                this.eventBus.emit({
                    type: 'agent:failed',
                    agentId: this.agentId,
                    tabId: this.tabId,
                    timestamp: Date.now(),
                    payload: { error },
                    version: '1.0'
                });
            }
        };
    }
}
```

**对比**:

| 方式 | 旧架构（重构前） | 新架构（重构后） |
|------|----------------|----------------|
| **输出** | `sinks.onText(chunk)` → `setActiveMessages()` → UI 直接更新 | `sinks.onText(chunk)` → `eventBus.emit('agent:text')` → MessageStore → UI 订阅更新 |
| **耦合** | Agent 依赖 UI state | Agent 完全解耦 UI |
| **扩展** | 难以支持多 UI | 可轻松支持多 UI（Web/VSCode） |

---

## ⚙️ 关键配置参数

### runClaudeStream 接受的参数

**QueryOptions**:

| 参数 | 类型 | 作用 | 示例 |
|------|-----|------|------|
| `model` | `string \| undefined` | 模型名称 | `'claude-sonnet-4.5'` |
| `cwd` | `string` | 工作目录 | `'/path/to/workspace'` |
| `canUseTool` | `Function` | 权限控制函数 | 用户批准工具调用 |
| `systemPrompt` | `string \| object` | 系统提示 | `{ type: 'preset', preset: 'claude_code' }` |
| `agents` | `Record<string, AgentDefinition>` | Sub-agent 定义 | Coordinator 模式使用 |
| `allowedTools` | `string[]` | 工具白名单 | `['read_file', 'grep']` |
| `disallowedTools` | `string[]` | 工具黑名单 | `['run_terminal_cmd']` |
| `permissionMode` | `string` | 权限模式 | `'auto'` / `'manual'` |
| `forkSession` | `boolean` | 是否 fork session | `true` 用于后台任务 |

---

### Callbacks

| 回调 | 触发时机 | 参数 | 作用 |
|------|---------|------|------|
| `onTextDelta` | 收到文本增量 | `chunk: string` | 实时显示 Agent 输出 |
| `onReasoningDelta` | 收到推理增量 | `reasoning: string` | 显示思考过程 |
| `onToolUse` | 工具调用开始 | `ToolUseEvent` | 显示工具调用信息 |
| `onToolResult` | 工具调用完成 | `ToolResultEvent` | 显示工具结果 |
| `onNonAssistantEvent` | 其他事件 | `event: unknown` | 处理 system/user 事件 |
| `onSessionId` | 收到 session_id | `sessionId: string` | 记录正式 session ID |

---

## 🔧 重构注意事项

### ✅ 保留部分

| 文件/逻辑 | 状态 | 原因 |
|----------|------|------|
| `runClaudeStream.ts` | 保留 | 底层 SDK 封装，无需改动 |
| `buildPromptAgentStart.ts` | 保留 | PromptAgent 构建器，继续使用 |
| Session 管理逻辑 | 保留 | new/resume/fork 机制完善 |
| `RunnableAgent` 接口 | 保留并扩展 | 核心接口，可能增加 EventBus 参数 |

---

### ❌ 废弃部分

| 文件/逻辑 | 废弃原因 | 替代方案 |
|----------|---------|---------|
| `baseClaudeFlow.ts` | 直接操作 UI state（setActiveMessages） | MessageAdapter + Event Bus |
| `Driver.handler()` 中的 UI 操作 | 混合业务逻辑和 UI 操作 | TabExecutor 协调 |

**示例**:
```typescript
// ❌ 旧方式（废弃）
const handleStoryInvocation = async (context) => {
    context.setActiveMessages([...]);           // 直接操作 UI
    context.finalizeMessageById(id);            // 直接操作 UI
    await runAgent();
};

// ✅ 新方式
const StoryAgent = {
    start(userInput, context, sinks) {
        // Agent 不知道 UI 存在
        sinks.onText('...');                    // 输出通过 sinks
        sinks.onCompleted();
    }
};

// MessageAdapter 负责转换
adapter.createSinks() → eventBus.emit('agent:text') → UI 订阅
```

---

### ➕ 新增部分

| 组件 | 作用 | 位置 |
|------|------|------|
| MessageAdapter | 将 sinks 包装为 Event Bus 事件 | `packages/execution/MessageAdapter.ts` |
| EventBus | 解耦 Agent 和 UI | `packages/core/event-bus/EventBus.ts` |
| TabExecutionState | 存储 Session 状态 | `packages/execution/TabExecutionManager.ts` |

---

## 📊 典型流程示例

### Story Agent 执行流程（重构后）

```
┌─────────────────────────────────────────────────┐
│ 1. 用户在 Story tab 输入 "整理需求"              │
└──────────────┬──────────────────────────────────┘
               ↓
┌──────────────▼──────────────────────────────────┐
│ 2. CLI: handleSubmit()                          │
│    → TabExecutor.execute('story', 'story', ...)│
└──────────────┬──────────────────────────────────┘
               ↓
┌──────────────▼──────────────────────────────────┐
│ 3. TabExecutor                                   │
│    → AgentRegistry.create('story')              │
│    → 创建 StoryAgent 实例                       │
└──────────────┬──────────────────────────────────┘
               ↓
┌──────────────▼──────────────────────────────────┐
│ 4. MessageAdapter                                │
│    → createSinks() 包装 sinks                   │
└──────────────┬──────────────────────────────────┘
               ↓
┌──────────────▼──────────────────────────────────┐
│ 5. StoryAgent.start(userInput, context, sinks)  │
│    → 内部调用 buildPromptAgentStart()           │
└──────────────┬──────────────────────────────────┘
               ↓
┌──────────────▼──────────────────────────────────┐
│ 6. buildPromptAgentStart()                       │
│    → 构建 prompt                                │
│    → 配置 systemPrompt 和 agents                │
│    → 调用 runClaudeStream()                     │
└──────────────┬──────────────────────────────────┘
               ↓
┌──────────────▼──────────────────────────────────┐
│ 7. runClaudeStream()                             │
│    → 调用 query() [Claude Agent SDK]           │
└──────────────┬──────────────────────────────────┘
               ↓
┌──────────────▼──────────────────────────────────┐
│ 8. SDK 返回流式事件                              │
│    → 触发 onTextDelta callback                  │
└──────────────┬──────────────────────────────────┘
               ↓
┌──────────────▼──────────────────────────────────┐
│ 9. MessageAdapter.onText()                       │
│    → eventBus.emit({                            │
│        type: 'agent:text',                      │
│        agentId: 'story',                        │
│        tabId: 'story',                          │
│        payload: { chunk }                       │
│      })                                         │
└──────────────┬──────────────────────────────────┘
               ↓
┌──────────────▼──────────────────────────────────┐
│ 10. CLI 订阅 'agent:text'                       │
│     → messageStore.appendMessage(tabId, msg)    │
└──────────────┬──────────────────────────────────┘
               ↓
┌──────────────▼──────────────────────────────────┐
│ 11. Screen                                       │
│     → 过滤 selectedTab='story' 的消息           │
│     → 渲染到终端                                │
└──────────────────────────────────────────────────┘
```

---

## 📈 监控和日志

### runClaudeStream 的详细日志

**日志示例**:

```
[Agent-PreQuery] Full Options for query: {
  model: 'claude-sonnet-4.5',
  cwd: '/path/to/workspace',
  systemPrompt: { type: 'preset', preset: 'claude_code' },
  agents: { story_builder: {...} }
}
[Agent-PreQuery] Prompt (len=150):
User wants to organize requirements...

[Agent] Stream opened; awaiting events...
[Agent] Event #1 type=system (+0.123s)
[Agent] Event #2 type=assistant (+0.456s)
[Agent] Assistant blocks=2
[Agent] ▲ text delta len=15: "Let me help..."
[ToolUse] start id=toolu_abc name=read_file
[ToolUse] input full id=toolu_abc: {"target_file":"story.md"}
[Agent] Event #3 type=user (+2.345s)
[ToolResult] id=toolu_abc name=read_file duration_ms=1889
[ToolResult] out_len id=toolu_abc = 450
[Agent] Event #4 type=assistant (+2.567s)
[Agent] ▲ text delta len=200: "Based on the story..."
[Agent] Stream summary: events=4, assistant_chars=215, reasoning_chars=0, t=3.12s
[Agent] Response completed.
```

---

### 性能指标

`runClaudeStream` 返回的统计信息：

```typescript
interface RunClaudeStreamResult {
    assistantChars: number;          // 总文本字符数
    reasoningChars: number;          // 总推理字符数
    eventCount: number;              // 事件总数
    firstEventMillis?: number;       // 首个事件延迟 (ms)
    firstAssistantMillis?: number;   // 首个助手消息延迟 (ms)
    totalDurationMillis: number;     // 总耗时 (ms)
}
```

**监控指标**:
- `firstEventMillis < 500ms` → 网络良好
- `assistantChars / totalDurationMillis` → 生成速度（字符/秒）
- `eventCount` → 复杂度（工具调用次数）

---

## 🎓 关键设计决策

### 为什么保留 runClaudeStream？

**优势**:
1. ✅ 完整封装 Claude Agent SDK 的复杂性
2. ✅ 统一日志和性能监控
3. ✅ 支持 session 管理（new/resume/fork）
4. ✅ 可测试（不依赖 UI）

**替代方案的问题**:
- ❌ 直接调用 SDK → 缺乏监控和日志
- ❌ 每个 Agent 自己封装 → 重复代码

---

### 为什么使用 buildPromptAgentStart？

**优势**:
1. ✅ 统一 PromptAgent 的运行时构建
2. ✅ Agent 开发者只需关注提示词逻辑
3. ✅ 自动处理 session、sinks、错误等

**示例**:

```typescript
// 不用 buildPromptAgentStart（繁琐）
class MyAgent {
    start(userInput, context, sinks) {
        const session = context.session ?? { id: uuid(), initialized: false };
        const prompt = this.buildPrompt(userInput);
        const options = { model: ..., cwd: ..., systemPrompt: ... };
        
        void runClaudeStream({ prompt, session, queryOptions: options, callbacks: {
            onTextDelta: (chunk) => sinks.onText(chunk),
            // ... 更多 callback 包装
        }}).then(() => sinks.onCompleted()).catch((e) => sinks.onFailed(e));
        
        return { cancel: () => {}, sessionId: session.id };
    }
}

// 使用 buildPromptAgentStart（简洁）
class MyAgent extends PromptAgent {
    getSystemPrompt() { return '...'; }
    getPrompt(input) { return '...'; }
}

myAgent.start = buildPromptAgentStart({
    getPrompt: (input) => myAgent.getPrompt(input),
    getSystemPrompt: () => myAgent.getSystemPrompt()
});
```

---

## 📝 总结

### 核心价值

1. **runClaudeStream**: SDK 调用的统一封装，提供日志、监控、session 管理
2. **buildPromptAgentStart**: PromptAgent 的运行时构建器，简化 Agent 开发
3. **Session 管理**: 支持 new/resume/fork 三种模式，满足不同场景

### 重构中的角色

- ✅ **保留**: 底层逻辑继续使用，无需改动
- ➕ **增强**: 通过 MessageAdapter 实现 Event-Driven 输出
- 🎯 **解耦**: Agent 完全不依赖 UI，通过 Event Bus 通信

---

**文档状态**: v1.0 完成  
**来源记忆**: Serena MCP `claude-agent-sdk-integration`  
**下一步**: 在重构 Phase 3-6 中应用这些设计原则

