# Source Code Conventions (src/)

## Scope
- 本文件仅作用于 `src/` 目录及其子目录（优先级覆盖根 AGENTS.md 的通用规则）。
- 约束实现层的代码结构、消息流/状态管理、流式处理、终端 UI（Ink）细节、性能与调试策略。

## Code Map
- 单文件入口（TUI）：`ui.tsx`
  - Components（实现/职责）：
    - `WelcomeScreen`：展示版本/模型/工作目录
    - `MessageComponent`：渲染消息（user/assistant/system），支持多行与 reasoning 段
    - `ActiveHistory`：活动区实时消息区域
    - `App`：核心容器，持有状态与 AI 交互逻辑
  - 重要模块与目录：
    - `src/components/*`、`src/hooks/*`、`src/domain/*`

## State & Streams
- 双轨消息系统：
  - `frozenMessages`：已完成消息（Static 输出，追加后不再重绘）
  - `activeMessages`：当前会话活动消息（流式增量更新）
- 流式处理：
  - AI 文本与 reasoning 分块到来时增量写入对应消息
  - 输出较长时分段渲染，避免一次性重绘造成卡顿
- 渲染节流：
  - 渲染更新以 ~100ms 为节流粒度，减少 TUI 抖动
- 渐进式冻结（性能优先）：
  - 每条消息（或消息块）完成即从 active 冻结到 frozen，保持活动区精简

## AI Integration Pattern（会话、权限、错误）
- 会话：
  - 初始化/恢复 session（必要时持久化到工作区设置）
- 权限：
  - 工具调用触发权限请求 → 展示确认面板 → 用户批准/拒绝 → 以 system 消息记录结果
- 错误：
  - 捕获 SDK/网络/业务错误，向用户展示精简可读信息（boxed system）
  - 详细堆栈/上下文写入 `debug.log`

## Patterns & Conventions
- Message Management：
  - 仅在必要时创建新消息；其余基于消息 id 增量更新 content/reasoning
  - 完成即冻结，禁止让 activeMessages 无限制增长
- State Updates：
  - 使用函数式 setState 保证原子性；禁止依赖外部闭包变量在多次 setState 之间传递
- Error Boundaries：
  - try/catch 只包围可能抛错的 I/O 与 SDK 交互；用户可读 vs 技术细节分离（终端 vs 日志）

## Terminal UI（Ink 注意事项）
- Static 区域只追加不重绘，历史消息一经冻结不可变
- 文本渲染需 ASCII-safe，避免控制字符影响布局
- 使用 Ink 的 flexbox 进行布局，避免过宽行导致换行异常

## Performance
- 增量更新 map：只更新变更的消息，避免全量重绘
- 控制日志量，避免对渲染主循环产生干扰
- 优先冻结策略：小 active，大 frozen

## Debugging
- `debug.log`：记录启动/提交/权限/错误/异常堆栈等完整上下文
- 复现问题提供：时间窗口、操作序列、终端截图与日志片段

## Do & Don’t
- Do：
  - 每个完成事件立刻冻结相应消息
  - 权限消息保留并显示操作结果（Approved/Denied），随后冻结
  - 将详细错误与堆栈写入日志
- Don’t：
  - 在 finalize 过程中通过外部闭包在多次 setState 间传值
  - 将长文本一次性写入导致终端阻塞
