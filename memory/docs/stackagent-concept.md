# ⚠️ DEPRECATED - StackAgent Concept

**⚠️ THIS DOCUMENT IS OBSOLETE ⚠️**  
**Date Deprecated**: 2025-11-05  
**Reason**: Violated architecture layering principles  
**See**: `docs/DEPRECATED-stackagent-concept.md` for details  

---

## Original Content (For Historical Reference Only)

To streamline the creation of drivers that primarily rely on an agent pipeline and a generic UI, we introduce the `StackAgent` abstraction. This concept aims to reduce boilerplate and improve consistency across drivers that do not require highly custom user interfaces.

**Key Principles:**
- **Generic UI Component**: A single `StackAgentView` component (`src/components/StackAgentView.tsx`) is used for drivers that only need to display their name and status. This replaces individual placeholder view files (e.g., `StoryView.tsx`, `GlossaryView.tsx`).
- **Standardized Agent Loading**: A shared utility (`src/agent/agentLoader.ts`) handles the loading and configuration of agent pipelines. This utility supports two primary patterns:
    - **Coordinator/Sub-Agent Pattern**: Drivers can define a `coordinator.agent.md` file and a set of `agents/*.agent.md` files. The `loadAgentPipelineConfig` function parses these Markdown files to construct the agent hierarchy and their prompts/tools.
    - **Prompt-Only Pattern**: For simpler drivers (like UI Review), the `loadAgentPipelineConfig` can directly accept a `systemPrompt` or `systemPromptFactory` without requiring `.agent.md` files. This allows for flexible agent configurations.
- **Simplified Driver Entries**: Driver entries in `src/drivers/registry.ts` and individual `index.ts` files are simplified by using `StackAgentView` as their `component` and leveraging the `loadAgentPipelineConfig` in their `prepare` functions.

**Benefits:**
- **Reduced Boilerplate**: Eliminates the need for separate `View.tsx` files for each generic driver.
- **Improved Consistency**: Ensures a uniform look and feel for basic driver UIs.
- **Flexible Agent Configuration**: Supports both complex, orchestrated agent structures and simpler, prompt-driven agents through a single loading mechanism.
- **Easier Maintenance**: Centralizes agent loading logic and UI rendering for generic drivers.
