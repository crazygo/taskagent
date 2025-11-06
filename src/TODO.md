# Legacy Module Cleanup

- [ ] `agents/log-monitor/`: legacy LogMonitor agent that still bypasses EventBus/TabExecutor. Decide whether to migrate or delete once new monitoring flow is in place.
- [ ] `workflow/langgraphAdapter.ts`, `workflow/startAgent.ts`: legacy workflow entry points no longer used by CLI. Confirm no active consumers, then remove or gate behind feature flag.

(Tracked for post-refactor cleanup; leave untouched during current test pass.)
