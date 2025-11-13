# Refactoring Acceptance Criteria

This document outlines the acceptance criteria for the driver architecture refactoring. These scenarios should be used to verify the successful completion of the refactoring tasks.

---

## Scenario 1: Application Starts and Renders Tabs Correctly

**Given** all dependencies are installed and the environment is set up
**When** the user runs the application via `yarn start:test`
**Then** the application should start without any runtime errors
**And** the rendered UI should display the `Chat`, `Agent`, `Story`, `Glossary` tabs
**And** the `Plan-Review-DO` tab should not be visible.

---

## Scenario 2: Slash Commands Function Correctly

**Given** the application is running interactively via `yarn start`
**When** the user types `/` in the input bar
**Then** the command menu that appears should only contain `task`, `newsession`, and `plan-review-do`
**And** the command menu should not contain `story` or `glossary`.
**When** the user executes the command `/plan-review-do test`
**Then** the `plan-review-do` handler should be invoked and a corresponding execution message should appear in the logs.

---

## Scenario 3: Story Driver Works via CLI Flag

**Given** all dependencies are installed
**When** the user starts the application with the `--blueprint` flag, e.g., `yarn start -- --blueprint "Draft a story for login"`
**Then** the application should launch with the `Story` tab active by default
**And** the `Story` driver's Agentic workflow should be triggered
**And** the agent should start a conversation to draft the story, without asking for a `slug` or file path.

---

## Scenario 4: Glossary Driver Works via CLI Flag

**Given** all dependencies are installed
**When** the user starts the application with the `--glossary` flag, e.g., `yarn start -- --glossary "What is a 'user story'?"`
**Then** the application should launch with the `Glossary` tab active by default
**And** the `Glossary` driver's Agentic workflow should be triggered
**And** the `debug.log` file should contain entries confirming that `coordinator.agent.md` and all sub-agents from the `agents/` directory were loaded and parsed successfully
**And** the `Glossary` coordinator agent should start a conversation with the user.

---

## Scenario 5: Manual Tab Switching and Basic Input

**Given** the application is running interactively
**When** the user manually switches to the `Story` tab
**And** types "hello"
**Then** the `Story` agent should respond according to its role.
**When** the user manually switches to the `Glossary` tab
**And** types "hello"
**Then** the `Glossary` agent should respond according to its role.
