# Hermes provider maintenance

Read `/FORK.md` and `/docs/fork/hermes.md` before modifying this directory.

## Invariants

- Manual chats use Hermes's official TUI gateway, not ACP, Hermex, or `hermes-webui`.
- One provider instance owns one explicit profile and one supervised isolated loopback backend.
- Authenticate WebSockets with a random dashboard token. Never set `HERMES_DESKTOP=1`.
- Store the durable Hermes session key in the versioned `transport: "tui-gateway"` cursor. Hermes
  remains the transcript owner.
- Legacy ACP cursors are intentionally not loadable after the approved migration.
- Preserve gateway event order per session before emitting canonical T3 runtime events.
- Treat `prompt.submit` as a full-turn RPC: supervise it without blocking `sendTurn`, otherwise T3
  cannot expose steering or interruption while Hermes is working.
- Map `acceptForSession` to `session`; never silently choose permanent `always` approval.
- Provider events must enter through canonical runtime events so reconnect, persistence, and mobile
  notifications continue to use shared orchestration.
- Provider setup remains terminal-owned. Report the remediation command; do not launch setup.
- Automation management remains on the existing CLI/file projection. Do not enable the gateway's
  desktop cron ticker or add automation delivery without a separate design.

## Compatibility work

When Hermes changes gateway behavior:

1. Compare the programmatic guide, gateway protocol types, WebSocket transport, and server handlers
   linked from `/docs/fork/hermes.md`.
2. Update focused gateway fixtures and tests before changing mappings.
3. Update the compatibility baseline only after the corresponding source review or real-binary test.
4. Run Hermes tests, `vp check`, and `vp run typecheck`; run `vp run lint:mobile` when mobile code
   changes.
