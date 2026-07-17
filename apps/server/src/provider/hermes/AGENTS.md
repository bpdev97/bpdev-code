# Hermes provider maintenance

Read `/FORK.md` and `/docs/fork/hermes.md` before modifying this directory.

## Invariants

- Manual chats use the official Hermes ACP server. Do not add a dependency on Hermex or
  `hermes-webui`.
- One T3 provider instance maps to one explicit Hermes profile. Never read or change Hermes's
  sticky active profile.
- Resume cursors are versioned and transport-discriminated. Existing `transport: "acp"` cursors
  must remain loadable when a future gateway cursor is added.
- Hermes sessions and transcripts remain owned by Hermes. T3 stores its canonical event history
  and the opaque resume cursor; do not introduce a second Hermes transcript database.
- Map `acceptForSession` only to `allow_session`, with a one-time fallback. Never silently choose
  `allow_always`.
- Provider events must enter T3 through canonical runtime events so reconnect, persistence, and
  mobile notifications continue to use the shared orchestration path.
- Interactive Hermes installation and provider setup remain terminal-owned. T3 may report the
  remediation command but must not launch the setup flow.

## Compatibility work

When Hermes Agent changes ACP behavior:

1. Compare the new implementation with the source links in `/docs/fork/hermes.md`.
2. Update focused ACP fixtures and tests before changing mappings.
3. Update the compatibility baseline in `/docs/fork/hermes.md` and the `/FORK.md` sync ledger only
   after the corresponding source review or real-binary check runs.
4. Run the Hermes tests, `vp check`, `vp run typecheck`, and `vp run lint:mobile`.
