# Phase 5 Cleanup Plan - Remove Old Driver Architecture

**Date**: 2025-11-05 04:00  
**Phase**: 5.3 - CLI Integration  
**Goal**: Remove old `packages/cli/drivers/` architecture, migrate to `packages/tabs/`  

---

## 🎯 Background

### Problem Discovery

User asked: **"单纯说这个设计，来源在哪里？那个地方要求你使用 StackAgentView的？"**

**Root Cause Found**:
1. ❌ `docs/stackagent-concept.md` - Obsolete concept document
2. ❌ `packages/cli/components/StackAgentView.tsx` - Empty component (DELETED ✅)
3. ❌ `packages/cli/drivers/*/*.ts` - Still importing `StackAgentView`
4. ❌ `packages/cli/drivers/types.ts` - Old `ViewDriverEntry.component` field

### Why This Was Wrong

**The StackAgent Concept**:
- Implied different agents need different UI components
- Created `StackAgentView` as "generic UI for agents"
- Actually implemented as `() => null` (does nothing)
- Violated architecture layering (config importing UI)

**Reality**:
- All agents share ONE UI component: `ChatPanel` (MessageView)
- Agents differ by logic/data, not by UI
- Event-driven architecture: Agent → EventBus → MessageStore → UI

---

## 📋 Cleanup Tasks

### ✅ Already Completed

1. ✅ Marked `docs/stackagent-concept.md` as DEPRECATED
2. ✅ Created `docs/DEPRECATED-stackagent-concept.md` with explanation
3. ✅ Deleted `packages/cli/components/StackAgentView.tsx`
4. ✅ Removed UI dependencies from `packages/tabs/`
5. ✅ Created clean `packages/tabs/configs/*.ts` (no component field)

### 🔄 In Progress: Remove Old Drivers

**Files with `StackAgentView` references**:
```
packages/cli/drivers/story/index.ts          ← import + component: StackAgentView
packages/cli/drivers/glossary/index.ts       ← import + component: StackAgentView
packages/cli/drivers/ui-review/index.ts      ← import + component: StackAgentView
packages/cli/drivers/monitor/index.ts        ← import + component: StackAgentView
packages/cli/drivers/registry.ts             ← import + comments
packages/cli/drivers/types.ts                ← ViewDriverEntry.component field
```

**Strategy**:
- These are OLD Driver implementations (pre-refactoring)
- NEW implementations are in `packages/tabs/configs/`
- During Phase 5.3, we'll integrate `TabRegistry` into `main.tsx`
- After integration, delete `packages/cli/drivers/*` (except `types.ts` for backward compat)

---

## 🗺️ Migration Path

### Current State (Hybrid)

```
main.tsx
  ├─ OLD: getDriverByLabel() → packages/cli/drivers/registry.ts
  │        ├─ story/index.ts (component: StackAgentView)
  │        ├─ glossary/index.ts (component: StackAgentView)
  │        └─ ...
  │
  └─ NEW: TabRegistry → packages/tabs/configs/
           ├─ story.ts (type: 'agent', agentId: 'story')
           ├─ glossary.ts (type: 'agent', agentId: 'glossary')
           └─ ...
```

### Target State (Phase 5.3 Complete)

```
main.tsx
  └─ TabRegistry → packages/tabs/configs/
       ├─ All tab configs (pure data, no UI)
       └─ Rendered by: <MessageView messages={store.getMessages()} />

packages/cli/drivers/  ← DELETE (except types.ts for now)
```

---

## 🔧 Implementation Steps

### Step 1: Integrate TabRegistry into main.tsx (Phase 5.3)

```typescript
// main.tsx
import { globalTabRegistry } from '@taskagent/tabs';
import { chatTabConfig, agentTabConfig, storyTabConfig, ... } from '@taskagent/tabs/configs';

// Register all tabs
globalTabRegistry.register(chatTabConfig);
globalTabRegistry.register(agentTabConfig);
globalTabRegistry.register(storyTabConfig);
// ...

// Use TabRegistry instead of getDriverByLabel
const currentTab = globalTabRegistry.get(selectedTab);

// Render single UI component
<MessageView 
  messages={messageStore.getVisibleMessages(currentTab.id)} 
  isActive={true}
/>
```

### Step 2: Remove DriverView component

```bash
# DriverView conditionally renders driver.component
# With TabRegistry, all tabs use MessageView
rm packages/cli/components/DriverView.tsx
```

### Step 3: Clean up old drivers

```bash
# After main.tsx uses TabRegistry, delete old drivers
rm -rf packages/cli/drivers/story/
rm -rf packages/cli/drivers/glossary/
rm -rf packages/cli/drivers/ui-review/
rm -rf packages/cli/drivers/monitor/
rm packages/cli/drivers/registry.ts
```

### Step 4: Mark types.ts as deprecated

```typescript
// packages/cli/drivers/types.ts
/**
 * @deprecated This file contains legacy Driver types.
 * New code should use @taskagent/tabs/types.ts instead.
 */
export interface ViewDriverEntry extends BaseDriverEntry {
    type: 'view';
    component: React.FC<ViewDriverProps>;  // ← Will be removed in Phase 6
    // ...
}
```

---

## 📊 Impact Analysis

### Files to Delete

```
packages/cli/drivers/
├── story/index.ts           ← DELETE (replaced by tabs/configs/story.ts)
├── glossary/index.ts        ← DELETE (replaced by tabs/configs/glossary.ts)
├── ui-review/index.ts       ← DELETE (replaced by tabs/configs/ui-review.ts)
├── monitor/index.ts         ← DELETE (replaced by tabs/configs/monitor.ts)
├── registry.ts              ← DELETE (replaced by TabRegistry)
├── plan-review-do/          ← KEEP (special case, slash command)
└── types.ts                 ← KEEP (mark deprecated, remove in Phase 6)

packages/cli/components/
├── StackAgentView.tsx       ← DELETED ✅
└── DriverView.tsx           ← DELETE in Phase 5.3
```

### Files to Update

```
packages/cli/main.tsx
- Remove: getDriverByLabel() calls
- Remove: DriverView rendering
- Add: TabRegistry integration
- Add: MessageView for all tabs
```

---

## ✅ Verification Checklist

After cleanup:

- [ ] No references to `StackAgentView` in codebase
- [ ] No references to `DriverView` in codebase
- [ ] `main.tsx` uses `TabRegistry` exclusively
- [ ] All tabs render with single `MessageView` component
- [ ] `yarn start` works correctly
- [ ] `yarn test` passes
- [ ] Tab switching works
- [ ] Agent invocation works

---

## 🎓 Lessons Learned

### What Went Wrong

1. **Premature Abstraction**
   - Created `StackAgentView` before understanding true requirements
   - Assumed different agents need different UI
   - Reality: All agents need same UI (message display)

2. **Violated Layering**
   - Configuration layer imported UI components
   - Tight coupling between config and UI
   - Hard to test and maintain

3. **Misleading Documentation**
   - `docs/stackagent-concept.md` promoted wrong pattern
   - No validation against actual implementation
   - Concept document became source of truth (wrongly)

### Correct Principles

1. **Event-Driven Architecture**
   - Agents emit events (text, system messages)
   - UI subscribes to events
   - No direct coupling

2. **Single Responsibility**
   - Agents: Pure logic
   - Config: Pure data
   - UI: Pure rendering

3. **Dependency Direction**
   - CLI → tabs → agents → shared → core
   - Never reverse (agents ← UI is WRONG)

---

## 🚀 Next Steps

1. **Immediate** (This PR):
   - ✅ Mark `stackagent-concept.md` as deprecated
   - ✅ Delete `StackAgentView.tsx`
   - ✅ Document cleanup plan

2. **Phase 5.3** (Next PR):
   - [ ] Integrate `TabRegistry` into `main.tsx`
   - [ ] Remove `DriverView.tsx`
   - [ ] Delete old `packages/cli/drivers/*` files
   - [ ] Update tests

3. **Phase 6**:
   - [ ] Remove `component` field from old `ViewDriverEntry`
   - [ ] Complete migration to Event-Driven architecture
   - [ ] Remove all legacy driver code

---

**Status**: Cleanup plan documented, ready for Phase 5.3 implementation  
**Blocker**: None  
**Risk**: Low (old and new systems isolated)

