# Agent 架构分析：Chat、Agent、Story、Glossary、UI、Monitor

**日期**: 2025-01-29  
**分析范围**: 6 个 Tab/Agent 的实现方式  
**目标**: 梳理共同点、结构差异和调用方式

---

## 概览表格

| Tab 名称 | Agent 类型 | 实现方式 | 调用路径 | Session 需求 | View 组件 |
|---------|-----------|---------|---------|------------|----------|
| **Chat** | 简单对话 | useConversationStore | `runStreamForUserMessage` | ❌ 否 | ChatPanel |
| **Agent** | Claude Agent | BaseClaudeFlow | `runAgentTurn` → `baseClaudeFlow` | ✅ 是 | ChatPanel |
| **Story** | PromptAgent | coordinator + sub-agents | `handler` → `startForeground` | ✅ 是 | StackAgentView |
| **Glossary** | PromptAgent | coordinator + sub-agents | `handler` → `startForeground` | ✅ 是 | StackAgentView |
| **UI** | Agent Pipeline | prepare + systemPrompt | `prepare` → `runAgentTurn` | ✅ 是 | StackAgentView |
| **Monitor** | PromptAgent (类) | LogMonitor 类 | `handler` → `startForeground` | ✅ 是 | StackAgentView |

---

## 1. Chat Tab (简单对话模式)

### 特点
- **最简单的交互模式**
- 无 Agent 封装，直接调用 AI Provider
- 无 session 持久化
- 无工具调用能力

### 代码路径

```typescript
// ui.tsx:938-954
if (selectedTab === Driver.CHAT) {
    const newUserMessage: Message = { id: nextMessageId(), role: 'user', content: userInput };
    await runStreamForUserMessage(newUserMessage);
}
```

### 实现细节

**数据流**:
```
用户输入
  ↓
runStreamForUserMessage (useConversationStore)
  ↓
useStreamSession (hooks/useStreamSession.ts)
  ↓
AI Provider API (OpenRouter/Claude)
  ↓
流式输出 → activeMessages → frozenMessages
```

**核心代码**: `src/domain/conversationStore.ts`
```typescript
const { isStreaming, runStreamForUserMessage } = useStreamSession({
    aiProvider,
    modelName,
    reasoningEnabled,
    setActiveMessages: onActiveMessagesChange,
    setFrozenMessages: onFrozenMessagesChange,
    pushSystemMessage,
    nextMessageId,
    conversationLogRef,
});
```

### 特性
- ✅ 简单快速
- ✅ 轻量级
- ❌ 无工具调用
- ❌ 无 session 恢复
- ❌ 无子 agent 编排

---

## 2. Agent Tab (Claude Agent SDK)

### 特点
- **使用 Claude Agent SDK**
- 支持 session 持久化（保存在 workspace settings）
- 支持工具调用 + 权限管理
- 通过 BaseClaudeFlow 处理

### 代码路径

```typescript
// ui.tsx:933-935
if (selectedTab === Driver.AGENT) {
    return await runAgentTurn(userInput);
}
```

### 实现细节

**数据流**:
```
用户输入
  ↓
runAgentTurn
  ↓
startAgentPrompt
  ↓
baseClaudeFlow.handleUserInput
  ↓
runClaudeStream (Claude Agent SDK)
  ↓
事件流 (text/reasoning/tool_use/tool_result)
  ↓
activeMessages → frozenMessages
```

**核心代码**: `src/agent/flows/baseClaudeFlow.ts`
```typescript
await runClaudeStream({
    prompt,
    session: {
        id: agentSessionId,
        initialized: sessionInitialized
    },
    queryOptions: {
        model: modelName,
        systemPrompt,
        allowedTools,
        disallowedTools,
        agents,
        cwd: workspacePath,
        canUseTool,
    },
    callbacks: {
        onTextDelta,
        onReasoningDelta,
        onToolUse,
        onToolResult,
    }
});
```

### 特性
- ✅ Session 持久化
- ✅ 工具调用
- ✅ 权限管理
- ✅ Reasoning 模式
- ❌ 无子 agent 编排（需要手动配置）

---

## 3. Story Tab (PromptAgent + Coordinator)

### 特点
- **数据驱动的 PromptAgent**
- 从 `coordinator.agent.md` + `agents/*.agent.md` 加载配置
- 支持子 agent 编排
- 通过 `handler` 函数直接调用 `startForeground`

### 文件结构

```
src/drivers/story/
├── index.ts              # ViewDriverEntry 配置
├── agent.ts              # createStoryPromptAgent 工厂函数
├── coordinator.agent.md  # 协调器 prompt
└── agents/
    └── story_builder.agent.md  # 子 agent
```

### 代码路径

```typescript
// src/drivers/story/index.ts:8-73
async function handleStoryInvocation(message: Message, context: DriverRuntimeContext): Promise<boolean> {
    const agent = await createStoryPromptAgent();
    context.startForeground(agent, prompt, { ... }, sinks);
    return true;
}

export const storyDriverEntry: ViewDriverEntry = {
    type: 'view',
    id: Driver.STORY,
    component: StackAgentView,
    handler: handleStoryInvocation,
};
```

### Agent 创建

```typescript
// src/drivers/story/agent.ts:14-60
export async function createStoryPromptAgent() {
    const { systemPrompt, agents } = await loadAgentPipelineConfig(driverDir, {
        coordinatorFileName: 'coordinator.agent.md',
    });

    return {
        id: 'story',
        getPrompt(userInput: string) { return userInput; },
        getSystemPrompt() { 
            return { type: 'preset', preset: 'claude_code', append: coordinator }; 
        },
        getAgentDefinitions() { return agents; },
        start(userInput, ctx, sinks) {
            return buildPromptAgentStart(this)(userInput, ctx, sinks);
        },
    };
}
```

### 特性
- ✅ 声明式配置（.agent.md）
- ✅ 子 agent 编排
- ✅ Session 支持
- ✅ 前台流式输出
- ✅ 工具调用 + 权限

---

## 4. Glossary Tab (PromptAgent + Coordinator)

### 特点
- **与 Story 结构完全一致**
- 从 `coordinator.agent.md` + `agents/*.agent.md` 加载
- 三个子 agent: searcher → planner → editor

### 文件结构

```
src/drivers/glossary/
├── index.ts
├── agent.ts
├── coordinator.agent.md
└── agents/
    ├── 1_searcher.agent.md
    ├── 2_edits_planner.agent.md
    └── 3_editor.agent.md
```

### 实现差异

**与 Story 唯一的差异**:
```typescript
// src/drivers/glossary/agent.ts:20-21
const agentId = 'glossary';  // 不同的 id
const agentDescription = 'Glossary PromptAgent (coordinator + sub-agents)';
```

### 特性
- ✅ 与 Story 相同的架构
- ✅ 多步骤工作流（搜索 → 计划 → 编辑）
- ✅ 完整的 Agent SDK 支持

---

## 5. UI Tab (Agent Pipeline + Prepare)

### 特点
- **通过 `prepare` 函数动态准备**
- 使用 `useAgentPipeline: true`
- 最终还是调用 `runAgentTurn`
- **唯一使用 `systemPromptFactory` 而非 `.agent.md` 文件**

### 代码路径

```typescript
// src/drivers/ui-review/index.ts:11-45
async function prepareUiReviewInvocation(
    rawInput: string,
    context: DriverRuntimeContext
): Promise<DriverPrepareResult> {
    const { systemPrompt, allowedTools, disallowedTools } = await loadAgentPipelineConfig(driverDir, {
        systemPromptFactory: buildUiReviewSystemPrompt,  // 关键：不用 .agent.md
    });

    return {
        prompt: userPrompt,
        overrides: {
            systemPrompt,
            allowedTools,
            disallowedTools,
        },
    };
}

export const uiReviewDriverEntry: ViewDriverEntry = {
    type: 'view',
    useAgentPipeline: true,  // 关键：走 pipeline 路径
    prepare: prepareUiReviewInvocation,
};
```

### 调用路径

```typescript
// ui.tsx:822-875
async function runDriverEntry(entry: DriverManifestEntry, prompt: string) {
    if (entry.useAgentPipeline) {
        let overrides: AgentPipelineOverrides | undefined;
        
        if (entry.prepare) {
            const prepared = await entry.prepare(prompt, runtimeContext);
            overrides = prepared.overrides;
        }
        
        return await runAgentTurn(prepared.prompt, overrides, sessionId);
    }
}
```

### 特性
- ✅ 动态 prompt 生成
- ✅ 复用 Agent tab 的基础设施
- ✅ 工具白名单控制
- ❌ 无子 agent（单一 prompt）

---

## 6. Monitor Tab (PromptAgent 类)

### 特点
- **唯一使用 Class 定义的 PromptAgent**
- 继承 `PromptAgent` 基类
- 内置循环逻辑（10 分钟轮询）
- 支持 parseOutput 提取结构化事件

### 文件结构

```
src/agents/log-monitor/
├── index.ts            # 工厂函数
└── LogMonitor.ts       # PromptAgent 类
```

### 类定义

```typescript
// src/agents/log-monitor/LogMonitor.ts:12-262
export class LogMonitor extends PromptAgent {
    readonly id = 'log-monitor';
    
    constructor(
        private readonly logFilePath: string = 'debug.log',
        private readonly tailLines: number = 100,
        private readonly intervalSec: number = 30
    ) { super(); }

    getPrompt(userInput: string, context: AgentContext): string {
        return userInput;
    }

    getSystemPrompt(context?: AgentContext) {
        return { 
            type: 'preset', 
            preset: 'claude_code', 
            append: `监控指令...` 
        };
    }

    getTools(): string[] {
        return ['Read', 'Glob', 'Bash', 'Grep'];
    }

    getAgentDefinitions(): Record<string, AgentDefinition> {
        return {
            tail_debug: { ... },
            task_log: { ... },
            git_diff: { ... },
        };
    }

    start(userInput: string, ctx: AgentStartContext, sinks: AgentStartSinks) {
        // 自定义的 10 分钟循环逻辑
        const run = async () => {
            while (Date.now() < deadline && !aborted) {
                // 每个 cycle 调用一次 buildPromptAgentStart
                // 等待 intervalSec 秒
            }
        };
        void run();
        return { cancel, sessionId };
    }

    parseOutput(rawOutput: string): TaskEvent[] {
        // 解析 [EVENT:level] message 格式
    }
}
```

### Handler 调用

```typescript
// src/drivers/monitor/index.ts:9-87
async function handleMonitorInvocation(message: Message, context: DriverRuntimeContext) {
    const agent = createLogMonitor('debug.log', 100, 30);
    context.startForeground(agent, prompt, { ... }, {
        onText, onEvent, onCompleted, onFailed
    });
}
```

### 特性
- ✅ 面向对象封装
- ✅ 自管理循环逻辑
- ✅ 结构化输出解析
- ✅ 三个子 agent（tail_debug, task_log, git_diff）
- ✅ 长时间运行（10 分钟）

---

## 共同点总结

### 1. 统一的 Agent 接口

所有 Agent（除了 Chat）都实现了类似的接口：

```typescript
interface RunnableAgent {
    id: string;
    description: string;
    getPrompt?: (userInput: string, context: AgentContext) => string;
    getSystemPrompt?: () => string | { type: 'preset'; preset: string; append?: string };
    getAgentDefinitions?: () => Record<string, AgentDefinition>;
    getTools?: () => string[];
    getModel?: () => string;
    parseOutput?: (rawOutput: string) => TaskEvent[];
    start: (userInput: string, context: AgentStartContext, sinks: AgentStartSinks) => ExecutionHandle;
}
```

### 2. 统一的执行入口

所有 PromptAgent 都通过 `buildPromptAgentStart` 转换为可执行的 `start()` 函数：

```typescript
// src/agent/runtime/runPromptAgentStart.ts:12-20
export function buildPromptAgentStart(adapter: AgentAdapter): StartFunction {
    return (userInput, context, sinks) => {
        const prompt = adapter.getPrompt(userInput, context);
        const systemPrompt = adapter.getSystemPrompt?.() ?? { type: 'preset', preset: 'claude_code' };
        const agents = adapter.getAgentDefinitions?.();
        
        void runClaudeStream({ prompt, session, queryOptions: { systemPrompt, agents, ... }, callbacks });
        
        return { cancel, sessionId };
    };
}
```

### 3. 统一的 Sinks 接口

所有 Agent 的输出都通过相同的 sinks 回调：

```typescript
interface AgentStartSinks {
    onText: (chunk: string) => void;
    onReasoning?: (chunk: string) => void;
    onEvent?: (e: TaskEvent) => void;
    onCompleted?: (fullText: string) => void;
    onFailed?: (error: string) => void;
    canUseTool: PermissionHandler;
}
```

### 4. 统一的 Session 管理

所有需要 session 的 Agent 都通过 `AgentStartContext.session` 传递：

```typescript
interface AgentStartContext {
    sourceTabId: string;
    workspacePath?: string;
    session?: { id: string; initialized: boolean };
    forkSession?: boolean;
}
```

---

## 结构差异总结

### 按配置方式分类

#### A. 声明式配置（.agent.md 文件）
- **Story**: coordinator.agent.md + agents/*.agent.md
- **Glossary**: coordinator.agent.md + agents/*.agent.md

**优点**:
- 配置与代码分离
- 易于修改 prompt
- 标准化的子 agent 管理

**缺点**:
- 文件 I/O 开销
- 调试不如代码直观

#### B. 代码生成 Prompt（Factory 函数）
- **UI**: `buildUiReviewSystemPrompt()` 函数

**优点**:
- 动态生成（可根据上下文调整）
- TypeScript 类型安全
- 易于单元测试

**缺点**:
- Prompt 与代码耦合
- 修改需要重新编译

#### C. Class 封装
- **Monitor**: `LogMonitor extends PromptAgent`

**优点**:
- 面向对象封装
- 自定义循环逻辑
- 状态管理清晰

**缺点**:
- 代码量较大
- 与 PromptAgent 基类耦合

#### D. 无 Agent 封装
- **Chat**: 直接调用 AI Provider
- **Agent**: 通过 BaseClaudeFlow 封装 SDK

---

### 按调用方式分类

#### Type 1: Handler 模式
```typescript
// Story, Glossary, Monitor
handler: async (message, context) => {
    const agent = await createAgent();
    context.startForeground(agent, prompt, { ... }, sinks);
}
```

#### Type 2: Prepare + useAgentPipeline
```typescript
// UI Review
prepare: async (prompt, context) => {
    return { prompt, overrides: { systemPrompt, allowedTools } };
},
useAgentPipeline: true
```

#### Type 3: 直接调用 SDK
```typescript
// Agent tab
runAgentTurn → baseClaudeFlow.handleUserInput → runClaudeStream
```

#### Type 4: 简单流式
```typescript
// Chat tab
runStreamForUserMessage → useStreamSession → AI Provider
```

---

## 调用链对比

### Story/Glossary/Monitor (Handler 模式)

```
用户输入 (Story tab)
  ↓
ui.tsx:handleSubmit
  ↓
runDriverEntry(storyDriverEntry, prompt)
  ↓
storyDriverEntry.handler(message, context)
  ↓
createStoryPromptAgent()
  ↓
context.startForeground(agent, prompt, ...)
  ↓
buildPromptAgentStart(agent)
  ↓
runClaudeStream({ systemPrompt, agents, ... })
  ↓
sinks.onText / onEvent / onCompleted
  ↓
context.setFrozenMessages
```

### UI Review (Prepare 模式)

```
用户输入 (UI tab)
  ↓
ui.tsx:handleSubmit
  ↓
runDriverEntry(uiReviewDriverEntry, prompt)
  ↓
uiReviewDriverEntry.prepare(prompt, context)
  ↓
返回 { prompt, overrides: { systemPrompt, allowedTools } }
  ↓
runAgentTurn(prompt, overrides)
  ↓
baseClaudeFlow.handleUserInput
  ↓
runClaudeStream({ systemPrompt, allowedTools, ... })
  ↓
baseClaudeFlow callbacks
  ↓
setActiveMessages / finalizeMessageById
```

### Agent Tab (SDK 直接模式)

```
用户输入 (Agent tab)
  ↓
ui.tsx:handleSubmit
  ↓
runAgentTurn(userInput)
  ↓
startAgentPrompt({ prompt, sessionId, overrides })
  ↓
baseClaudeFlow.handleUserInput
  ↓
runClaudeStream({ session, systemPrompt, agents, ... })
  ↓
baseClaudeFlow callbacks
  ↓
setActiveMessages / finalizeMessageById
```

### Chat Tab (直接流式)

```
用户输入 (Chat tab)
  ↓
ui.tsx:handleSubmit
  ↓
runStreamForUserMessage(message)
  ↓
useStreamSession.runStream
  ↓
AI Provider API
  ↓
流式输出
  ↓
setActiveMessages / setFrozenMessages
```

---

## 架构演进方向

### 当前问题

1. **调用方式不统一**
   - 3 种不同的调用路径（handler / prepare+pipeline / direct）
   - 难以理解和维护

2. **配置方式不统一**
   - .agent.md / Factory 函数 / Class / 无配置
   - 缺乏一致性

3. **路由逻辑分散**
   - 在 `ui.tsx:handleSubmit` 中硬编码判断
   - 每种模式需要不同的处理逻辑

4. **View 组件无意义**
   - `StackAgentView` 返回 null
   - View 和 Agent 的关系不明确

### 建议的统一方向

#### 方案 A: 全部 Handler 化

**优点**:
- 最简单
- 已经有 3 个 (Story/Glossary/Monitor) 在使用

**实施**:
```typescript
// UI Review 改造
handler: async (message, context) => {
    const agent = await createUiReviewAgent();
    context.startForeground(agent, message.content, { ... }, sinks);
}
```

**缺点**:
- Agent tab 和 Chat tab 不适合（它们是基础模式）

#### 方案 B: 全部 Agent 接口化

**优点**:
- 最灵活
- 支持所有场景

**实施**:
```typescript
interface ViewTab {
    id: string;
    label: string;
    view: React.FC;
    agent: RunnableAgent;
}

// Chat 包装为 ChatAgent
class ChatAgent implements RunnableAgent {
    start(userInput, context, sinks) {
        // 调用 useStreamSession
    }
}

// 统一路由
async function routeToTab(tab: ViewTab, input: string) {
    return tab.agent.start(input, context, sinks);
}
```

**缺点**:
- 需要大量重构
- Chat 和 Agent 的包装可能过度设计

#### 方案 C: 分层抽象（推荐）

**核心思想**: 保留差异，统一接口

```typescript
// 1. Tab 层（View 定义）
interface TabDescriptor {
    id: string;
    label: string;
    type: 'simple' | 'agent' | 'driver';
    view: React.FC;
    executor: TabExecutor;
}

// 2. 执行器层（统一调用接口）
interface TabExecutor {
    execute(input: string, context: ExecutionContext): Promise<boolean>;
}

// 3. Agent 层（多种实现）
class SimpleExecutor implements TabExecutor {
    // Chat tab
}

class AgentExecutor implements TabExecutor {
    // Agent tab
}

class DriverExecutor implements TabExecutor {
    // Story/Glossary/UI/Monitor
    constructor(private driver: ViewDriverEntry) {}
    
    async execute(input: string, context: ExecutionContext) {
        if (this.driver.handler) {
            return this.driver.handler(message, runtimeContext);
        }
        if (this.driver.prepare && this.driver.useAgentPipeline) {
            const prepared = await this.driver.prepare(input, runtimeContext);
            return runAgentTurn(prepared.prompt, prepared.overrides);
        }
        throw new Error('Invalid driver configuration');
    }
}

// 4. 统一路由
class TabRouter {
    route(tab: TabDescriptor, input: string) {
        return tab.executor.execute(input, context);
    }
}
```

**优点**:
- 保留现有实现
- 统一调用入口
- 易于扩展

---

## 结论

### 当前状态
- **6 种不同的实现方式**
- **3 种不同的配置方式**
- **4 种不同的调用路径**
- **分散的路由逻辑**

### 核心问题
1. Tab → View → Agent 的关系不清晰
2. 调用路径不统一
3. 配置方式不一致
4. 路由逻辑耦合在 ui.tsx

### 重构目标
1. 统一 Tab 抽象
2. 统一执行接口
3. 集中路由逻辑
4. 保持向后兼容

### 下一步
1. 定义 `TabDescriptor` 和 `TabExecutor` 接口
2. 创建 `TabRegistry` 和 `TabRouter`
3. 重构 `ui.tsx:handleSubmit`
4. 迁移现有 drivers

