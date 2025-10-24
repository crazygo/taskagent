# TaskAgent

## VSCode 配置 Yarn Plug'n'Play

为了让 VSCode 识别 Yarn PnP 依赖（例如 `@openrouter/ai-sdk-provider`），在项目根目录依次执行以下步骤：

1. 运行 `yarn dlx @yarnpkg/sdks vscode`，生成供 VSCode 使用的 Yarn SDK 桥接文件。
2. 在 VSCode 中选择工作区 TypeScript 版本：`⇧⌘P`（或 `Ctrl+Shift+P`）→ `TypeScript: Select TypeScript Version` → `Use Workspace Version`。如有需要，可在 `.vscode/settings.json` 中加入：
   ```json
   {
     "typescript.tsdk": ".yarn/sdks/typescript/bin"
   }
   ```

完成后，VSCode 的 TypeScript 语言服务即可正确解析 PnP 依赖。
