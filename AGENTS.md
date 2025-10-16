# Agent Execution Notes

## `yarn start`

The `yarn start` command launches a long-running process that does not exit on its own.

For quick tests, it should be run in the background and terminated after a few seconds (e.g., using `timeout` or a background-and-kill approach).