# FORK-CURSOR-001: Cursor ACP protocol compatibility

## Why this exists

Cursor's `agent acp` process implements ACP plus Cursor-specific extension requests and configuration
behavior that the upstream adapter did not fully model. The gaps caused mode and model selections to
drift, interactive requests to be dropped or answered with the wrong shape, nested task state to be
misrepresented, and some resumed sessions to settle incorrectly.

The supported login command is `agent login`; `cursor-agent login` is not the command shipped by the
current Cursor CLI.

## Behavior

- Decode Cursor extension requests for questions, plan approval, todo updates, subagent tasks, image
  generation, and available models with explicit schemas.
- Translate questions and plan approval into T3's normal user-input flow, including cancellation and
  provider-shaped responses.
- Project Cursor todos, plans, and task progress through canonical runtime events instead of leaking
  extension payloads into clients.
- Resolve Cursor's advertised session modes and configuration options by semantic aliases so plan,
  approval-required, and full-access turns select the intended mode.
- Keep model configuration synchronized across new, resumed, and subsequent turns.
- Preserve generic ACP lifecycle behavior, including session load replay, assistant item identity,
  permission parsing, and prompt completion, for Cursor and the other ACP-backed providers.

## Upstream sync checks

1. Compare upstream changes across every shared touchpoint in `FORK.md`; generic ACP changes can
   supersede part of this patch even when `CursorAdapter.ts` does not conflict.
2. Check the installed Cursor CLI's ACP schemas and advertised capabilities before changing extension
   decoding. Treat undocumented fields as diagnostics, not stable contracts.
3. Keep Cursor-only response shapes and method names in `CursorAcpExtension.ts`; do not make other ACP
   providers depend on them.
4. Exercise both a new session and a resumed session, including model/mode selection, a question or
   plan approval, and a task/todo update.
5. Run the focused suite and repository-wide checks below.

## Verification

```sh
vp test apps/server/src/provider/Layers/CursorAdapter.test.ts \
  apps/server/src/provider/acp/AcpAdapterSupport.test.ts \
  apps/server/src/provider/acp/AcpJsonRpcConnection.test.ts \
  apps/server/src/provider/acp/AcpRuntimeModel.test.ts \
  apps/server/src/provider/acp/CursorAcpExtension.test.ts
vp check
vp run typecheck
```

Delete this record when upstream provides equivalent Cursor ACP behavior end to end, not merely the
base transport or one extension method.
