# Cursor automatic approval reviewer

## Purpose

Cursor CLI supports an Auto-review run mode that sends tool calls through Cursor's risk classifier.
This fork exposes that behavior as a provider option while continuing to use T3 Code's shared
approval UI for calls that Cursor escalates to the user.

## Behavior

- Every Cursor model exposes an **Approval reviewer** provider option.
- **Ask me** is the default and preserves the existing ACP approval behavior.
- **Auto-review** launches Cursor ACP with `--auto-review`, allowing Cursor to run safe tool calls
  automatically and request approval for the rest.
- Cursor sessions restart and resume when the reviewer changes because the CLI option is fixed when
  the ACP process starts.
- In full-access mode, T3 does not auto-approve requests escalated by Cursor Auto-review; those
  requests remain visible in the shared web and mobile approval UI.

## Verification

```sh
vp test apps/server/src/cursorModelOptions.test.ts apps/server/src/provider/acp/CursorAcpSupport.test.ts apps/server/src/provider/Layers/CursorProvider.test.ts apps/server/src/provider/Layers/CursorAdapter.test.ts apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts
vp check
vp run typecheck
```
