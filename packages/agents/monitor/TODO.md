# Monitor Agent 实现待办事项

## 已完成 ✅
1. **ReviewAgent 设计与实现**
   - coordinator.agent.md (自然语言驱动)
   - 3个子PromptAgent: specs_breakdown, task_log, git_diff
   - index.ts (RunnableAgent 实现)
2. **需求场景定义** (features/core_behaviors.yaml - 8个场景)
3. **架构设计文档** (sonnet_design_monitor_mediator_architecture.md)

---

## 待实现 🔲

### 1. Mediator Agent (对话中介)
**优先级**: 🔴 高  
**位置**: `packages/agents/monitor/mediator/`  
**需要**:
- `mediator.agent.md` - Mediator 的 system prompt
  - 定义对话路由逻辑
  - 约束模型识别意图并生成后台任务描述
  - 工具列表: bg:coder, bg:review, start_loop, loop_terminate, loop_fetchlog
- `index.ts` - RunnableAgent 实现
- `channels.ts` - 双通道管理（对话通道 + 推送通道）
- `tools/` - 自定义工具实现
  - `bg_coder.ts` - 启动后台 Coder
  - `bg_review.ts` - 启动后台 ReviewAgent
  - `start_loop.ts` - 启动 Loop Manager
  - `loop_terminate.ts` - 终止 Loop
  - `loop_fetchlog.ts` - 获取 Loop 日志

### 2. Coder Agent (后台开发执行者)
**优先级**: 🔴 高  
**位置**: `packages/agents/monitor/coder/`  
**需要**:
- `coder.agent.md` - Coder 的 system prompt
  - 开发任务执行导向
  - 日志生成规范（coder.log 格式）
  - 完成信号机制
- `index.ts` - RunnableAgent 实现

### 3. Loop Manager (定时管理模块)
**优先级**: 🟡 中  
**位置**: `packages/agents/monitor/index.ts` (已存在，需扩展)  
**需要**:
- 定时触发 ReviewAgent 逻辑
- 健康度解析器 (`health/parser.ts`)
- 告警格式化 (`health/alert_formatter.ts`)
- 推送到 Mediator 的接口

---

## 实现顺序建议

### Phase 1: 核心 Agent 实现
1. Coder Agent (开发执行者)
2. Mediator Agent (对话中介)
3. 注册到 registry

### Phase 2: 集成测试
4. 手动测试基础场景 1-5（文件操作、后台任务、进展查询、完成审查）

### Phase 3: Loop 与健康度
5. 健康度模块（parser + formatter）
6. Loop Manager 实现
7. 测试场景 6-8（告警推送、终止循环）

---

## 关键依赖项

- ✅ ReviewAgent 已完成
- 🔲 Mediator 依赖: bg:coder, bg:review 工具
- 🔲 Loop Manager 依赖: ReviewAgent, 健康度模块, Mediator 推送接口
- 🔲 Coder 依赖: 日志格式规范
