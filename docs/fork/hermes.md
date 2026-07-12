# Hermes fork maintenance record

## Decision

Manual Hermes chats use Hermes Agent's official ACP server. This fork does not depend on Hermex or
the third-party `hermes-webui` REST/SSE service.

ACP reuses T3's process, session, permission, model, event-ingestion, reconnection, and notification
boundaries. The web API alternative exposes more Hermes-specific product concepts, but would add a
second network session model, cookie authentication, SSE recovery, and an unstable external API.

Primary external references:

- [Hermes ACP user guide](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/acp.md)
- [Hermes ACP internals](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/acp-internals.md)
- [Hermes programmatic integration options](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/programmatic-integration.md)
- [Hermes platform adapter guide](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/adding-platform-adapters.md)
- [Hermex README](https://github.com/uzairansaruzi/hermex/blob/master/README.md)
- [Hermex contract notes](https://github.com/uzairansaruzi/hermex/blob/master/CONTRACT_TESTS.md)

## Architecture

Each T3 provider instance names one explicit Hermes profile. T3 always starts:

```text
hermes --profile <profile> acp
```

The explicit flag prevents Hermes's sticky active-profile file from silently rerouting a T3
instance. Each active T3 thread owns one scoped ACP process. Hermes persists the native session in
its own state database; T3 stores canonical runtime events and this cursor:

```json
{
  "schemaVersion": 1,
  "transport": "acp",
  "sessionId": "..."
}
```

The transport discriminator is reserved for a future `gateway` cursor used by unsolicited
automation delivery.

One lazy utility ACP session per provider-instance lifecycle performs model discovery and serialized
text generation. It is reset before and after utility prompts and is never exposed as a T3 thread.

## Protocol mappings

Runtime modes:

| T3                  | Hermes ACP     |
| ------------------- | -------------- |
| `approval-required` | `default`      |
| `auto-accept-edits` | `accept_edits` |
| `full-access`       | `dont_ask`     |

Permission decisions are selected by Hermes's advertised option ID:

| T3                 | Hermes                                    |
| ------------------ | ----------------------------------------- |
| Accept             | `allow_once`                              |
| Accept for session | `allow_session`, then a one-time fallback |
| Decline            | `deny`                                    |

`allow_always` is intentionally never selected for a session-scoped T3 decision. Hermes encodes
both `allow_session` and `allow_always` using ACP's `allow_always` kind, so kind-only matching would
persist approval accidentally.

Hermes `agent_message_chunk` and `agent_thought_chunk` notifications map to T3 assistant and
reasoning streams. Tool calls, plans, permissions, and terminal turn states use the shared canonical
ACP event constructors.

## Authentication and setup

Hermes advertises the configured provider as an agent-managed authentication method and also
advertises the terminal-only `hermes-setup` method. T3 selects the configured provider method and
never invokes terminal setup. If terminal setup is the only advertised method, the profile is
reported as unconfigured with the user-owned remediation:

```text
hermes --profile <profile> model
```

## Compatibility invariants

- Profile instances must not share mutable process, model-cache, permission, or cursor state.
- Existing ACP cursors must remain loadable after gateway support is added.
- Provider output must flow through canonical runtime events; direct UI message writes bypass
  persistence, reconnect semantics, and push notifications.
- Session approval must never become permanent approval.
- Health refreshes may rerun the version command but must reuse cached model discovery.
- Unknown future provider configuration must continue to round-trip through the generic instance
  envelope.
- Generic-only drivers must not synthesize a legacy default row in provider settings. They appear
  only when an explicit `providerInstances` entry exists.
- External errors may be logged structurally but must not copy credentials or raw stderr into user
  messages.
- Standard JSON-RPC error responses from ACP peers are normalized from Effect RPC defects into typed
  ACP request errors. User-facing adapter errors may append a non-empty string at `data.details`, but
  must not render arbitrary error data.

## Compatibility baseline

The source review completed on 2026-07-12 against Hermes Agent 0.18.2 at commit
`4281151ae859241351ba14d8c7682dc67ff4c126` and ACP SDK 0.9.0. The deterministic fixture covers
`session/new`, `session/load`, `session/prompt`, `session/cancel`, `session/set_model`,
`session/set_mode`, and `session/request_permission`.

The 2026-07-12 Mac mini smoke reached `session/set_model` with a real Hermes binary. Hermes then
returned the provider-routing error described below, and T3 surfaced its `data.details` diagnostic.
This was a partial transport and error-reporting smoke, not a successful end-to-end chat.

## Known upstream compatibility

Hermes Agent v0.17.0 can advertise a live OpenAI Codex model such as
`openai-codex:gpt-5.6-terra` and then incorrectly route it to OpenRouter during
`session/set_model`. The resulting JSON-RPC error says no provider is configured when OpenRouter is
not enrolled. Preserve the explicit provider in Hermes rather than adding a T3 model-routing
workaround; the ACP error normalization above exists to surface the upstream diagnostic accurately.

## Automation follow-up

ACP is request/response over stdio and cannot initiate a message after its host process has gone
away. Automation delivery will therefore use an out-of-tree Hermes platform plugin and a
transport-discriminated gateway cursor. The plugin will translate durable deliveries into the same
canonical turn lifecycle used here, allowing T3's existing agent-awareness relay to send mobile push
notifications and deep-link into the exact automation-backed thread.

Do not add polling against `hermes-webui` as a shortcut.

## Revalidation procedure

When updating the Hermes baseline:

1. Compare Hermes's ACP auth, session setup, model state, mode state, permissions, and persistence
   implementation with the mappings above.
2. Run the adapter and text-generation tests against the deterministic ACP mock.
3. With a configured real profile, verify version output, model discovery, a tool approval in each
   runtime mode, process restart, and `session/load`.
4. Update the compatibility baseline above only for checks that actually ran; distinguish source
   review, partial smoke coverage, and a successful end-to-end chat.
5. Record any T3 upstream sync separately in `/FORK.md`.
