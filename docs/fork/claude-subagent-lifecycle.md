# Claude subagent lifecycle correctness

## Why this exists

Claude subagents emit nested assistant, user, and stream messages with `parent_tool_use_id` set.
Their content-block indexes use a separate namespace that restarts at zero. T3's flattened Claude
adapter keyed in-flight tools only by block index, so a child tool could overwrite the parent Task
tool at the same index. This left the wrong work-log item completed or the parent subagent item
stuck in progress.

Claude also emits a result before all task-backed work is necessarily settled. The SDK's
`session_state_changed: idle` event is the authoritative signal that the held result has been
flushed and background-agent work has exited. Completing on the earlier result could report the
agent as finished while Claude was still waiting for a subagent.

## Behavior

- Nested conversation messages with a non-null `parent_tool_use_id` remain in native diagnostics
  but are not folded into the top-level turn. Task lifecycle events continue to provide flattened
  subagent progress in the work log.
- Once `task_started` is observed during a turn, result completion is held until
  `session_state_changed: idle` arrives.
- `task_updated` is treated as SDK bookkeeping because `task_progress` and `task_notification`
  carry the displayable and terminal task state.
- Non-task Claude turns retain their existing result-driven completion behavior.

## Upstream sync checks

1. Inspect upstream Claude tool tracking for a composite parent/block identity or nested transcript
   model before resolving adapter conflicts.
2. Check the installed Claude Agent SDK definitions for changes to `parent_tool_use_id`,
   `task_started`, `task_updated`, `task_notification`, and `session_state_changed` semantics.
3. Preserve result deferral only for turns that enter a task lifecycle so ordinary turns cannot
   hang waiting for an idle event.
4. Run the verification commands below.

## Verification

```sh
vp test apps/server/src/provider/Layers/ClaudeAdapter.test.ts
vp check
vp run typecheck
```

Delete this patch when upstream isolates nested Claude content-block indexes and does not settle a
task-bearing turn before the SDK reports its authoritative idle state.
