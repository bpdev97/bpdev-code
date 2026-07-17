# Codex automatic approval reviewer

## Purpose

Codex app-server supports routing interactive approval requests to either the user or a separate
automatic reviewer. T3 Code already maps its `auto-accept-edits` runtime mode to Codex
`workspace-write` plus `on-request`; this fork adds the independent reviewer choice exposed by
Codex's `approvalsReviewer` field.

## Behavior

- Every catalog-backed Codex model exposes an **Approval reviewer** provider option.
- **Ask me** is the default and preserves T3 Code's existing manual approval behavior.
- **Auto-review** sends eligible sandbox, network, permissions, app, and MCP approval requests to
  Codex's risk reviewer.
- The selected value is validated before it reaches app-server and is passed on thread start,
  thread resume, and each turn so model-option changes take effect on an active session.
- The reviewer does not expand the sandbox. It approves or denies requests that would otherwise be
  shown to the user; denied actions are returned to the main agent so it can choose a safer path or
  ask the user for explicit authorization.

Custom model entries without app-server model capabilities do not receive the option. They can
still use Codex's `approvals_reviewer` setting in `config.toml` because T3 omits the field when no
provider-option selection exists.

## Verification

```sh
vp test apps/server/src/codexModelOptions.test.ts apps/server/src/provider/Layers/CodexProvider.test.ts apps/server/src/provider/Layers/CodexAdapter.test.ts apps/server/src/provider/Layers/CodexSessionRuntime.test.ts
vp check
vp run typecheck
```
