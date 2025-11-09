# Enforce that all workspaces use the same zod version

workspace_requirements("zod-version") :-
  package_json_field("dependencies", "zod", Version),
  Version \= "^3.22.4".

workspace_requirement_error("zod-version", "zod must be ^3.22.4 in every workspace").

# Enforce minimum @anthropic-ai/claude-agent-sdk version across workspaces

workspace_requirements("claude-agent-sdk-version") :-
  package_json_field("dependencies", "@anthropic-ai/claude-agent-sdk", Version),
  Version \= "^0.1.30".

workspace_requirement_error("claude-agent-sdk-version", "@anthropic-ai/claude-agent-sdk must be ^0.1.30 in every workspace").
