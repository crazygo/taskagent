# TaskAgent

## What's This

TaskAgent is a terminal-first workflow assistant built on top of React Ink, Anthropic’s Claude Agent SDK, and the Vercel AI tooling. It orchestrates multiple “aspect” agents (Story, UI Review, Plan-Review-Do, etc.) and provides a TUI for rapid iteration, streaming responses, and workspace-aware automation.

## CLI Usage

Run the interface with `yarn start -- [options]`. Helpful flags:

- Before running, copy `.env.example` to `.env.local`, fill in the required credentials, and place the file either in the repo root or your active workspace (e.g. `{workspace}/.askman/.env.local`).
- `-h`, `--help`: Show available options and exit.
- `-p`, `--prompt <text>`: Submit an initial prompt automatically after launch.
- `-d`, `--driver <name>`: Open a specific tab/driver (`story`, `agent`, `plan-review-do`, etc.).
- `--<driver>`: Shorthand for `--driver <driver>` (for example, `--story`).
- `--workspace <path>` or `-w <path>`: Override the workspace directory (defaults to `~/.askman/default_workspace`).
- `--newsession`: Force creation of a brand-new Claude session before processing input.

Examples:

- `yarn start -- --story --newsession -p "Outline the onboarding story"`
- `yarn start -- -d agent -p "Summarize current tasks"`

## Development

The project uses Yarn Berry (Plug'n'Play) and runs directly via `tsx`.

- Install dependencies: `yarn install`
- Launch the TUI: `yarn start`
- Quick smoke test (auto-start/stop): `yarn start:test`
- Environment priorities: `{workspace}/.askman/.env.local` → `~/.askman/.env.local` → project `.env.local`

Ensure the required API keys (Anthropic, OpenRouter/OpenAI) are present in one of the recognized `.env.local` files before running the app.
