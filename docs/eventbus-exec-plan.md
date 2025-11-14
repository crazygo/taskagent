# EventBus + Tab Execution Adoption Plan

## 1. Objectives
- 完成 Story / Glossary / Agent 前台链路的事件驱动改造，使消息渲染完全通过 `EventBus → MessageStore → UI`。
- 让所有前台/后台执行都统一经过 `TabExecutionManager` + `TabExecutor`，消除 `main.tsx` 中自维护的队列与 session 派生逻辑。
- 建立可持续的测试与验收流程（CLI smoke、Vitest、命令型脚本），保证改造后仍可无回归地交付。

## 2. Current Snapshot (2025-11-05)
- Story、Glossary、Agent tab 的工具流输出直接 `setFrozenMessages`，绕过 EventBus；导致 UI 与执行层依旧紧耦合。
- `TabExecutionManager` / `TabExecutor` 已在 `packages/execution/` 实现，但 `packages/cli/main.tsx` 仍靠 `agentPendingQueueRef` 和 `startAgentPrompt` 手写队列。
- `yarn test:ci` 汇总 Vitest；`yarn test:story` / `yarn test:glossary` / `yarn start:test` 可作 CLI 回归，但缺少结构化报告。
- 旧路径如 `src/workflow/startAgent.ts` 等仍在仓库中，存在双轨实现风险。

## 3. Workstreams & Tasks

### 3.1 EventBus + MessageStore 接入
1. **实现总线初始化**：
   - 在 CLI 入口创建单例 EventBus，并将其实例下传给消息渲染与执行层。
   - 建立 `MessageStore` 的事件订阅器，将 EventBus 事件归档到对应 tab。
2. **替换 sinks**：
   - Story / Glossary / Agent 的 sinks 改用 `MessageAdapter` 输出 EventBus 事件。
   - 统一 tool-use / tool-result 事件结构（必要时完善 schema + adapter）。
3. **UI 渲染调整**：
   - Ink 组件改为仅从 MessageStore 读取可见消息。
   - 移除直接 `setActiveMessages` / `setFrozenMessages` 的调用；保留临时状态（例如输入框）不受影响。
4. **验证**：
   - 新增单元测试覆盖事件回放与 tab 隔离。
   - CLI smoke：Story、Glossary、Agent 三个 tab 自动输入，确认输出、工具事件可见。

### 3.2 TabExecutionManager / TabExecutor 接管
1. **主路径接线**：
   - 将 `runAgentTurn` / `startAgentPrompt` 调用替换为 `TabExecutor.execute()`。
   - 传入统一的 `ExecutionContext`（含 session、workspace、权限回调）。
2. **移除手写队列**：
   - 删除 `agentPendingQueueRef`、`setIsAgentStreaming` 相关的队列控制，全部交由 `TabExecutionManager`。
3. **后台任务统一**：
   - `startBackground` / `startForeground` 通过 TabExecutor（或共享执行辅助）走相同排队、session 管理逻辑。
4. **Session 策略确认**：
   - 明确 `forkSession`、resume、并发时的 session 更新规则；必要时扩展 `TabExecutionManager` 的 API。

### 3.3 测试与基线
1. **Phase 0 快照**：持续运行 `yarn test:ci`, `yarn test:story`, `yarn test:glossary`, `yarn start:test`，把结果写入 docs/memory。 
2. **新测试**：
   - Vitest：为 EventBus + MessageStore 添加订阅与回放单测；为 TabExecutionManager 增补并发/队列覆盖。
   - CLI smoke：使用 expect/tsx 或 expect.js 版脚本对多个 tab 发送 prompt 并校验输出。
3. **监控**：确保 `debug.log` / `task-logger` 仍能捕获工具与状态事件。

### 3.4 Cleanup & Follow-up
1. 大幅删减或封装 `src/workflow/*`、旧 driver adapter，避免双轨。
2. 为 CLI 入口添加 Feature Flag（如 `TA_EVENTBUS_MODE`），便于阶段性回滚。
3. 更新文档：`README.md`、`docs/refactor_acceptance_criteria.md`、新建升级记录。

## 4. Delivery Phases
- **Wave A（P0）**：完成 Story/Glossary/Agent 的事件化与 TabExecutor 接入，全部测试通过；提交验收文档。
- **Wave B（P1）**：报告基线、旧路径整理、flag 化；上线 smoke 测试脚本。
- **Wave C（P2+）**：引入更多 tab/preset 的自动验证，持续清理 legacy。

## 5. Risks & Mitigations
| 风险 | 影响 | 缓解措施 |
| ---- | ---- | -------- |
| EventBus 与现有状态管理割裂导致渲染闪烁 | CLI 体验下降 | 在切换前保留本地缓存，分步骤迁移；提供 Feature Flag 回滚 |
| 队列语义调整引入 session 回归 | Agent 输出丢失或串线 | 为 TabExecutionManager 补充并发/恢复单测；在 smoke 测试中覆盖复用 session 场景 |
| CLI smoke 可靠性不足 | 无法在 CI 捕获回归 | 采用 `yarn start:test` + expect 脚本固定超时时间，并在 docs 记录操作手册 |

## 6. Open Questions
1. 是否需要为工具事件拓展标准 payload（如 duration、input 抽象）？
2. Background tab、Monitor tab 是否与主执行器共用队列还是独立实例？
3. 是否保留旧状态流以便快速回滚，还是一次性迁移？
4. 需要为多入口（`taskagent` vs `taskagent-monitor`）分别配置 MessageStore，还是全局共享？

## 7. Acceptance Checklist
- [ ] Story / Glossary / Agent 使用 EventBus + MessageStore 渲染消息。
- [ ] TabExecutor 成为唯一 agent 执行入口；无遗留 `agentPendingQueueRef`。
- [ ] `yarn test:ci`、`yarn test:story`、`yarn test:glossary`、`yarn start:test` 全绿并记录基线。
- [ ] 新增 EventBus / Execution 层测试覆盖。
- [ ] Legacy 路径文档化，具备回滚策略。
