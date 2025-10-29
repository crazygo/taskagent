---

# Docs Memory Agent (Leaf)

This page defines the method (方法) for producing content in `memory/docs/` using Serena MCP memories. Do not specify item-level extraction rules here.

## 方法（基于 Serena 记忆工具生成）
1) 发现（Discovery）
   - 使用 Serena MCP：`list_memories` 列出可用的命名记忆
   - 选择与本次文档主题相关的记忆名称集合

2) 取数（Collection）
   - 对所选名称执行 `read_memory`
   - 将读到的内容按主题归并，记录来源与时间戳

3) 组装（Synthesis）
   - 从命名记忆中提炼高信号信息，形成：
     - 叙述性文档（.md）：面向开发者/评审，结构化小节、链接、结论
     - 或 衍生的结构化附录（.jsonl）：当且仅当需要程序化检索时生成

4) 落盘（Persist）
   - 叙述性文档：`memory/docs/{YYYY-MM-DD-HH-mm}-{document-name}.md`
   - 结构化附录（可选）：`memory/docs/{YYYY-MM-DD-HH-mm}-{topic}.jsonl`
   - 文件头或末尾注明：来源的 MCP 命名记忆清单与生成时间

5) 维护（Maintain）
   - 文档更新前，先 `read_memory` 进行对照；变更同步回命名记忆请用 `write_memory`（读-改-写）
   - 避免重复：当信息适合长期复用时，优先更新 MCP 命名记忆，再由本文方法再生文档

## 产物要求
- 文档面向读者清晰、短小精悍，强调决策、结论与依据
- 若生成 `.jsonl` 附录，其字段与类型与项目既有规范对齐，但不在此处定义细则

## 禁止事项
- 不在本页定义条目级抽取规则或字段细节
- 不在本目录直接写文件，需要传递路径给 MCP 工具，由 MCP 工具负责写文件。



