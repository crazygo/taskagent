# ⚠️ DEPRECATED - StackAgent Concept

**Status**: ❌ OBSOLETE - DO NOT USE  
**Deprecated Date**: 2025-11-05  
**Reason**: Violated architecture layering principles  
**Replacement**: Event-Driven Architecture with unified MessageView  

---

## ❌ Why This Concept Was Wrong

### Original Concept (DEPRECATED)

> "A single `StackAgentView` component is used for drivers..."

**Problems:**

1. **Violated Layering**
   - Configuration layer (`packages/tabs/`) imported UI components
   - Agents were coupled to specific UI components
   - Broke separation of concerns

2. **Misleading Abstraction**
   - Implied different agents need different UI components
   - Actually, all agents share the same UI (message display)
   - Created unnecessary complexity

3. **Implementation Was Empty**
   ```tsx
   // The actual implementation:
   const StackAgentView: React.FC = () => null;  // Does nothing!
   ```

### What It Got Wrong

**Wrong Assumption**:
> "Different agent types need different UI components"

**Reality**:
> All agents output messages. One UI component displays all messages.

---

## ✅ Correct Architecture

### Event-Driven Pattern

```
Agent (Pure Logic)
  ↓ emits events
EventBus
  ↓ routes events
MessageStore (by tabId)
  ↓ provides data
MessageView (Single UI Component)
```

**Key Insight**: 
- **One UI component** for all agents
- **Differentiation by data**, not by UI
- **Clean separation**: Logic ← Events → UI

### Correct Design

```typescript
// ✅ All tabs use the same UI component
const tabs = [
  { id: 'Chat', type: 'chat', agentId: null },
  { id: 'Story', type: 'agent', agentId: 'story' },
  { id: 'Glossary', type: 'agent', agentId: 'glossary' },
];

// ✅ UI layer decides rendering (not config layer)
function render(tab: TabConfig) {
  return <MessageView messages={store.getVisibleMessages()} />;
}
```

---

## 📚 Correct Documentation

**See instead**:
- `memory/docs/2025-11-05-03-40-architecture-layering-fix.md` - Correct architecture
- `memory/docs/2025-11-05-01-10-refactor-roadmap-v3.md` - Refactoring roadmap

---

## 🗑️ Files to Remove/Ignore

1. `docs/stackagent-concept.md` - ❌ Obsolete concept
2. `packages/cli/components/StackAgentView.tsx` - ❌ Empty placeholder (delete)
3. References to "StackAgent" in old docs - ❌ Outdated

---

**This file exists to prevent future confusion. The StackAgent concept is fundamentally flawed and should not be used.**

