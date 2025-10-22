# Agent Execution Notes

## `yarn start`

The `yarn start` command launches a long-running process that does not exit on its own.

## `yarn start:test`

To facilitate automated testing of the application's initialization and UI rendering, a `start:test` script has been added to `package.json`. This script uses `concurrently` with the `--raw` flag to run `yarn start` and automatically terminates it after 5 seconds. This allows for quick, non-interactive checks of the application's startup and UI rendering.

**Usage:** `yarn start:test`