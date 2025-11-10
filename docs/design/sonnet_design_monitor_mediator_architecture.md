# Monitor Agent Architecture Design

**Date**: 2025-11-05  
**Version**: 1.0

---

## Overview

Monitor Agent 是一个具备质量监督与任务编排能力的智能代理系统，通过 **DevHub 中介模式** 实现人类对话、后台任务执行与质量审查的闭环管理。

---

## Architecture Components

### 1. Monitor Agent (质量监督 & 编排控制)

**角色定位**: 顶层协调者，封装系统提示，聚焦任务质量监控。

**核心能力**:
- 质量监督导向的 system prompt
- 消息收发基础能力（同 UI 层）
- **双通道架构**：
  - **对话通道**: DevHub ⇄ User（人机交互）
  - **任务管理通道**: Loop Manager → DevHub（主动推送）
- Loop 调度权与生命周期管理
- 子代理编排与状态汇总
- 健康度结构化拆解与告警路由

---

### 2. DevHub Agent (人机对话中介)

**角色定位**: 默认激活的人类交互接口，承担所有对话与工具调用路由。

**核心能力**:
- 人类对话的唯一入口（User ⇄ DevHub）
- 路由需求到后台任务
- 管理 Loop 生命周期
- 汇总并反馈完成状态

**暴露工具**:
- `start_loop`: 启动 Loop Manager（定时质量检查）
- `loop_terminate`: 终止 Loop Manager 执行
- `loop_fetchlog`: 拉取 Loop 进度与日志
- `bg:coder_agent`: 后台执行开发任务（非阻塞）

**双通道机制**:
1. **对话通道**（User → DevHub）:
   - 用户主动提问/指令
   - 同步响应
   
2. **任务推送通道**（Loop Manager → DevHub → User）:
   - 健康度告警主动推送
   - 异步插入对话流
   - 示例：`⚠️ 严重问题检测：specs_breakdown 发现 3 处规格偏离`

**约束**:
- Loop 默认关闭，需显式触发
- 任一用户消息或 UI 按钮可终止 Loop
- 对话不阻塞后台任务
- 推送消息带有 `[AUTO]` 标记以区分主动/被动消息

---

### 3. Coder Agent (后台开发执行者)

**角色定位**: 后台执行具体开发任务的代理。

**触发方式**: 
```
User: "做一个功能 X"
DevHub → bg:coder_agent "实现功能 X"
```

**输出**:
- 代码变更（commits）
- 文件修改记录
- 任务日志

**执行特性**:
- 后台运行，不阻塞 DevHub 对话
- 完成后通知 DevHub 汇总

---

### 4. Loop Process (定时审查循环)

**角色定位**: 后台定时器，周期性触发 Check Agent 执行质量检查。

**默认状态**: OFF（需 DevHub 通过 `start_loop` 激活）

**退出条件**:
- 用户消息（任意输入）
- UI 按钮触发
- `loop_terminate` 工具调用

**配置项**:
- 周期间隔（可配置）
- 日志缓冲大小
- 审查报告存储路径

---

### 5. Check Agent (组合型审查代理)

**角色定位**: 质量审查的执行单元，装配多个子代理并合成**单次**审查报告。

**触发方式**: 由 Loop Manager 定时调用（非自主循环）

**架构模式**: 同 Glossary Driver（初始化时装配子代理并合并配置）

**子代理**:
1. **specs_breakdown**: 分析需求规格与实现匹配度
2. **task_log**: 解析任务日志与执行轨迹
3. **git_diff**: 检查代码变更与影响范围

**输出**: 统一的审查报告（Audit Report），包含：
- 规格符合度评分
- 任务执行状态
- 代码变更摘要
- **健康度评级**（normal/warning/critical）
- 质量风险标记

**约束**: ReviewAgent 只负责生成报告，不处理循环逻辑和主动推送

---

## ASCII Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                               Monitor Agent                                  │
│                  (Quality Supervision & Orchestration Control)               │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                       Loop Manager (index.ts)                          │ │
│  │                    (定时管理 & 健康度监控 - 非 Agent)                    │ │
│  │                                                                        │ │
│  │  • 定时触发 ReviewAgent                                                │ │
│  │  • 结构化拆解审查报告                                                   │ │
│  │  • 严重问题 → 主动推送到 DevHub                                        │ │
│  └──────────────────────┬───────────────────────┬─────────────────────────┘ │
└─────────────────────────┼───────────────────────┼───────────────────────────┘
                          │                       │
                          │ periodic trigger      │ push alerts
                          ▼                       ▼
              ┌─────────────────────┐   ┌─────────────────────────┐
              │   ReviewAgent       │   │   DevHub Agent          │
              │  (单次审查执行)      │   │  (对话 & 推送中介)       │
              ├─────────────────────┤   ├─────────────────────────┤
              │ Sub-agents:         │   │ 双通道:                 │
              │  ├─► specs_breakdown│   │  1. 对话通道 ⇄ User     │
              │  ├─► task_log       │   │  2. 推送通道 ⇐ Loop Mgr │
              │  └─► git_diff       │   │                         │
              │                     │   │ Tools:                  │
              │ Output:             │   │  • start_loop           │
              │  └─► Audit Report   │   │  • loop_terminate       │
              │      + Health级别   │   │  • loop_fetchlog        │
              └─────────────────────┘   │  • bg:coder_agent       │
                                        └───────┬─────────────────┘
                                                │         ▲
                                     对话通道    │         │ 推送通道
                                                │         │ [AUTO] alerts
                                                ▼         │
                                        ┌───────────────┐ │
                                        │     User      │ │
                                        │               │ │
                                        │ "做一个功能"   │ │
                                        └───────┬───────┘ │
                                                │         │
                                                └─────────┘
                                   
                       ┌────────────────────────┴─────────┐
                       │                                  │
                       ▼                                  │
              ┌─────────────────┐                        │
              │  Coder Agent    │                        │
              │  (Background)   │                        │
              │                 │                        │
              │  执行开发任务    │                        │
              │  /bg:coder xxx  │                        │
              └────────┬────────┘                        │
                       │                                  │
                       │ task execution                   │
                       ▼                                  │
              ┌─────────────────┐                        │
              │  Code Changes   │                        │
              │  Commits        │ ───────────────────────┘
              │  Files Modified │   (触发 ReviewAgent 检查)
              └─────────────────┘
```

---

## Interaction Flow (闭环交互)

```
User ──"做功能 X"──► DevHub
                       │
                       ├──► bg:coder_agent ──► 开发任务
                       │         │                │
                       │         └────────────────┤
                       │                          ▼
                       │                    Code Changes
                       │                          │
                       ├──► start_loop           │
                       │         │                │
                       │         ▼                │
                       │    Loop Manager ◄────────┘
                       │    (index.ts)            (检查代码)
                       │         │
                       │         ├──► periodic tick
                       │         │         │
                       │         │         ▼
                       │         │    ReviewAgent
                       │         │         │
                       │         │         ├─► specs_breakdown
                       │         │         ├─► task_log
                       │         │         └─► git_diff
                       │         │         │
                       │         │         ▼
                       │         │    Audit Report + Health级别
                       │         │         │
                       │         ├─────────┤
                       │         │  拆解健康度
                       │         │         │
                       │         │    [if critical]
                       │         │         │
                       │         └─────────┴──► 主动推送 [AUTO]
                       │                             │
                       ◄─────────────────────────────┘
                       │
                       ├──► [AUTO] ⚠️ 严重问题：规格偏离
                       │
User ◄─────────────────┘
  (完成状态 & 质量报告)
  
  
═══════════════════════════════════════════════════════════
  双通道示例：
  
  对话通道:
    User: "进度如何？"
    DevHub: "Coder 已完成 70%，当前无严重问题。"
  
  推送通道:
    [AUTO] Loop Manager → DevHub → User:
    "⚠️ 检测到 git_diff 显示 3 个核心文件未测试覆盖"
═══════════════════════════════════════════════════════════
```

---

## Closed-Loop Process (闭环说明)

### Phase 1: 需求提交
- **Actor**: User
- **Action**: 向 DevHub 提出开发需求
- **Example**: "实现用户登录功能"

### Phase 2: 任务执行
- **Actor**: DevHub
- **Action**: 启动 `bg:coder_agent` 后台执行开发任务
- **Behavior**: 非阻塞，用户可继续对话

### Phase 3: 质量监控
- **Actor**: DevHub
- **Action**: 启动 `start_loop`，激活 Loop Manager
- **Behavior**: Loop Manager 定时触发 ReviewAgent 执行单次审查

### Phase 4: 审查报告
- **Actor**: ReviewAgent
- **Action**: 分析 specs/logs/diff，生成审查报告
- **Output**: Audit Report（规格符合度、任务状态、代码质量、健康度级别）

### Phase 5: 健康度监控与主动推送
- **Actor**: Loop Manager (index.ts)
- **Action**: 
  1. 结构化拆解 Audit Report
  2. 判断健康度级别（normal/warning/critical）
  3. 如果 `critical`，主动推送到 DevHub 的任务推送通道
- **Output**: 异步告警消息插入对话流（标记 `[AUTO]`）

### Phase 6: 结果总结
- **Actor**: DevHub
- **Action**: 汇总 Coder 完成状态 + ReviewAgent 报告 + 主动告警
- **Output**: 反馈给 User（完成状态 & 质量评估 & 风险预警）

---

## Agent Types & Patterns

### PromptAgent + sub-agents
- **specs_breakdown**
- **task_log**
- **git_diff**

**特性**: 完全由配置文件定义，作为子代理被调用。

### Coordinator (PromptAgent + sub-agents)
- **ReviewAgent**

**特性**: 组合型代理，初始化时装配多个 PromptAgent 子代理并合并配置，执行单次审查。

### DevHub-Agent (Dialog Interface)
- **DevHub Agent**

**特性**: 面向人类的对话接口，路由工具调用，管理后台任务生命周期。

### Background-Agent (Task Executor)
- **Coder Agent**

**特性**: 后台执行具体任务，完成后通知协调者。

---

## Key Design Principles

### 1. Non-Blocking Execution
- Coder Agent 与 Loop Process 均为后台运行
- DevHub 保持对话响应性
- 用户可随时查询进度或终止

### 2. Separation of Concerns
- **DevHub**: 对话路由 + 工具调用 + 双通道管理
- **Coder**: 开发执行
- **ReviewAgent**: 单次质量审查（无循环逻辑）
- **Loop Manager (index.ts)**: 定时管理 + 健康度拆解 + 主动推送
- **Monitor**: 全局编排

### 3. User Control
- Loop 默认关闭（显式激活）
- 任一用户消息可终止 Loop
- 提供 `loop_fetchlog` 查询进度

### 4. Quality-Focused Prompts
- 所有代理的 system prompt 聚焦任务质量监控
- 审查报告结构化（规格/日志/代码）
- 可配置的审查周期与阈值

---

## Configuration Schema (Draft)

```typescript
interface MonitorConfig {
  devhub: {
    defaultActive: boolean;           // 默认激活
    tools: string[];                   // 暴露的工具列表
    channels: {
      dialog: boolean;                 // 对话通道
      push: boolean;                   // 任务推送通道
    };
  };
  
  loopManager: {
    defaultEnabled: boolean;           // 默认关闭
    checkIntervalMs: number;           // 检查周期（毫秒）
    exitOnUserMessage: boolean;        // 用户消息退出
    healthThresholds: {
      normal: number;                  // 正常阈值
      warning: number;                 // 警告阈值
      critical: number;                // 严重阈值
    };
    autoPushOnCritical: boolean;       // 严重问题自动推送
  };
  
  reviewAgent: {
    subAgents: string[];               // 子代理列表
    reportPath: string;                // 报告存储路径
    healthMetrics: string[];           // 健康度指标字段
  };
  
  coder: {
    backgroundMode: boolean;           // 后台模式
    notifyOnComplete: boolean;         // 完成通知
  };
}
```

---

## Implementation Notes

### File Structure (Proposed)
```
packages/agents/monitor/
├── sonnet_design_monitor_mediator_architecture.md  (本文档)
├── system.prompt.md                                (Monitor 系统提示)
├── index.ts                                        (Loop Manager 核心实现)
│                                                   - 定时触发 ReviewAgent
│                                                   - 健康度拆解与告警路由
│                                                   - 生命周期管理
├── devhub/
│   ├── mediator.agent.md                           (DevHub 配置)
│   ├── channels.ts                                 (双通道管理)
│   ├── tools/
│   │   ├── start_loop.ts
│   │   ├── loop_terminate.ts
│   │   ├── loop_fetchlog.ts
│   │   └── bg_coder_agent.ts
├── coder/
│   └── coder.agent.md                              (Coder 配置)
├── review/
│   ├── review.agent.md                             (ReviewAgent 协调配置)
│   ├── agents/
│   │   ├── specs_breakdown.agent.md
│   │   ├── task_log.agent.md
│   │   └── git_diff.agent.md
├── health/
│   ├── parser.ts                                   (审查报告结构化拆解)
│   ├── thresholds.ts                               (健康度阈值配置)
│   └── alert_formatter.ts                          (告警消息格式化)
└── config/
    └── monitor.config.ts                           (全局配置)
```

### Integration with Existing System
- 参考 `drivers/glossary/` 的 PromptAgent + sub-agents 装配模式（ReviewAgent 装配）
- 复用 `drivers/story/` 的用户对话模式（DevHub 对话通道）
- 集成 MCP 工具（memory read/write、git 操作）
- 参考 Ink UI 的消息流机制实现双通道推送

---

## Future Enhancements

1. **Multi-Coder Support**: 并行执行多个开发任务
2. **Priority Queue**: ReviewAgent 优先级调度
3. **Incremental Reports**: 增量审查报告（diff-based）
4. **Custom Check Rules**: 用户自定义审查规则与健康度阈值
5. **Webhook Integration**: 完成通知推送到外部系统
6. **Historical Health Trends**: 健康度趋势分析与可视化
7. **Smart Throttling**: 根据健康度动态调整检查频率

---

## Key Implementation Details

### Loop Manager (index.ts) 核心逻辑

```typescript
// packages/agents/monitor/index.ts
class LoopManager {
  private intervalId: NodeJS.Timer | null = null;
  private reviewAgent: ReviewAgent;
  private devhub: DevHubAgent;
  
  async start(config: LoopConfig) {
    this.intervalId = setInterval(async () => {
      await this.tick();
    }, config.checkIntervalMs);
  }
  
  private async tick() {
    // 1. 触发 ReviewAgent 单次审查
    const report = await this.reviewAgent.execute();
    
    // 2. 结构化拆解健康度
    const health = HealthParser.parse(report);
    
    // 3. 持久化报告
    await this.persistReport(report, health);
    
    // 4. 严重问题主动推送到 DevHub
    if (health.severity === 'critical') {
      const alert = AlertFormatter.format(health);
      await this.devhub.pushToDialogChannel({
        type: 'auto_alert',
        tag: '[AUTO]',
        content: alert,
        timestamp: Date.now()
      });
    }
  }
  
  terminate() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
```

### DevHub 双通道实现

```typescript
// packages/agents/monitor/devhub/channels.ts
class DevHubChannels {
  // 对话通道：用户主动交互
  async handleDialogMessage(userMsg: string): Promise<string> {
    // 正常对话处理
    return await this.agent.chat(userMsg);
  }
  
  // 推送通道：Loop Manager 主动推送
  async pushToDialogChannel(alert: AutoAlert) {
    // 异步插入到消息流
    this.messageQueue.push({
      role: 'system',
      tag: '[AUTO]',
      content: alert.content,
      priority: 'high'
    });
    
    // 触发 UI 更新
    this.emit('auto_alert', alert);
  }
}
```

---

## References

- **Glossary Driver**: PromptAgent + sub-agents 装配模式
- **Story Driver**: 用户对话流程
- **MCP Tools**: Memory & Git 集成
- **Ink UI**: 终端界面交互模式与消息流

---

**End of Design Document**
