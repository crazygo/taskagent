## Chat + AI Stream + Permission Prompt Dataflow

```text
User Input
  │
  ▼
InputBar ➜ handleSubmit (ui.tsx)
  │  - Route by selected tab/driver
  │  - If Chat: runStreamForUserMessage
  │  - If Agent: startAgentPrompt / runAgentTurn
  ▼
Active Messages
  │  - Keep pending placeholders
  │  - Append normalized user message
  │  - Append assistant placeholder (content: '', reasoning: '')
  ▼
Renderer (ChatPanel)
  │  - User lines prefixed with '> '
  │  - Assistant lines prefixed with '✦ '
  │  - Reasoning shown as '✦ Thoughts:' (last 3 lines)
  ▼
AI Stream
  │  - For each streamed block:
  │      * Append text → assistant.content
  │      * Append reasoning → assistant.reasoning
  │      * Throttled UI updates
  │  - Watchdog aborts if idle > 10s
  ▼
Permission Needed?
  ├─ No → continue streaming → finalize assistant → freeze completed turn
  └─ Yes →
        - Add system placeholder '[Agent] Waiting for permission #…' to active
        - Show AgentPermissionPromptComponent (Allow / Deny / Always Allow)
        - User selects option (arrow keys + Enter)
        - Resolve decision →
              * Append detailed system result (Approved/Denied + summary)
              * If allow: continue tool/stream; if deny: interrupt/stop
        - When stream completes, finalize assistant and freeze turn

Next Turn
  │  - If user typed during busy: queue merged user inputs
  │  - After completion: flush queue → start next stream
```

### Key Code Anchors

- Message rendering with '✦' and reasoning label in `src/components/ChatPanel.tsx`:

```12:83:src/components/ChatPanel.tsx
const MessageComponent: React.FC<MessageProps> = ({ message }) => {
  // ...
  if (message.role === 'assistant') {
    prefix = '✦ ';
  }
  // ...
  {reasoningLines.length > 0 && (
    <Text color="gray" italic>{'✦ Thoughts:'}</Text>
  )}
}
```

- Creating assistant placeholder and starting stream in `src/hooks/useStreamSession.ts`:

```120:129:src/hooks/useStreamSession.ts
const assistantMessageId = nextMessageId();
const assistantPlaceholder: Message = {
  id: assistantMessageId,
  role: 'assistant',
  content: '',
  reasoning: '',
};
setActiveMessages(prev => [...prev, { ...assistantPlaceholder, reasoning: '' }]);
```

- Streaming loop updating assistant content/reasoning in `ui.tsx` agent path:

```820:839:ui.tsx
if (currentAssistantMessageId === null) {
  currentAssistantMessageId = nextMessageId();
  const newAssistantMessage: Types.Message = { id: currentAssistantMessageId, role: 'assistant', content: '', reasoning: '' };
  setActiveMessages(prev => [...prev, newAssistantMessage]);
}
for (const block of assistantMessage.message.content) {
  if (block.type === 'text' && typeof block.text === 'string') {
    assistantContent += block.text;
    updateAssistant();
  } else if (block.type === 'reasoning' && typeof block.text === 'string') {
    assistantReasoning += block.text;
    updateAssistant();
  }
}
```

- Permission prompt UI (allow/deny/always) in `ui.tsx`:

```197:224:ui.tsx
<Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} paddingY={0}>
  <Text color="cyan">{`Permission #${prompt.requestId} · ${prompt.toolName}`}</Text>
  // summary lines...
  <Box flexDirection="row">
    {options.map((option, index) => (
      <React.Fragment key={option.key}>
        <Text inverse={index === selectedIndex}>{` ${option.label} `}</Text>
        {index < options.length - 1 ? <Text> </Text> : null}
      </React.Fragment>
    ))}
  </Box>
  <Text color="gray">{prompt.hasSuggestions ? 'Use ←/→ to switch, Enter to confirm. "Always Allow" remembers this permission.' : 'Use ←/→ to switch, Enter to confirm.'}</Text>
</Box>
```

- Handling permission request and queuing prompt in `ui.tsx`:

```481:569:ui.tsx
const handleAgentPermissionRequest = useCallback((toolName, input, { signal, suggestions }) => {
  // create request, add placeholder/system message, enqueue prompt, wire abort
  agentPermissionRequestsRef.current.set(requestId, request);
  agentPermissionQueueRef.current.push(requestId);
  if (!agentPermissionPrompt) { activateNextAgentPermissionPrompt(); }
  signal.addEventListener('abort', abortHandler, { once: true });
});
```

- Resolving permission decision and posting result in `ui.tsx`:

```402:409:ui.tsx
if (decision.kind === 'allow') {
  const rememberNote = decision.always && hasSuggestions ? ' (remembered for this session)' : '';
  resultContent = `[Agent] Permission #${id} · ${toolName}\n\n${request.summary}\n\n✅ Approved${rememberNote}`;
} else {
  const reason = decision.reason?.trim().length ? decision.reason.trim() : 'Denied by user';
  resultContent = `[Agent] Permission #${id} · ${toolName}\n\n${request.summary}\n\n❌ Denied: ${reason}`;
}
```

- Queuing user inputs while busy and flushing later in `src/hooks/useMessageQueue.ts`:

```23:46:src/hooks/useMessageQueue.ts
while (pendingUserInputsRef.current.length > 0) {
  const batch = pendingUserInputsRef.current.splice(0, pendingUserInputsRef.current.length);
  const mergedMessage: Message = { id: nextMessageId(), role: 'user', content: mergedContent };
  await runStreamForUserMessage(mergedMessage);
}
```


