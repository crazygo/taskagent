# TaskAgent 核心概念修正

**日期**: 2025-01-29  
**目标**: 基于代码库精确定义核心概念

---

## 概念修正总览

| 用户提出的概念 | 修正后的概念 | 代码位置 |
|--------------|------------|---------|
| Screen | **View Components** (多个) | `src/components/*.tsx` |
| Chat | **Chat Mode** (一种交互模式) | `ui.tsx:938-954` |
| RunnableAgent | **RunnableAgent** (接口) + **PromptAgent** (基类) | `src/agent/types.ts:87-96, 53-81` |
| TaskManager | **TaskManager** (后台任务管理器) + **Foreground Execution** (前台执行) | `task-manager.ts:50-309` |

---

## 1. View Components (不是单一的 Screen)

### 概念定义
**View Components** 是多个独立的 React/Ink 组件，各自负责渲染特定的 UI 区域。它们不是一个统一的"Screen"，而是职责分离的组件集合。

### 核心组件

#### 1.1 ChatPanel
**职责**: 显示对话历史（frozen + active messages）

**代码位置**: `src/components/ChatPanel.tsx`

**使用位置**: `ui.tsx:1080-1086`
```
<ChatPanel
    frozenMessages={frozenMessages}
    activeMessages={activeMessages}
    modelName={modelName}
    workspacePath={bootstrapConfig.workspacePath}
    positionalPromptWarning={positionalPromptWarning}
/>
```

**渲染内容**:
- 已完成的消息（frozenMessages）
- 正在流式输出的消息（activeMessages）
- 系统消息、用户消息、Assistant 消息

**例子**: 当用户在 Chat tab 发送 "帮我写一个函数"，ChatPanel 显示这条用户消息和 AI 的回复流。

---

#### 1.2 DriverView
**职责**: 根据当前选中的 tab 渲染对应 Driver 的专用视图

**代码位置**: `src/components/DriverView.tsx:1-24`

**使用位置**: `ui.tsx:1088`
```
{isDriverViewActive && <DriverView selectedTab={selectedTab} />}
```

**渲染逻辑**: 
- 通过 `getDriverByLabel(selectedTab)` 查找 Driver Entry
- 渲染 `driverEntry.component`（通常是 `StackAgentView`）

**激活条件**: `ui.tsx:1076`
```
const isDriverViewActive = STATIC_TABS.includes(selectedTab) 
    && selectedTab !== Driver.CHAT 
    && selectedTab !== Driver.AGENT;
```

**例子**: 当用户切换到 Story tab，DriverView 渲染 `StackAgentView`（虽然它返回 null）。

---

#### 1.3 TaskSpecificView
**职责**: 显示后台任务的状态信息

**代码位置**: `src/components/TaskSpecificView.tsx`

**使用位置**: `ui.tsx:1112-1117`
```
<TaskSpecificView
    task={activeTask}
    taskNumber={activeTaskNumber}
    isFocused={focusedControl === 'task'}
/>
```

**显示内容**:
- Task 状态（pending/in_progress/completed/failed）
- Task 输出片段
- Task ID
- 日志文件路径提示

**例子**: 当用户执行 `/bg:log-monitor` 后，TaskSpecificView 显示 "Task 1 | in_progress | 日志：logs/xxx.log"。

---

#### 1.4 TabView
**职责**: 显示所有 tab 标签（静态 + 动态 Task tabs）

**代码位置**: `src/components/StatusControls.tsx:9-75`

**使用位置**: `ui.tsx:1118-1124`
```
<TabView
    staticOptions={staticTabs}
    tasks={tasks}
    selectedTab={selectedTab}
    onTabChange={setSelectedTab}
    isFocused={focusedControl === 'tabs'}
/>
```

**显示内容**:
- 静态 tabs: `[Driver.CHAT, Driver.AGENT, ...DRIVER_TABS]` (`ui.tsx:45-49`)
- 动态 tabs: `Task 1`, `Task 2`, ... (基于 `tasks` 数组)

**例子**: 用户按 Ctrl+N 在 "Chat" → "Agent" → "Story" → "Task 1" 之间循环切换。

---

#### 1.5 InputBar
**职责**: 接收用户输入、显示命令菜单

**代码位置**: `src/components/InputBar.tsx`

**使用位置**: `ui.tsx:1100-1108`

**功能**:
- 文本输入
- `/` 触发命令补全
- ESC 清空输入

---

### 关系图（概念层）

```
┌─────────────────────────────────────────┐
│         Terminal Window                 │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │ ChatPanel (对话历史)              │  │
│  │ - frozenMessages                  │  │
│  │ - activeMessages                  │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │ DriverView (当前 Driver 视图)    │  │
│  │ (仅在 Driver tabs 显示)          │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │ InputBar (输入框)                │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │ TaskSpecificView (后台任务信息)  │  │
│  │ (仅在有 activeTask 时显示)       │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │ TabView (标签栏)                 │  │
│  │ [› Chat] [Agent] [Story] [Task 1]│  │
│  └───────────────────────────────────┘  │
│                                         │
│  [Press Ctrl+N to switch view]         │
└─────────────────────────────────────────┘
```

---

## 2. Chat Mode (不是 Vercel 对话功能)

### 概念定义
**Chat Mode** 是 TaskAgent 的一种交互模式（而非独立功能），与 Agent Mode、Driver Mode 并列。它使用 Vercel AI SDK 作为底层实现，但不等同于 "Vercel 对话功能"。

### 三种交互模式

#### 2.1 Chat Mode
**概念**: 简单的 AI 对话模式，无工具调用、无 session 持久化

**触发条件**: `selectedTab === Driver.CHAT` (`ui.tsx:938`)

**代码路径**: `ui.tsx:938-954`
```
if (selectedTab === Driver.CHAT) {
    const newUserMessage: Message = { id: nextMessageId(), role: 'user', content: userInput };
    await runStreamForUserMessage(newUserMessage);
}
```

**执行链**:
```
runStreamForUserMessage
  → useStreamSession (src/hooks/useStreamSession.ts)
  → Vercel AI SDK streamText()
  → 流式输出到 activeMessages
```

**特点**:
- ❌ 无工具调用
- ❌ 无 session 恢复
- ❌ 无权限管理
- ✅ 快速响应
- ✅ 简单对话

**例子**: 用户在 Chat tab 输入 "什么是 TypeScript?"，直接获得 AI 回复，无法调用文件读取工具。

---

#### 2.2 Agent Mode
**概念**: 使用 Claude Agent SDK 的完整 Agent 模式，支持工具调用、session 持久化

**触发条件**: `selectedTab === Driver.AGENT` (`ui.tsx:933`)

**代码路径**: `ui.tsx:933-935`
```
if (selectedTab === Driver.AGENT) {
    return await runAgentTurn(userInput);
}
```

**执行链**:
```
runAgentTurn
  → startAgentPrompt
  → baseClaudeFlow.handleUserInput
  → runClaudeStream (src/agent/runtime/runClaudeStream.ts)
  → Claude Agent SDK
  → 事件流（text/reasoning/tool_use/tool_result）
```

**特点**:
- ✅ 工具调用
- ✅ Session 持久化 (`workspace/.settings.json`)
- ✅ 权限管理（canUseTool）
- ✅ Reasoning 模式
- ❌ 无子 agent 编排（需手动配置）

**例子**: 用户在 Agent tab 输入 "读取 package.json"，Agent 请求权限后调用 Read 工具，返回文件内容。

---

#### 2.3 Driver Mode
**概念**: 各种专用功能的执行模式（Story/Glossary/UI/Monitor），每个 Driver 绑定一个 Agent

**触发条件**: `selectedTab` 匹配任何 Driver tab (`ui.tsx:928-930`)

**代码路径**: `ui.tsx:922-932`
```
const activeDriver = getDriverByLabel(selectedTab);
if (activeDriver) {
    return await runDriverEntry(activeDriver, userInput);
}
```

**执行方式**: 取决于 Driver 的配置
- **Handler 模式**: Story, Glossary, Monitor
- **Prepare 模式**: UI Review

**例子**: 用户在 Story tab 输入 "整理需求"，Story Agent 启动 coordinator，调用 story_builder 子 agent，输出 Markdown。

---

### Chat Mode vs Vercel AI SDK

**关系**: Chat Mode **使用** Vercel AI SDK 作为底层实现，但不等同于它。

**代码证据**: `src/hooks/useStreamSession.ts` 中调用 `streamText()`

**区别**:
- **Vercel AI SDK**: 技术栈，提供 `streamText()` API
- **Chat Mode**: 业务概念，指"简单对话"这种交互模式

**类比**: 
- Vercel AI SDK ≈ HTTP 库（axios/fetch）
- Chat Mode ≈ "发送请求"这个业务动作

---

## 3. RunnableAgent (接口) + PromptAgent (基类)

### 概念定义
**RunnableAgent** 是一个 TypeScript 接口，定义了可执行 Agent 的统一契约。**PromptAgent** 是一个抽象基类，提供了基于 prompt 驱动的 Agent 基础实现。

### 3.1 RunnableAgent 接口

**代码位置**: `src/agent/types.ts:87-96`

**接口定义**:
```typescript
export interface RunnableAgent {
    id: string;
    description: string;
    getPrompt?: (userInput: string, context: AgentContext | AgentStartContext) => string;
    getTools?: () => string[];
    getModel?: () => string | undefined;
    parseOutput?: (rawChunk: string) => TaskEvent[];
    getAgentDefinitions?: () => Record<string, AgentDefinition> | undefined;
    start: (userInput: string, context: AgentStartContext, sinks: AgentStartSinks) => ExecutionHandle;
}
```

**核心方法**:
- `start()`: 启动 Agent 执行，返回 `{ cancel, sessionId }`
- `getPrompt()`: 生成 LLM prompt
- `getAgentDefinitions()`: 提供子 agent 定义（用于编排）
- `parseOutput()`: 解析输出为结构化事件

**返回值**: `ExecutionHandle` (`src/agent/types.ts:44-47`)
```typescript
export interface ExecutionHandle {
    cancel: () => void;
    sessionId: string;
}
```

**例子（概念）**: Story Agent 是一个 RunnableAgent，当调用 `story.start("整理需求", context, sinks)` 时，它启动执行并返回一个可取消的 handle。

---

### 3.2 PromptAgent 基类

**代码位置**: `src/agent/types.ts:53-81`

**类定义**:
```typescript
export abstract class PromptAgent {
    abstract readonly id: string;
    abstract readonly description: string;
    abstract getPrompt(userInput: string, context: AgentContext): string;
    
    getTools?(): string[];
    getModel?(): string;
    parseOutput?(rawOutput: string): TaskEvent[];
}
```

**注意**: PromptAgent 没有 `start()` 方法，需要通过 `buildPromptAgentStart()` 包装。

**实现类**:
- **LogMonitor** (`src/agents/log-monitor/LogMonitor.ts:12`)
  ```typescript
  export class LogMonitor extends PromptAgent {
      readonly id = 'log-monitor';
      getPrompt(userInput, context) { return userInput; }
      getSystemPrompt() { return { type: 'preset', preset: 'claude_code', append: '...' }; }
      getAgentDefinitions() { return { tail_debug, task_log, git_diff }; }
      start(userInput, ctx, sinks) { /* 自定义循环逻辑 */ }
  }
  ```

- **DefaultAtomicAgent** (`src/agent/types.ts:105-112`)
  ```typescript
  export class DefaultAtomicAgent extends PromptAgent {
      readonly id = 'default';
      getPrompt(userInput: string): string { return userInput; }
  }
  ```

---

### 3.3 数据驱动的 Agent（不是类）

**概念**: Story、Glossary 不是类，而是通过工厂函数返回的对象，实现了 RunnableAgent 接口。

**Story Agent** (`src/drivers/story/agent.ts:14-60`):
```typescript
export async function createStoryPromptAgent() {
    const { systemPrompt, agents } = await loadAgentPipelineConfig(driverDir, {
        coordinatorFileName: 'coordinator.agent.md',
    });
    
    return {  // 返回对象，不是类实例
        id: 'story',
        description: 'Story PromptAgent (coordinator + sub-agents)',
        getPrompt(userInput) { return userInput; },
        getSystemPrompt() { return { type: 'preset', preset: 'claude_code', append: coordinator }; },
        getAgentDefinitions() { return agents; },
        start(userInput, ctx, sinks) {
            return buildPromptAgentStart(this)(userInput, ctx, sinks);
        },
    };
}
```

**关键区别**:
- LogMonitor: `class LogMonitor extends PromptAgent`（面向对象）
- Story/Glossary: 工厂函数返回对象（函数式/数据驱动）

---

### 3.4 Agent 分类（按形态）

| Agent 类型 | 实现方式 | 例子 | 代码位置 |
|-----------|---------|------|---------|
| **类 Agent** | `class X extends PromptAgent` | LogMonitor | `src/agents/log-monitor/LogMonitor.ts:12` |
| **对象 Agent** | 工厂函数返回对象 | Story, Glossary | `src/drivers/story/agent.ts:14-60` |
| **默认 Agent** | 单例对象 | DefaultAtomicAgent | `src/agent/types.ts:105-112` |

---

### 3.5 RunnableAgent 的职责边界

**职责**（在 RunnableAgent 内部）:
- ✅ 生成 prompt (`getPrompt`)
- ✅ 定义 system prompt (`getSystemPrompt`)
- ✅ 声明所需工具 (`getTools`)
- ✅ 定义子 agent (`getAgentDefinitions`)
- ✅ 解析输出 (`parseOutput`)
- ✅ 执行逻辑 (`start`)

**非职责**（不在 RunnableAgent 内部）:
- ❌ 管理消息队列（由 TaskManager 或前台执行流程管理）
- ❌ 渲染 UI（由 View Components 负责）
- ❌ 路由决策（由 ui.tsx 的 handleSubmit 负责）
- ❌ 权限判断（由 canUseTool callback 外部提供）

**例子（边界）**: LogMonitor 的 `start()` 方法内部管理 10 分钟循环逻辑（✅ 职责内），但不直接操作 UI 组件（❌ 非职责）。

---

## 4. TaskManager (后台任务管理) + Foreground Execution (前台执行)

### 概念定义
**TaskManager** 是一个类，专门管理**后台任务**的生命周期、状态和事件转发。它**不管理**前台 Agent 执行（Chat/Agent/Driver tabs 的交互）。

### 4.1 TaskManager 类

**代码位置**: `task-manager.ts:50-309`

**类定义**:
```typescript
export class TaskManager {
    private tasks: Map<string, TaskExtended> = new Map();
    private eventEmitters: Map<string, EventEmitter> = new Map();
    
    startBackground(agent: PromptAgent, userPrompt: string, context: {...}): TaskWithEmitter
    startForeground(agent: any, userPrompt: string, context: {...}, sinks: ForegroundSinks): ForegroundHandle
    getTasks(): Task[]
    cancelTask(taskId: string): void
    waitTask(taskId: string): Promise<Task>
}
```

**职责**:
1. **后台任务管理**: 创建、跟踪、取消 Task
2. **状态管理**: pending → in_progress → completed/failed/cancelled
3. **事件转发**: 将 Agent 的 `onEvent` 转发给 EventEmitter
4. **超时控制**: 根据 `timeoutSec` 自动取消任务
5. **日志记录**: 写入 `logs/{taskId}.log`

**不负责**:
- ❌ 渲染 UI（由 TaskSpecificView 负责）
- ❌ 路由决策（由 ui.tsx 负责）
- ❌ 前台 Agent 执行（由 runAgentTurn/runDriverEntry 负责）

---

### 4.2 后台任务 vs 前台执行

**后台任务**（Background Task）:
- **定义**: 在独立的 Task tab 中运行，不阻塞主界面
- **触发**: `/bg:*` 命令，如 `/bg:log-monitor`
- **管理者**: TaskManager
- **输出**: 通过 EventEmitter 发送事件到源 tab
- **UI**: TaskSpecificView 显示状态

**代码位置**: `task-manager.ts:59-164`
```
startBackground(agent, userPrompt, context) {
    const task = { id, status: 'pending', ... };
    const emitter = new EventEmitter();
    
    agent.start(userInput, context, {
        onEvent: (e) => emitter.emit('event', e),
        onCompleted: () => { task.status = 'completed'; emitter.emit('completed'); },
    });
    
    return { task, emitter };
}
```

**前台执行**（Foreground Execution）:
- **定义**: 在当前 tab 中直接流式输出，阻塞用户输入
- **触发**: 在 Story/Glossary/UI/Monitor/Agent tab 直接输入
- **管理者**: ui.tsx 的执行流程（runAgentTurn/runDriverEntry）
- **输出**: 直接写入 activeMessages → frozenMessages
- **UI**: ChatPanel 显示流式输出

**代码位置**: `task-manager.ts:166-240` (注意：这是 startForeground 方法)
```
startForeground(agent, userPrompt, context, sinks) {
    const handle = agent.start(userInput, context, {
        onText: sinks.onText,  // 直接流式输出
        onEvent: sinks.onEvent,
        onCompleted: sinks.onCompleted,
    });
    
    return handle;  // 不创建 Task 对象
}
```

---

### 4.3 Task 数据结构

**基础 Task** (`task-manager.ts:9-18`):
```typescript
export interface Task {
    id: string;
    prompt: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
    output: string;
    exitCode?: number | null;
    error?: string | null;
    sdkSessionId?: string;
}
```

**扩展 Task** (`task-manager.ts:20-28`):
```typescript
export interface TaskExtended extends Task {
    agent?: PromptAgent;
    userPrompt: string;
    sourceTabId?: string;
    workspacePath?: string;
    events: TaskEvent[];
    timeoutSec?: number;
    session?: { id: string; initialized: boolean };
}
```

**Task + Emitter** (`task-manager.ts:30-33`):
```typescript
export interface TaskWithEmitter {
    task: TaskExtended;
    emitter: EventEmitter;
}
```

**用途**: `emitter` 用于将后台任务的事件发送回源 tab。

**例子**: 
```
用户在 Story tab 执行 `/bg:story "分析需求"`
  → TaskManager.startBackground() 创建 Task
  → 返回 { task: { id: 'xxx', status: 'pending', ... }, emitter }
  → ui.tsx 订阅 emitter.on('event', (e) => 显示到 Story tab)
  → 新增 Task 1 tab，TabView 显示 [Chat] [Agent] [Story] [Task 1]
```

---

### 4.4 TaskManager 与 Screen 的关系

**TaskManager** 不直接渲染 UI，它通过以下方式影响 UI:

1. **Task 列表**: `getTasks()` → `ui.tsx` 的 `tasks` state → `TabView` 显示 Task tabs
   
   **代码**: `ui.tsx:246`
   ```
   const { tasks, startBackground, waitTask, cancelTask, startForeground } = useTaskStore();
   ```

2. **Task 状态**: `task.status` → `TaskSpecificView` 显示状态
   
   **代码**: `ui.tsx:1112-1117`
   ```
   <TaskSpecificView task={activeTask} taskNumber={activeTaskNumber} isFocused={...} />
   ```

3. **事件转发**: `emitter.emit('event')` → `ui.tsx` 订阅 → 显示到 ChatPanel
   
   **代码**: `src/drivers/registry.ts:181-186` (后台任务 handler 中)
   ```
   emitter.on('event', (event) => {
       const systemMsg = { id: nextMessageId(), role: 'system', content: `${icon} ${event.message}` };
       context.setFrozenMessages(prev => [...prev, systemMsg]);
   });
   ```

**关键**: TaskManager 管理数据，View Components 渲染数据，两者解耦。

---

## 5. 概念关系总图

```
┌─────────────────────────────────────────────────────────────┐
│                        用户交互                              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
          ┌────────────────────────┐
          │   View Components      │
          │  - ChatPanel           │
          │  - DriverView          │
          │  - TaskSpecificView    │
          │  - TabView             │
          │  - InputBar            │
          └────────┬───────────────┘
                   │ 用户输入
                   ▼
          ┌────────────────────────┐
          │     ui.tsx             │
          │  handleSubmit() 路由    │
          └────┬───────┬───────────┘
               │       │
       ┌───────┘       └──────────┐
       │                          │
       ▼                          ▼
┌──────────────┐         ┌──────────────────┐
│  Chat Mode   │         │   Agent Mode     │
│ (简单对话)   │         │ (Claude SDK)     │
└──────────────┘         └──────────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
              ▼                  ▼                  ▼
    ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
    │  Driver Mode    │ │  Foreground     │ │  Background     │
    │  (专用功能)     │ │  Execution      │ │  Task           │
    └────────┬────────┘ └────────┬────────┘ └────────┬────────┘
             │                   │                   │
             │                   │                   │
             ▼                   ▼                   ▼
    ┌──────────────────────────────────────────────────────┐
    │             RunnableAgent (接口)                     │
    │  - Story Agent (对象)                                │
    │  - Glossary Agent (对象)                             │
    │  - LogMonitor (类 extends PromptAgent)               │
    │  - UI Agent (对象)                                   │
    └──────────────────────────────────────────────────────┘
                             │
                             │ start()
                             ▼
                    ┌──────────────────┐
                    │  runClaudeStream │
                    │ (Claude SDK)     │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
         onText         onEvent       onCompleted
              │              │              │
              └──────────────┼──────────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
              ▼                             ▼
    ┌──────────────────┐         ┌──────────────────┐
    │  直接输出到      │         │  通过 TaskManager │
    │  activeMessages  │         │  转发到 emitter   │
    │  (前台)          │         │  (后台)          │
    └──────────────────┘         └──────────────────┘
              │                             │
              │                             │
              ▼                             ▼
    ┌──────────────────┐         ┌──────────────────┐
    │   ChatPanel      │         │ TaskSpecificView │
    │   渲染流式输出    │         │ + ChatPanel      │
    └──────────────────┘         └──────────────────┘
```

---

## 6. 关键区别总结

### 6.1 Screen vs View Components
- ❌ **Screen**: 单一渲染区域（不准确）
- ✅ **View Components**: 多个职责分离的 UI 组件

### 6.2 Chat vs Chat Mode
- ❌ **Chat**: Vercel 对话功能（不准确）
- ✅ **Chat Mode**: 三种交互模式之一（Chat/Agent/Driver）

### 6.3 RunnableAgent vs PromptAgent
- **RunnableAgent**: 接口，定义统一契约
- **PromptAgent**: 基类，提供 prompt 驱动的实现框架
- 关系: `PromptAgent` 可以实现 `RunnableAgent` 接口（需包装）

### 6.4 TaskManager vs Foreground Execution
- **TaskManager**: 只管理**后台任务**
- **Foreground Execution**: 前台执行逻辑在 `ui.tsx`、`runAgentTurn`、`runDriverEntry` 中
- 关键: TaskManager 有 `startForeground()` 方法，但它不创建 Task 对象

---

## 7. 术语对照表

| 用户术语 | 精确术语 | 代码位置 | 举例 |
|---------|---------|---------|------|
| Screen | View Components | `src/components/` | ChatPanel, DriverView, TabView |
| Chat (功能) | Chat Mode (模式) | `ui.tsx:938` | 简单对话模式，无工具调用 |
| Vercel 对话 | Vercel AI SDK (技术栈) | `src/hooks/useStreamSession.ts` | 底层 API 提供者 |
| RunnableAgent | RunnableAgent (接口) | `src/agent/types.ts:87` | 定义 Agent 契约 |
| PromptAgent | PromptAgent (基类) | `src/agent/types.ts:53` | prompt 驱动的实现框架 |
| TaskManager | TaskManager (类) | `task-manager.ts:50` | 后台任务管理器 |
| 前台执行 | Foreground Execution | `ui.tsx:runAgentTurn/runDriverEntry` | 在当前 tab 流式输出 |
| 后台任务 | Background Task | `/bg:*` 命令 | 创建独立 Task tab |

---

## 8. 使用建议

### 何时提及 "View Components"
- 讨论 UI 渲染
- 讨论组件职责分离
- 讨论 React/Ink 实现

### 何时提及 "Chat Mode"
- 讨论交互模式（vs Agent Mode, Driver Mode）
- 讨论功能差异（是否支持工具调用）
- 强调"模式"而非"功能"

### 何时提及 "RunnableAgent"
- 讨论 Agent 接口契约
- 讨论不同 Agent 的共性
- 讨论 `start()` 方法

### 何时提及 "PromptAgent"
- 讨论 Agent 基类
- 讨论继承关系（LogMonitor extends PromptAgent）
- 讨论 prompt 驱动的实现

### 何时提及 "TaskManager"
- 讨论后台任务管理
- 讨论 Task 生命周期
- 讨论事件转发
- **注意**: 不提及前台执行（那是 ui.tsx 的职责）

---

## 9. 概念边界备忘

### TaskManager 的边界
- ✅ 管理后台任务状态
- ✅ 转发 Agent 事件
- ✅ 超时控制
- ❌ 不渲染 UI
- ❌ 不管理前台执行

### RunnableAgent 的边界
- ✅ 生成 prompt
- ✅ 执行 Agent 逻辑
- ✅ 解析输出
- ❌ 不管理消息队列
- ❌ 不渲染 UI
- ❌ 不做路由决策

### View Components 的边界
- ✅ 渲染 UI
- ✅ 响应用户交互
- ❌ 不执行 Agent 逻辑
- ❌ 不管理任务状态
- ❌ 不做路由决策

### ui.tsx 的职责（协调者）
- ✅ 路由决策（handleSubmit）
- ✅ 状态管理（selectedTab, messages）
- ✅ 组合 View Components
- ✅ 协调 TaskManager 和 Agent 执行
- ❌ 不实现具体 Agent 逻辑

