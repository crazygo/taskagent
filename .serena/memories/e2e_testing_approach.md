# E2E Testing Approach

TaskAgent uses an **internal engine-based E2E automation** system rather than external keystroke simulation.

## Key Implementation Details

### Configuration
- Tests are driven by the `E2E_AUTOMATION_STEPS` environment variable
- Steps are passed as a JSON sequence with operations: `wait`, `press`, `switchTab`, `submit`, `exit`
- Execution command: `yarn e2e:experiment` 
- Expect script location: `scripts/e2e-experiment.expect`

### Technical Architecture
1. **Input Initialization**: Forces `stdin.setRawMode(true)` at startup to ensure Ink's `useInput` hook functions correctly
2. **Ref Persistence**: Uses `useRef` to persist `handleSubmit`, `isStreaming`, and `selectedTab` to prevent effect interruption from state updates
3. **Stream Waiting**: `submit` steps support `waitForStream` configuration for polling stream completion
4. **Logging**: All automation actions are written to `debug.log` for verification

### Advantages
- Avoids IO-layer issues like character concatenation and dropped Enter keys that occur with Expect-based keystroke simulation
- Provides structured, extensible automation capabilities
- More reliable and maintainable than external simulation approaches

## Log Files
- Primary log: `debug.log` (real-time application logging)
- E2E-specific log: `e2e-experiment.log`