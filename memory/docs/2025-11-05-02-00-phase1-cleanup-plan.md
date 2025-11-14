# Phase 1 Cleanup Plan

**Date**: 2025-11-05 02:00  
**Status**: Investigation Complete  
**Goal**: Clean up `src/` directory and finalize Monorepo migration  

---

## Current Situation

### Two Entry Points Exist

1. **Old Entry Point**: `ui.tsx` (root)
   - Still in use: `"start": "tsx ui.tsx"`
   - Imports from `src/` directory
   - Production entry point: `"bin": "dist/ui.js"`

2. **New Entry Point**: `packages/cli/main.tsx`
   - Uses new monorepo structure
   - Imports from `@taskagent/*` packages
   - Has agent registry initialization
   - **NOT currently used by any script**

### Directory Structure

```
Current:
├── ui.tsx                    # OLD entry point (still active)
├── task-manager.ts           # Still imports from src/
├── src/                      # OLD code (still in use)
│   ├── agent/
│   ├── agents/
│   ├── cli/
│   ├── components/
│   ├── config/
│   ├── domain/
│   ├── drivers/
│   ├── hooks/
│   ├── workspace/
│   └── ...
└── packages/                 # NEW code (partially used)
    ├── core/
    ├── agents/
    └── cli/
        ├── main.tsx          # NEW entry point (not used yet)
        ├── drivers/          # Only has 4 driver indexes
        └── types.ts
```

---

## File-by-File Analysis

### Files in `src/` Still Needed (Not in packages/cli/)

#### Must Migrate to `packages/cli/`:

1. **`src/cli/`**
   - `args.ts` - CLI argument parsing
   - `config.ts` - CLI configuration loading
   - `help.ts` - Help text

2. **`src/components/`** (UI Components)
   - `AgentPermissionPrompt.tsx`
   - `AgentPermissionPrompt.types.ts`
   - `ChatPanel.tsx`
   - `CommandMenu.tsx`
   - `DriverView.tsx`
   - `InputBar.tsx`
   - `StackAgentView.tsx`
   - `StatusControls.tsx`
   - `TaskSpecificView.tsx`

3. **`src/config/`**
   - `ai-provider.ts` - AI provider configuration
   - `openrouter.ts` - OpenRouter specific config

4. **`src/domain/`**
   - `conversationStore.ts` - Conversation state management
   - `taskStore.ts` - Task state management

5. **`src/hooks/`**
   - `useMessageQueue.ts`
   - `useStreamSession.ts`

6. **`src/workspace/`**
   - `settings.ts` - Workspace settings management

7. **Root Level**
   - `task-manager.ts` - Task management logic
   - `logger.ts` - Logging utility (may need to stay at root or move to core)
   - `task-logger.ts` - Task-specific logging
   - `env.ts` - Environment variable handling
   - `types.ts` - Shared types

### Files Already in Packages (Can be deleted from src/):

1. **`src/agent/`** → `packages/agents/runtime/`
   - `runClaudeStream.ts` ✅
   - `runPromptAgentStart.ts` ✅
   - `flows/baseClaudeFlow.ts` → Need to check
   - `types.ts` ✅

2. **`src/agents/`** → `packages/agents/`
   - `log-monitor/` ✅
   - `ui-review/` ✅

3. **`src/drivers/`** → Partially in `packages/cli/drivers/` and `packages/agents/`
   - `story/` → `packages/agents/story/` ✅
   - `glossary/` → `packages/agents/glossary/` ✅
   - `monitor/` → `packages/agents/monitor/` ✅
   - `ui-review/` → `packages/agents/ui-review/` ✅
   - BUT: `pipeline.ts`, `registry.ts`, `types.ts` still needed

### Files to Investigate:

- `src/workflow/` - LangGraph adapter (used?)
- `src/drivers/plan-review-do/` - Command implementation (used?)

---

## Migration Plan

### Step 1: Migrate Missing CLI Files (0.5 day)

```bash
# Create directories
mkdir -p packages/cli/cli
mkdir -p packages/cli/components
mkdir -p packages/cli/config
mkdir -p packages/cli/domain
mkdir -p packages/cli/hooks
mkdir -p packages/cli/workspace
mkdir -p packages/cli/store

# Copy files
cp src/cli/* packages/cli/cli/
cp src/components/* packages/cli/components/
cp src/config/* packages/cli/config/
cp src/domain/* packages/cli/domain/
cp src/hooks/* packages/cli/hooks/
cp src/workspace/* packages/cli/workspace/

# Move driver infrastructure
cp src/drivers/types.ts packages/cli/drivers/
cp src/drivers/registry.ts packages/cli/drivers/
cp src/drivers/pipeline.ts packages/cli/drivers/
```

### Step 2: Handle Root Files

**Option A**: Keep at root (simpler)
- `task-manager.ts`
- `logger.ts` 
- `task-logger.ts`
- `env.ts`
- `types.ts`

**Option B**: Move to packages/cli (cleaner)
- Need to update all imports
- More work but cleaner structure

**Recommendation**: Keep at root for now (less risk)

### Step 3: Update Import Paths

1. Update `packages/cli/main.tsx` imports:
   - Change relative imports to use new structure
   - Verify all imports resolve correctly

2. Check if `task-manager.ts` needs updates:
   - Currently imports from `src/`
   - May need to import from `packages/cli/` instead

### Step 4: Update package.json

```json
{
  "scripts": {
    "start": "tsx packages/cli/main.tsx --",
    "build": "tsc",
  },
  "bin": "dist/packages/cli/main.js",
  "main": "dist/packages/cli/main.js"
}
```

### Step 5: Delete Old Files

```bash
# After verification
rm ui.tsx
rm -rf src/
```

---

## Risks and Mitigation

### Risk 1: Missing Files
**Impact**: Build/runtime failures  
**Mitigation**: Comprehensive diff before deletion

### Risk 2: Import Path Issues
**Impact**: TypeScript errors  
**Mitigation**: Use TypeScript to verify all imports

### Risk 3: Test Failures
**Impact**: Broken functionality  
**Mitigation**: Run all tests before and after

---

## Decision Required

**Question**: Should `packages/cli/main.tsx` replace `ui.tsx` completely?

**Evidence**:
- `packages/cli/main.tsx` has agent registry initialization
- It imports from new package structure
- BUT it's missing many imports that `ui.tsx` has

**Answer**: Yes, but we need to:
1. Migrate all missing pieces first
2. Ensure `packages/cli/main.tsx` is complete
3. Then switch entry point

---

## Next Actions

1. ✅ Investigation complete
2. ⏭️ Compare `ui.tsx` vs `packages/cli/main.tsx` in detail
3. ⏭️ Create list of missing imports in `packages/cli/main.tsx`
4. ⏭️ Migrate missing files to `packages/cli/`
5. ⏭️ Update imports in `packages/cli/main.tsx`
6. ⏭️ Update package.json scripts
7. ⏭️ Run tests
8. ⏭️ Delete old files

---

**Time Estimate**: 4-6 hours (longer than original 0.5 day due to more files than expected)

