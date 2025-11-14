# Agent Start Method Refactoring - Task Specification

## 任务背景

当前 Agent 架构已基本完成重构，建立了清晰的层次结构：
- **Desktop** - 统一入口，调度原子和组合 Agent
- **Blueprint** - 协调 Writer + YAML 验证循环
- **DevHub** - 协调 Coder + Reviewer 循环
- **Writer/Coder/Reviewer** - 原子 Agent

但 start 方法的实现分散在多处，存在结构不一致和重复代码问题。

## 当前架构分析

### 1. Agent 启动流程

**调用链路**：
```
TabExecutor.execute()
  ↓
TabExecutionManager.execute()
  ↓
TabExecutor.executeAgent()
  ↓
agent.start(userInput, context, sinks)
  ↓
buildPromptAgentStart(...) 或 自定义实现
```

**关键组件职责**：

| 组件 | 职责 | 当前状态 |
|------|------|---------|
| `TabExecutor` | 统一入口，管理 Agent 执行生命周期 | ✅ 已完成 |
| `TabExecutionManager` | 并发控制、队列管理、Session 管理 | ✅ 已完成 |
| `MessageAdapter` | 事件转换（Agent 事件 → UI 事件） | ✅ 已完成 |
| `Agent.start()` | Agent 启动入口，绑定 context，执行 | ⚠️ 不一致 |
| `buildPromptAgentStart()` | 通用 PromptAgent 启动逻辑 | ⚠️ 部分重复 |

### 2. Start 方法当前实现对比

#### BlueprintAgent.start() - Class 实现
```typescript
// packages/agents/blueprint/BlueprintAgent.ts
start(userInput: string, context: AgentStartContext, sinks: AgentStartSinks): ExecutionHandle {
    // 1. 设置 runtime context
    this.setRuntimeContext({
        sourceTabId: context.sourceTabId,
        workspacePath: context.workspacePath,
        parentAgentId: context.parentAgentId ?? BLUEPRINT_AGENT_ID,
    });
    
    // 2. 调用 buildPromptAgentStart 构建 start 函数
    const startFn = buildPromptAgentStart({
        getPrompt: (userInput: string) => this.getPrompt(userInput, context),
        getSystemPrompt: () => this.deps.systemPrompt,
        getAgentDefinitions: () => this.getAgentDefinitions(),
        getMcpTools: () => {
            const tool = this.asMcpTool();
            return tool ? { [this.id]: tool } : undefined;
        },
    });
    
    // 3. 执行
    return startFn(userInput, context, sinks);
}
```

**优点**：
- 清晰的类结构
- Runtime context 与实例绑定

**问题**：
- 每次调用都重新构建 startFn（性能浪费）
- startFn 概念引入额外复杂度

#### Desktop Agent.start() - 函数式实现
```typescript
// packages/agents/desktop/index.ts
start: (userInput: string, context: AgentStartContext, sinks: AgentStartSinks): ExecutionHandle => {
    // 1. 事件监听器管理（复杂的清理逻辑）
    const activeChildAgents = new Set<string>();
    let handleCompleted = false;
    let cleanupDeferred = false;
    
    const markChildActive = (childAgentId?: string) => { ... };
    const markChildInactive = (childAgentId?: string) => { ... };
    const cleanupListeners = () => { ... };
    
    // 2. 注册事件监听器（监听子 Agent 的输出）
    const agentTextHandler = (event: any) => { ... };
    const agentEventHandler = (event: any) => { ... };
    const agentCompletedHandler = (event: any) => { ... };
    
    options.eventBus.on('agent:text', agentTextHandler);
    options.eventBus.on('agent:event', agentEventHandler);
    options.eventBus.on('agent:completed', agentCompletedHandler);
    
    // 3. 注入 tabExecutor 到 context
    const enhancedContext = {
        ...context,
        tabExecutor: options?.tabExecutor,
    };
    
    // 4. 调用通用 start 函数
    const handle = start(userInput, enhancedContext as any, sinks);
    
    // 5. 清理事件监听器
    handle.completion.finally(() => {
        handleCompleted = true;
        if (!cleanupDeferred || activeChildAgents.size === 0) {
            cleanupListeners();
        }
    });
    
    return handle;
}
```

**优点**：
- 完整的事件监听生命周期管理
- 支持子 Agent 进度转发

**问题**：
- 逻辑复杂（60+ 行）
- 事件管理代码可复用但未抽象
- DevHub 有几乎相同的实现（重复代码）

### 3. 当前问题总结

| 问题类别 | 具体问题 | 影响范围 |
|---------|---------|---------|
| **代码重复** | Desktop 和 DevHub 有相同的事件监听逻辑 | Desktop, DevHub |
| **结构不一致** | BlueprintAgent 用类，Desktop/DevHub 用函数 | 所有 Agent |
| **概念冗余** | startFn 概念引入不必要的间接层 | BlueprintAgent |
| **性能浪费** | 每次调用重新构建 startFn | BlueprintAgent |
| **职责不清** | start 方法既管理生命周期又处理业务逻辑 | 所有 Agent |

## 任务目标

### 核心目标
**提供统一的 start 方法**，用于：
1. 创建 Agent 实例（已由 AgentRegistry 完成）
2. 将 context 与实例绑定
3. 提供运行环境（Tab、background 等）

### 具体要求

#### 1. 不增加复杂度
- ✅ 利用现有的 TabExecutor 和 TabExecutionManager
- ✅ 不引入新的抽象层（如 RunnableAgentBase）
- ✅ 调整代码结构，而非重写架构

#### 2. 保持职责清晰
- `TabExecutor` - 负责启动、绑定 Tab 的能力（已完成）
- `Agent.start()` - 负责 Agent 内部的执行逻辑
- `buildPromptAgentStart()` - 提供通用的 PromptAgent 执行模式

#### 3. 消除代码重复
- Desktop 和 DevHub 的事件监听逻辑应复用
- BlueprintAgent 不应每次重新构建 startFn

## 设计方案

### 方案概述

**核心思想**：将 start 方法的职责明确分为两层：
1. **外层（生命周期管理）** - 由基类或辅助函数处理
   - 事件监听器注册/清理
   - Runtime context 绑定
   - 子 Agent 进度转发
2. **内层（业务逻辑）** - 由具体 Agent 实现
   - Prompt 构建
   - Tool 定义
   - 特定逻辑

### 方案细节

#### 选项 A：提取事件监听辅助函数（推荐）

**优点**：
- ✅ 最小改动
- ✅ 不改变现有类结构
- ✅ 消除重复代码

**实现**：
```typescript
// packages/agents/runtime/helpers/eventListeners.ts
export function createChildAgentListeners(options: {
    agentId: string;
    eventBus: EventBus;
    messageStore: any;
    onComplete?: () => void;
}) {
    const activeChildAgents = new Set<string>();
    let handleCompleted = false;
    
    const handlers = {
        onAgentText: (event: any) => { /* 转发逻辑 */ },
        onAgentEvent: (event: any) => { /* 转发逻辑 */ },
        onAgentCompleted: (event: any) => { /* 转发逻辑 */ },
    };
    
    return {
        register: () => {
            options.eventBus.on('agent:text', handlers.onAgentText);
            options.eventBus.on('agent:event', handlers.onAgentEvent);
            options.eventBus.on('agent:completed', handlers.onAgentCompleted);
        },
        cleanup: () => {
            options.eventBus.off('agent:text', handlers.onAgentText);
            options.eventBus.off('agent:event', handlers.onAgentEvent);
            options.eventBus.off('agent:completed', handlers.onAgentCompleted);
        },
        attachToHandle: (handle: ExecutionHandle) => {
            handle.completion.finally(() => {
                handleCompleted = true;
                if (activeChildAgents.size === 0) {
                    this.cleanup();
                }
            });
        },
    };
}
```

**使用示例**：
```typescript
// Desktop Agent
start: (userInput: string, context: AgentStartContext, sinks: AgentStartSinks) => {
    const listeners = createChildAgentListeners({
        agentId: 'start',
        eventBus: options.eventBus,
        messageStore: options.messageStore,
    });
    
    listeners.register();
    
    const handle = start(userInput, context, sinks);
    
    listeners.attachToHandle(handle);
    
    return handle;
}
```

#### 选项 B：BlueprintAgent 优化 startFn 构建

**问题**：每次调用都重新构建 startFn
**方案**：将 startFn 构建移到构造函数

```typescript
export class BlueprintAgent extends PromptAgent implements RunnableAgent {
    private startFn: ReturnType<typeof buildPromptAgentStart>;
    
    constructor(private deps: BlueprintAgentDeps) {
        super();
        
        // 构造时构建一次
        this.startFn = buildPromptAgentStart({
            getPrompt: (userInput: string) => userInput.trim(),
            getSystemPrompt: () => this.deps.systemPrompt,
            getAgentDefinitions: () => this.deps.agentDefinitions,
            getMcpTools: (ctx) => {
                // 动态获取 tool
                this.setRuntimeContext({
                    sourceTabId: ctx.sourceTabId,
                    workspacePath: ctx.workspacePath,
                    parentAgentId: ctx.rawContext?.parentAgentId ?? BLUEPRINT_AGENT_ID,
                });
                const tool = this.asMcpTool();
                return tool ? { [this.id]: tool } : undefined;
            },
        });
    }
    
    start(userInput: string, context: AgentStartContext, sinks: AgentStartSinks): ExecutionHandle {
        // 直接调用，无需重新构建
        return this.startFn(userInput, context, sinks);
    }
}
```

**优点**：
- ✅ 性能优化
- ✅ 代码更简洁

**问题**：
- ⚠️ getMcpTools 在构造时调用，但 runtime context 是动态的
- 解决：getMcpTools 内部动态调用 setRuntimeContext

## 实施计划

### Phase 1: 提取事件监听辅助函数（优先级：高）

**目标**：消除 Desktop 和 DevHub 的重复代码

**步骤**：
1. 创建 `packages/agents/runtime/helpers/eventListeners.ts`
2. 提取通用事件监听逻辑
3. 修改 Desktop Agent 使用辅助函数
4. 修改 DevHub Agent 使用辅助函数
5. 测试验证

**验收标准**：
- [ ] Desktop 和 DevHub start 方法代码行数减少 50%
- [ ] 功能测试通过（子 Agent 进度正常转发）
- [ ] 无新增 bug

### Phase 2: 优化 BlueprintAgent startFn 构建（优先级：中）

**目标**：消除性能浪费，简化代码

**步骤**：
1. 将 startFn 构建移到构造函数
2. 确保 getMcpTools 能动态获取 runtime context
3. 简化 start 方法实现
4. 测试验证

**验收标准**：
- [ ] BlueprintAgent.start() 不再重新构建 startFn
- [ ] 功能测试通过
- [ ] 性能基准测试显示改进

### Phase 3: 文档和最佳实践（优先级：低）

**目标**：为未来 Agent 开发提供指导

**步骤**：
1. 更新 Agent 开发指南
2. 提供 start 方法实现模板
3. 添加架构决策记录（ADR）

## 风险和缓解措施

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 事件监听器清理逻辑出错 | 内存泄漏 | 详细单元测试，压力测试 |
| Runtime context 绑定时机错误 | 功能异常 | 集成测试覆盖所有调用场景 |
| 破坏现有 Agent 功能 | 系统不可用 | 渐进式重构，充分回归测试 |

## 成功标准

### 代码质量
- [ ] Desktop 和 DevHub 无重复事件监听代码
- [ ] BlueprintAgent 无性能浪费
- [ ] 所有 Agent 的 start 方法职责清晰

### 测试覆盖
- [ ] 所有 Agent 的集成测试通过
- [ ] 事件监听器清理逻辑单元测试覆盖
- [ ] 性能基准测试显示改进或无退化

### 文档完整
- [ ] Agent 开发指南更新
- [ ] 架构决策记录完整
- [ ] 代码注释清晰

## 参考资料

### 相关文件
- `packages/execution/TabExecutor.ts` - Agent 执行入口
- `packages/agents/runtime/runPromptAgentStart.ts` - 通用 PromptAgent 启动逻辑
- `packages/agents/blueprint/BlueprintAgent.ts` - Blueprint Agent 实现
- `packages/agents/desktop/index.ts` - Desktop Agent 实现
- `packages/agents/devhub/index.ts` - DevHub Agent 实现

### 架构文档
- `AGENTS.md` - Agent 开发规范
- `docs/architecture/` - 架构设计文档（待创建）

## 附录

### A. 当前调用流程图

```
用户输入 → TabExecutor.execute()
              ↓
         TabExecutionManager.execute()
              ↓ (并发控制、队列管理)
         TabExecutor.executeAgent()
              ↓
         agent.start(userInput, context, sinks)
              ↓
         ┌─────────────────┬──────────────────┐
         ↓                 ↓                  ↓
    BlueprintAgent    Desktop Agent      DevHub Agent
         ↓                 ↓                  ↓
    setRuntimeContext  事件监听注册     事件监听注册
         ↓                 ↓                  ↓
    buildPromptAgentStart  ↓                  ↓
         ↓                 ↓                  ↓
    startFn(...)      start(...)         start(...)
         ↓                 ↓                  ↓
    执行 AI 流         执行 AI 流          执行 AI 流
```

### B. 术语表

| 术语 | 定义 |
|------|------|
| **Runtime Context** | Agent 运行时上下文（sourceTabId, workspacePath, parentAgentId） |
| **ExecutionHandle** | Agent 执行句柄（包含 cancel, sessionId, completion） |
| **AgentStartSinks** | Agent 事件回调（onText, onEvent, onCompleted, onFailed） |
| **EventBus** | 全局事件总线，用于 Agent 间通信 |
| **TabExecutor** | Tab 执行器，负责 Agent 执行的生命周期管理 |
| **buildPromptAgentStart** | 通用 PromptAgent 启动函数构建器 |

---

**创建时间**: 2025-11-12  
**最后更新**: 2025-11-12  
**负责人**: AI Coding Agent  
**状态**: Draft
