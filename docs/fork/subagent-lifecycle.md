# Provider-neutral subagent lifecycle

## Why this exists

Providers expose delegated work through incompatible signals: Codex child threads and collaboration
items, Claude task messages, OpenCode descendant sessions, and Cursor terminal task notifications.
Treating all of them as generic tools loses stable identity and can merge child text into the parent
answer.

## Canonical model

The runtime contract exposes `agent.started`, `agent.updated`, and `agent.completed` events keyed by
`RuntimeAgentId`. Events may carry a parent agent, role, prompt, description, model, provider thread,
path, usage, duration, and terminal summary. Orchestration projects these into stable
`collab_agent_tool_call` work items so the shared client presentation can fold lifecycle updates into
one card.

The collaboration operation remains a separate tool lifecycle. This matters for Codex, where a
`spawnAgent`, `sendInput`, `wait`, or `closeAgent` call describes an interaction while the target
agent has its own longer-lived state.

## Provider behavior

- Codex derives identity and hierarchy from collaboration targets and subagent activity items.
  Child transcript and tool notifications are suppressed from the parent stream; nested
  collaboration lifecycle items remain visible so descendants can be tracked.
- Claude maps SDK tasks with `task_type: agent` (or later `subagent_type` evidence) to agent
  lifecycle events. Other background tasks keep the generic task lifecycle. Existing nested-message
  isolation and task-aware idle recovery remain authoritative.
- OpenCode maps descendant sessions to agents through `Session.parentID`. Descendant message and
  tool events stay isolated from the parent, while busy, idle, error, and deletion signals update the
  agent lifecycle.
- Cursor maps `cursor/task` to a terminal agent event because the ACP extension only reports the
  completed task.
- Hermes is intentionally excluded. Its future direct runtime integration should emit the same
  canonical events instead of adding provider checks to the clients.

## Cross-platform presentation

Web and mobile both use `@t3tools/client-runtime/tool-calls` to merge stable agent IDs and render
prompt, summary, role, model, parent identity, path, duration, and status. Provider names must not be
used to select UI behavior. Mobile uses its dedicated agent symbol and the same expandable detail
sections as web.

## Invariants

1. A child assistant delta must never mutate the parent assistant message.
2. Agent lifecycle IDs must remain stable across start, update, and completion.
3. Terminal states are `completed`, `failed`, or `stopped`; terminal rows must not merge with later
   unrelated work.
4. Parent relationships are included only when the provider supplies a stable identifier.
5. Provider payload traversal and persisted details remain bounded by the shared tool presentation
   safeguards.
6. A provider with summary-only support may emit only `agent.completed`; the clients must still
   render a useful card.
