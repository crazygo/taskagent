# 重构路线图 v2.0 - 待确认问题清单

**日期**: 2025-11-04 17:00  
**文档**: `memory/docs/2025-11-04-refactor-roadmap-v2.md`  
**目的**: 列出所有需要用户确认的设计选择

---

## 🔧 构建和工具链

### ❓ 问题 1: 是否需要 Turbo 构建工具？

**当前设计** (第 82 行):
```
├── package.json
└── turbo.json    # 构建配置
```

**选项**:
- **A. 使用 Turbo** - 提供缓存、并行构建等能力，但单包架构可能用不上
- **B. 不使用 Turbo** - 单包架构无需复杂构建编排，直接使用 `tsc` 或 `tsup`
- **C. 延后决定** - Phase 1 先不引入，等需要时再加

**建议**: 选择 **B** 或 **C**，单包架构不需要 Turbo

---

## 📱 Tab 和模式定义

### ❓ 问题 2: Tab 类型的三种模式区别？

**当前设计** (第 796 行):
```typescript
type: 'chat' | 'agent' | 'agent-driven'
```

**问题**:
- `'chat'` 和 `'agent'` 的区别是什么？
- 为什么有 `'agent'` 和 `'agent-driven'` 两种？

**可能的理解**:
- **A. Chat = Vercel SDK, Agent = 通用 Agent tab, Agent-Driven = 特定 Driver Agent**
- **B. Chat = 简单对话, Agent = 手动选择 Agent, Agent-Driven = 固定绑定 Agent**
- **C. 简化为两种**: `'chat'` 和 `'agent'`（Agent-driven 是冗余的）

**需要澄清**: 三种模式的具体区别和使用场景

---

## 🎯 性能指标

### ❓ 问题 3: 性能基准是否合理？

**当前设计** (第 299-302 行):
```
- 启动时间: < 1s
- Tab 切换: < 100ms
- 内存占用: < 100MB
```

**问题**:
- 这些指标是基于现状测试还是理想目标？
- 是否有降级方案（如果达不到）？

**选项**:
- **A. 保持当前目标** - 激进但可行
- **B. 放宽指标** - 启动 < 2s, Tab 切换 < 200ms, 内存 < 150MB
- **C. 分阶段目标** - Phase 0-3 达到宽松目标，Phase 4-7 优化到严格目标

---

## 💬 消息管理

### ❓ 问题 4: 不可见 Tab 消息限制数量？

**当前设计** (第 718-720 行):
```typescript
// 不可见 Tab 限制消息数量（性能优化）
if (tabId !== this.currentTabId && messages.frozen.length > 100) {
    messages.frozen = messages.frozen.slice(-100);
}
```

**问题**:
- 100 条是否合适？
- 是否需要配置化（不同 Tab 不同限制）？
- Monitor Tab 是否需要更大限制（如 1000 条）？

**选项**:
- **A. 统一 100 条** - 简单一致
- **B. 可配置** - 在 TabConfig 中添加 `maxFrozenMessages?: number`
- **C. 按 Tab 类型** - Chat = 100, Agent = 500, Monitor = 1000

---

### ❓ 问题 5: MessageAdapter 的 onCompleted/onFailed 是否创建 UI 消息？

**当前设计** (第 948-968 行):
```typescript
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
```

**问题**:
- CLI 层是否需要订阅 `agent:completed` 并显示 "✅ 任务完成" 之类的消息？
- 还是只在日志中记录？

**选项**:
- **A. 不显示 UI 消息** - 只记录日志，保持界面简洁
- **B. 显示简洁提示** - "✅ 完成" 或 "❌ 失败: {error}"
- **C. 可配置** - 在 preset 中配置是否显示

---

## 🔐 Session 管理

### ❓ 问题 6: Session 是否需要持久化？

**当前设计**: 文档未明确说明

**问题**:
- Session ID 是否需要保存到文件（如 `.taskagent/sessions.json`）？
- 重启应用后是否需要恢复 Session？

**选项**:
- **A. 不持久化** - 每次启动创建新 Session（简单）
- **B. 持久化到内存** - TabExecutionState 中保存，重启丢失
- **C. 持久化到文件** - 保存并恢复（复杂，但用户体验好）

**建议**: 先选择 **B**，Phase 7 后考虑 **C**

---

## 🔗 Agent 和 Tab 绑定

### ❓ 问题 7: Agent 和 Tab 的绑定关系？

**当前设计**: 似乎是一对一绑定

**问题**:
- 一个 Tab 是否可以切换不同 Agent（如 Agent Tab 可以选择 Story/Glossary）？
- 还是固定绑定（Story Tab 只能用 Story Agent）？

**选项**:
- **A. 固定绑定** - 每个 Tab 绑定一个 Agent（简单）
  ```typescript
  agentId: 'story'  // 固定
  ```
- **B. 可切换 Agent** - Agent Tab 可以动态选择
  ```typescript
  type: 'agent',
  availableAgents: ['story', 'glossary', 'ui-review']  // 可选
  ```
- **C. 混合模式** - 部分 Tab 固定，部分可切换

**当前文档倾向**: **A**（固定绑定）

---

## 🧪 测试策略

### ❓ 问题 8: 测试覆盖率目标是否合理？

**当前设计**:
- Phase 0: > 60% (第 307 行)
- 最终目标: > 70% (第 1320 行)

**问题**:
- 60% → 70% 的增量是否足够？
- 哪些模块需要 100% 覆盖（如 Event Bus、MessageAdapter）？

**选项**:
- **A. 保持当前目标** - 60% → 70%
- **B. 提高最终目标** - 60% → 80%
- **C. 分模块目标** - 核心层 90%+，业务层 60%+

---

## 🚀 Event Bus 设计

### ❓ 问题 9: Event 版本控制策略？

**当前设计** (第 459 行):
```typescript
version: '1.0'
```

**问题**:
- 如果 Event 结构需要演进（如添加新字段），如何处理？
- 是否需要版本兼容机制？

**选项**:
- **A. 固定 1.0** - 不考虑演进（简单）
- **B. 语义化版本** - 1.0, 1.1, 2.0（支持演进）
- **C. Schema 演进** - 使用 Zod 的可选字段，向后兼容

**建议**: 先选择 **A**，Phase 7 后考虑 **C**

---

### ❓ 问题 10: Event Bus 是否支持通配符订阅？

**当前设计**: 只支持精确订阅
```typescript
eventBus.on('agent:text', handler)
```

**问题**:
- 是否需要订阅所有 agent 事件？
  ```typescript
  eventBus.on('agent:*', handler)  // 通配符
  ```

**选项**:
- **A. 不支持通配符** - 保持简单，明确订阅
- **B. 支持通配符** - 使用 `mitt` 或 `eventemitter3` 替代原生 EventEmitter
- **C. 自定义通配符** - 在 EventBus 内部实现

**建议**: **A**（不支持），如果需要可以订阅多个事件

---

## 🏗️ 架构细节

### ❓ 问题 11: TabConfig 中的 executionMode 如何使用？

**当前设计** (第 803 行):
```typescript
executionMode: 'foreground' | 'background'
```

**问题**:
- 当前所有示例都是 `'foreground'`
- `'background'` 模式的使用场景是什么？
- 是否与 fork session 相关？

**需要澄清**: `executionMode` 的具体含义和使用场景

---

### ❓ 问题 12: 是否需要全局命令（跨 Tab）？

**当前设计**: 命令似乎是 Tab 级别的

**问题**:
- 是否需要全局命令（如 `/help`, `/version`, `/quit`）？
- 还是每个 Tab 都有自己的命令集？

**选项**:
- **A. 只有 Tab 级命令** - 每个 Tab 独立
- **B. 全局 + Tab 命令** - 部分命令全局可用
- **C. 统一命令注册** - CommandRegistry 管理所有命令

---

## 🔀 Phase 顺序

### ❓ 问题 13: Phase 1 是否太激进？

**当前设计**: Phase 1 同时迁移 core, ai-runtime, agents, cli

**问题**:
- 是否一次性变动太大？
- 是否应该拆分为多个 Phase？

**选项**:
- **A. 保持当前 Phase 1** - 一次性完成 Monorepo 重组
- **B. 拆分 Phase 1** - 
  - Phase 1a: 创建 packages/ 结构，迁移 core
  - Phase 1b: 迁移 ai-runtime
  - Phase 1c: 迁移 agents 和 cli
- **C. 渐进式迁移** - 每个 package 独立为一个 Phase

---

## 📦 Package 命名

### ❓ 问题 14: Package 命名约定？

**当前设计**: 使用 `@taskagent/xxx` scope

**问题**:
- 是否需要发布到 npm？
- 如果不发布，是否需要 scope？

**选项**:
- **A. 保持 @taskagent scope** - 为未来发布预留
- **B. 无 scope** - 简化配置（如 `taskagent-core`）
- **C. 私有 scope** - 使用 private registry

---

## 📊 总结

### 高优先级（必须确认）

1. ✅ **问题 2**: Tab 类型的三种模式区别
2. ✅ **问题 7**: Agent 和 Tab 的绑定关系
3. ✅ **问题 11**: executionMode 的使用场景
4. ⚠️ **问题 1**: 是否需要 Turbo
5. ⚠️ **问题 6**: Session 是否持久化

### 中优先级（建议确认）

6. **问题 4**: 不可见 Tab 消息限制
7. **问题 5**: onCompleted/onFailed 的 UI 消息
8. **问题 12**: 是否需要全局命令
9. **问题 13**: Phase 1 是否拆分

### 低优先级（可延后）

10. **问题 3**: 性能基准微调
11. **问题 8**: 测试覆盖率微调
12. **问题 9**: Event 版本控制
13. **问题 10**: Event Bus 通配符
14. **问题 14**: Package 命名

---

**建议**: 先确认高优先级问题（1-5），其余可以在实现过程中调整




