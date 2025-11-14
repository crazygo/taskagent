# Story Package Configuration Concept

## Goal
- Externalize Story driver prompts, model choice, and subagent definitions into a workspace package.
- Allow teams to author story orchestration behavior without touching the TypeScript codebase.

## Proposed Layout
- `./story/package.md`  
  ```markdown
  ---
  name: story
  model: sonnet
  ---
  <system prompt body>
  ```
- `./story/agents/*.md` (one file per subagent)  
  ```markdown
  ---
  name: story_builder
  model: sonnet
  tools:
    - Read
    - Write
    - Edit
    - Glob
    - Grep
  ---
  <subagent system prompt body>
  ```
- Optional: `./story/assets/` for shared snippets or templates referenced by the package.

## Loader Responsibilities
- Parse package front matter, produce `{ name, model, systemPrompt }`.
- Parse each `agents/*.md` file into `AgentDefinition` objects; support YAML sections such as `tools`, `description`, and `capabilities`.
- Surface schema validation errors with actionable diagnostics.

## Runtime Integration
- Story driver still computes feature slug and resolves the target Markdown file (for now) to maintain compatibility with `.askman/features/<slug>/story.md`.
- Loader output replaces `buildStorySystemPrompt` and `buildStoryAgentsConfig` results:
  - `systemPrompt` becomes the coordinator prompt shell.
  - Each agent definition populates the `agents` map passed to the Claude pipeline.
  - Package `model` becomes the default Claude model if not overridden by environment variables.
- Support template variables inside prompts (e.g. `{{featureSlug}}`, `{{storyFilePath}}`) that the driver resolves at runtime.

## Implementation Steps
- Add a `StoryPackageLoader` utility that reads `./story` (or another configured path), validates schema, and returns the package structure.
- Extend the driver pipeline setup to:
  - Load the package once during bootstrap and cache it.
  - Inject runtime substitutions before dispatching to Claude (`featureSlug`, `relativePath`, etc.).
  - Fallback to the current hardcoded prompt if the package is missing or invalid, with a system warning.
- Provide authoring docs (schema reference, example package, troubleshooting tips).

## Open Questions
- Do we allow multiple Story packages (per workspace or per feature)?
- How should we version/manage packages for team sharing?
- What templating engine (simple mustache vs. custom placeholder) offers the right balance of power and safety?
- Should subagents be able to extend tool permissions beyond the current Story builder scaffold?

