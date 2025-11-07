# Agent Execution Notes

## `yarn start`

The `yarn start` command launches a long-running process that does not exit on its own.

## `yarn start:test`

To facilitate automated testing of the application's initialization and UI rendering, a `start:test` script has been added to `package.json`. This script uses `concurrently` with the `--raw` flag to run `yarn start` and automatically terminates it after 5 seconds. This allows for quick, non-interactive checks of the application's startup and UI rendering.

**Usage:** `yarn start:test`

## Automated & Non-Interactive Testing

For scripting and testing purposes, it is possible to submit a prompt automatically upon application startup. This is achieved by using a combination of a driver flag (e.g., `--story`) and a prompt flag (`-p` or `--prompt`).

**Rule:** The `-p` or `--prompt` flag is **mandatory** to trigger the automatic submission workflow. Any text provided after a driver flag without `-p` will be treated as a positional argument and ignored by the submission logic.

**Correct Usage (Auto-submits):**
```bash
yarn start -- --glossary -p "What is a 'user story'?"
```

**Incorrect Usage (Does NOT auto-submit):**
```bash
# This will NOT switch to the Glossary tab and will NOT submit the prompt.
# The application will start in the default Chat view.
yarn start -- --glossary "What is a 'user story'?"
```


## Core Mandate

Your primary role is to act as an interactive CLI agent for software engineering tasks. You will help with:
- Fixing bugs
- Adding features
- Refactoring code
- Planning and executing tasks
- Following user instructions precisely

## Key Principles

- **Adhere to Conventions**: Strictly follow the project's existing coding style, libraries, and patterns.
- **Verify First**: Always read and analyze existing code before making changes.
- **Test Thoroughly**: Add or update tests to verify your changes.
- **Communicate Clearly**: Keep the user informed of your plans and progress. Use ASCII art and user stories where appropriate to clarify complex features.
- **Memory**: Remember key facts and instructions provided by the user, especially regarding workflow (e.g., how to run and test the application).
- **Testing Workflow**: Utilize the `yarn start:test` command for quick, automated checks of application initialization and UI rendering, as detailed in `AGENTS.md`.

## Agent Roles & Capabilities

- **[Memory Systems Analyst](memory/AGENTS.md)**: Use for tasks involving the analysis of conversations or documents to extract and store structured memories (events, facts, skills).
- **[Source Code Conventions](src/AGENTS.md)**: Implementation-level guidance for TUI streaming, message/state management, error boundaries, performance, and Ink UI.

## Agent Architecture Patterns

### PromptAgent + sub-agents
A PromptAgent that can be composed with sub-agents defined via .agent.md files, and can also serve as a sub-agent.

**Examples:**
- `drivers/story/agents/story_builder.agent.md` - File operations for story documents
- `drivers/glossary/agents/1_searcher.agent.md` - Search for term occurrences
- `drivers/glossary/agents/2_edits_planner.agent.md` - Plan term replacements
- `drivers/glossary/agents/3_editor.agent.md` - Execute file edits

### Coordinator (PromptAgent + sub-agents)
An agent composed of a coordinator and multiple sub-agents. The coordinator defines the workflow and orchestration strategy for calling sub-agents.

**Examples:**
- `drivers/glossary/` - Coordinator orchestrates searcher → planner → editor workflow
- `drivers/story/` - Coordinator manages single sub-agent (story_builder) with user dialogue

## Document & Memory Placement

- **Chat Memory Store (`memory/chat/`)**: See [memory/chat/AGENTS.md](memory/chat/AGENTS.md) for details.
- **Docs Memory Store (`memory/docs/`)**: See [memory/docs/AGENTS.md](memory/docs/AGENTS.md) for details.
- **Serena MCP Named Memories**: Managed via MCP tools (`write_memory`, `read_memory`, `list_memories`, `delete_memory`). Follow each tool's definition for proper usage.

## C4 definition
- C4 Level 1: System Context and User Interactions
- C4 Level 2: Containers
- C4 Level 3: Components
- C4 Level 4: Logic Flow
- Component: A C4 Level 3 architectural element. 
- React component: A specific code-level implementation detail using React (e.g., a .tsx file exporting a function).

## Story & Commit Policy

### Story List 模板
当用户要求输出 "story list" 时，使用以下简洁格式总结需求：

```markdown
# [Feature Name]

## 📋 User Story
**As a** [user role]  
**I want** [goal/desire]  
**So that** [benefit/value]

---

## 🎯 Acceptance Criteria

### Scenario 1: [简洁场景名]

Given that [前置条件]
And [额外条件]

When [用户动作]

Then [期望结果]
And [额外期望]


### Scenario 2: [另一个场景]

Given that [前置条件]
When [用户动作] 
Then [期望结果]
```

### 💡 Problems Solved
[简洁描述此次修改解决的问题]

### 适用范围
- 分析 git diff 生成 story
- 总结对话历史中的需求
- 解读 PRD 文档
- 任何需要结构化需求输出的场景
 
### 关键原则
- 避免重复（不要 Success Criteria 部分，BDD 场景已经是验收标准）
- 专注用户价值，不写技术实现
- **始终从用户视角描述**，不提及代码符号、函数名、技术术语
- 场景描述简洁明确，使用自然语言描述用户行为和期望
- Given-When-Then 格式保持一致

### Commit 要求
- 使用 Story AC 的格式，总结变更，并加入到 Commit Message 中
 
 

## Development Commands

### Running the Application
```bash
# Install dependencies (uses Yarn Berry with Plug'n'Play)
yarn install

# Start the application
yarn start
# or directly with tsx:
tsx ui.tsx
```

### Development Environment
- **Package Manager**: Yarn Berry v4.9.1 with Plug'n'Play (no node_modules)
- **Runtime**: Node.js with ES Modules
- **Execution**: Direct TypeScript execution via tsx (no build step)

## Architecture Overview

### Core Technology Stack
- **UI Framework**: React 19.2.0 + Ink 6.3.1 for terminal interface
- **AI Integration**: Vercel AI SDK 5.0.68 with OpenRouter API
- **Language**: TypeScript 5.9.3 with strict configuration
- **Environment**: ES Modules with NodeNext resolution

### Application Structure
The application follows a single-file architecture with `ui.tsx` as the main entry point:

- **WelcomeScreen**: Memoized component showing app info and activity history
- **MessageComponent**: Renders messages with role-based styling and formatting
- **ActiveHistory**: Displays real-time conversation flow
- **App**: Main component managing state and AI interactions

### State Management
- **Dual Message System**: `frozenMessages` (persistent history) + `activeMessages` (current session)
- **Message Types**: user, assistant, system with distinct visual styling
- **Stream Handling**: Throttled rendering (100ms intervals) for AI responses
- **Error Handling**: Comprehensive error catching and system message display

### AI Integration Pattern
The application uses a sophisticated streaming pattern:
1. Environment variable mapping (OPENROUTER_API_KEY → OPENAI_API_KEY)
2. Configurable model selection via environment variables
3. Streamed responses with content buffering and throttled UI updates
4. Proper error handling and logging throughout the stream lifecycle

## Environment Configuration

### Required Environment Variables (.env.local)
```bash
OPENROUTER_API_KEY='your-api-key-here'
OPENROUTER_MODEL_NAME='z-ai/glm-4.6'  # or other model
OPENROUTER_BASE_URL='https://openrouter.ai/api/v1'
```

### Configuration Notes
- The application automatically maps OPENROUTER_API_KEY to OPENAI_API_KEY for compatibility
- Default model falls back to 'google/gemini-flash' if not specified
- Base URL defaults to OpenRouter's API endpoint
- All environment variables are properly excluded from git via .gitignore

## Development Workflow

### Code Structure Principles
- **Single File Architecture**: All UI logic contained in `ui.tsx`
- **Functional Components**: Uses React hooks and functional programming patterns
- **Type Safety**: Strict TypeScript configuration with comprehensive type definitions
- **Performance**: Memoization and throttled rendering for smooth terminal UI

### Logging and Debugging
- **Avoid `console.log`**: Do not use `console.log` for debugging. Console messages can interfere with Ink's TUI rendering, causing visual glitches and ghosting. Use the file-based logger instead.
- **Claude Agent SDK**: For issues related to the Claude Agent SDK, refer to the official documentation: https://docs.claude.com/en/api/agent-sdk/typescript.md
- Real-time debug output streams to `logs/debug.log`, and older sessions remain alongside it under the `logs/` directory for easy discovery.
- Application lifecycle tracking (start, submissions, API calls, errors)
- Stream progress monitoring for AI responses
- Error details captured and displayed in system messages

### Key Development Patterns
1. **Message Management**: Clear separation between persistent and active messages
2. **Stream Processing**: Buffered content with controlled rendering intervals
3. **Error Boundaries**: Try-catch blocks around all AI API interactions
4. **State Updates**: Immutable state updates with proper React patterns

## Package Management Notes

### Yarn Berry Configuration
- Uses Plug'n'Play for enhanced security and performance
- `.pnp.cjs` and `.pnp.loader.mjs` files are committed to repository
- No `node_modules` directory - dependencies resolved directly from yarn.lock
- Enhanced security by eliminating traditional node_modules vulnerabilities

### Dependencies
- **Core**: React, Ink, AI SDK, TypeScript
- **Utilities**: dotenv for environment, zod for validation
- **Package manager**: Yarn Berry with Plug'n'Play. Avoid running `npm install` or other npm-driven commands (they create `package-lock.json` and bypass `.pnp.cjs`). After changing dependencies run `yarn install` (or `yarn install --immutable`) so the PnP manifest stays in sync. Use `yarn add`, `yarn remove`, `yarn dlx`, and `yarn run`; never commit a `package-lock.json`.
- **Development**: tsx for TypeScript execution, type definitions

## Important Technical Details
- ASCII-safe rendering with proper newline handling
- Color-coded messages based on role (white=user, gray=assistant, yellow=system)
- Box styling for system errors and welcome screen
- Responsive layout using Ink's flexbox system

### Performance Optimizations
- React.memo for expensive components
- Throttled streaming updates (100ms intervals)
- Efficient state updates with minimal re-renders
- Static components for frozen message history

### Error Handling Strategy
- API errors displayed as boxed system messages
- Comprehensive logging for debugging
- Graceful fallbacks for missing configuration
- User-friendly error messages in terminal interface
- 你好
