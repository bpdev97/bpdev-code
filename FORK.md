# About this fork

This is my personal build of [T3 Code](https://github.com/pingdotgg/t3code). I keep it in
[`bpdev97/bpdev-code`](https://github.com/bpdev97/bpdev-code) so I can install it alongside the
official app and ship my own iOS and macOS updates.

## Branches

- `main` is the version I install and release. It should always be buildable and is never
  force-pushed.
- `upstream/main` tracks the original repository.
- I make changes on `codex/*` branches and merge them through PRs.
- The weekly upstream sync uses `sync/upstream-main` and opens a PR instead of merging on its own.

## Fork-specific configuration

App names, bundle IDs, URL schemes, and other public identifiers live in
`downstream/config.ts`. Credentials stay in Expo, App Store Connect, or GitHub Actions.

Most features should go in the same package they would use upstream. The `downstream` directory is
only for the small amount of configuration that makes this a separate installable app.

These are the main files to check when an upstream merge conflicts with the fork setup:

| File                                         | What it controls                         |
| -------------------------------------------- | ---------------------------------------- |
| `apps/mobile/app.config.ts`                  | Expo project and iOS app identity        |
| `apps/mobile/eas.json`                       | Personal iOS build and update channel    |
| `scripts/build-desktop-artifact.ts`          | macOS packaging identity                 |
| `apps/desktop/src/app/DesktopEnvironment.ts` | Desktop name and local storage locations |

The fork's workflows start with `personal-`. The upstream release workflows are left alone to keep
syncs simple, but they should be disabled in this repository's Actions settings:

- `CI`
- `Release`
- `Deploy Relay`
- `Mobile EAS Preview`
- `Mobile EAS Production`

## Releases

The iOS app is distributed through TestFlight. Native builds and OTA updates use the EAS
`personal` channel. Expo's fingerprint runtime policy keeps an OTA update from reaching a binary
with incompatible native code.

The macOS app is published through this repository's GitHub Releases. It uses `~/.bpdev-code` for
state and `bpdev-code` for Electron data, so it can run next to the official app without sharing
files.

## Fork feature delta registry

Agents must read the referenced maintenance record before rebasing upstream or modifying a listed
feature.

| ID                | Feature                                         | Status               | Maintenance record                                       | Tests                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------- | ----------------------------------------------- | -------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FORK-CHAT-001`   | Directoryless generic chat                      | Active               | [`docs/fork/generic-chat.md`](docs/fork/generic-chat.md) | `vp test packages/shared/src/genericChat.test.ts packages/shared/src/threadResponseGrouping.test.ts packages/client-runtime/src/state/projectGrouping.genericChat.test.ts apps/server/src/genericChat.test.ts apps/server/src/orchestration/Layers/ProviderCommandReactor.genericChat.test.ts apps/web/src/components/chat/MessagesTimeline.logic.test.ts apps/mobile/src/lib/repositoryGroups.test.ts apps/mobile/src/lib/threadActivity.test.ts` |
| `FORK-HERMES-001` | Hermes Agent provider and automation management | Active, early access | [`docs/fork/hermes.md`](docs/fork/hermes.md)             | `vp test apps/server/src/provider/hermes packages/contracts/src/settings.test.ts packages/client-runtime/src/operations/hermesAutomations.test.ts apps/web/src/components/settings/SettingsPanels.logic.test.ts`                                                                                                                                                                                                                                   |

### FORK-CHAT-001 ownership map

Fork-owned paths:

- `packages/shared/src/genericChat.ts`
- `packages/shared/src/threadResponseGrouping.ts`
- `packages/client-runtime/src/state/projectGrouping.genericChat.test.ts`
- `apps/server/src/genericChat.ts`
- focused `genericChat.test.ts` files
- `apps/mobile/src/features/threads/use-start-generic-chat.ts`
- `apps/mobile/src/features/threads/ProjectThreadRouteGuard.tsx`
- `docs/fork/generic-chat.md`

Shared upstream touchpoints containing additive generic-chat behavior:

- `packages/shared/package.json`
- `packages/client-runtime/src/state/projectGrouping.ts`
- `apps/server/src/serverRuntimeStartup.ts`
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
- `apps/web/src/hooks/useHandleNewThread.ts`
- `apps/web/src/components/NoActiveThreadState.tsx`
- `apps/web/src/components/Sidebar.tsx`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/components/RightPanelTabs.tsx`
- mobile home, thread-list, new-task, workspace, Git, file, and terminal surfaces under
  `apps/mobile/src/`

The protocol still requires projects and provider cwd values. The managed scratch workspace preserves
those invariants; the reserved project ID selects provider context, runtime restrictions, logical
grouping, and client capability guards.

### Generic chat upstream sync playbook

1. Compare upstream changes to project startup, provider session creation, runtime-mode restarts,
   project grouping, and new-thread flows on web and mobile.
2. Preserve the reserved ID and idempotent startup repair behavior.
3. Reapply UI guards through shared capability seams; do not fork whole upstream components.
4. Verify that provider context is still added to every initial, resumed, and attachment-only turn.
5. Run the focused tests plus `vp check`, `vp run typecheck`, and `vp run lint:mobile`.

Remove `FORK-CHAT-001` only when upstream provides equivalent non-project chat semantics, including
safe migration or continuation of threads stored under the reserved project. A cosmetic New Chat
button without the provider and capability boundaries is not equivalent.

### FORK-HERMES-001 ownership map

Fork-owned paths:

- `apps/server/src/provider/hermes/`
- `apps/web/src/components/HermesIcon.tsx`
- `apps/web/src/components/automations/`
- `apps/web/src/routes/automations.tsx`
- `apps/web/src/state/hermesAutomations.ts`
- `apps/mobile/src/features/automations/`
- `apps/mobile/src/state/hermesAutomations.ts`
- `packages/contracts/src/hermesAutomation.ts`
- `packages/client-runtime/src/operations/hermesAutomations.ts`
- `packages/client-runtime/src/state/hermesAutomations.ts`
- `docs/fork/hermes.md`
- `docs/providers/hermes.md`

Shared upstream touchpoints containing small additive entries:

- `AGENTS.md`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/rpc.ts`
- `packages/contracts/src/settings.ts`
- `packages/contracts/src/model.ts`
- `packages/client-runtime/package.json`
- `packages/client-runtime/src/operations/index.ts`
- `apps/server/src/provider/builtInDrivers.ts`
- `apps/server/src/provider/acp/AcpRuntimeModel.ts`
- `apps/server/src/provider/acp/AcpSessionRuntime.ts`
- `apps/server/src/provider/acp/AcpCoreRuntimeEvents.ts`
- `apps/server/src/ws.ts`
- `apps/web/src/routeTree.gen.ts`
- `apps/web/src/components/Sidebar.tsx`
- `apps/web/src/session-logic.ts`
- `apps/web/src/components/settings/providerDriverMeta.ts`
- `apps/web/src/components/settings/SettingsPanels.tsx`
- `apps/web/src/components/settings/SettingsPanels.logic.ts`
- `apps/web/src/components/chat/providerIconUtils.ts`
- `apps/mobile/src/Stack.tsx`
- `apps/mobile/src/features/settings/SettingsRouteScreen.tsx`
- `apps/mobile/src/features/settings/components/settings-sheet-targets.ts`
- `apps/mobile/src/components/ProviderIcon.tsx`
- `docs/README.md`

The provider is deliberately absent from the legacy `ServerSettings.providers` object. It is
registered only through `providerInstances`, so removing this fork from a build leaves its settings
as a preserved unavailable-driver envelope rather than corrupting configuration.

### Hermes upstream sync playbook

1. Record the old and new `upstream/main` SHAs.
2. Intersect the upstream diff with the shared touchpoints above.
3. Preserve fork-owned paths unless an upstream provider interface changed.
4. Resolve shared-file conflicts by reapplying only the additive Hermes entry or the reasoning-stream
   compatibility case; do not replace the upstream file wholesale.
5. Review changes to provider instances, ACP session setup, canonical runtime events, settings forms,
   and mobile notification ingestion even when Git reports no textual conflict.
6. Run the Hermes-focused tests, `vp check`, `vp run typecheck`, and `vp run lint:mobile`.
7. Add a row to the sync ledger describing conflicts and behavioral changes.

### Hermes compatibility baseline

Runtime compatibility is capability-probed; newer Hermes versions are not rejected merely because
their version differs. The detailed source-review and real-binary smoke coverage lives in
`docs/fork/hermes.md`. A source review or partial transport smoke must not be presented as a
successful end-to-end chat.

| Date       | Old upstream | New upstream | Hermes baseline                                        | Notes                                                                                                        |
| ---------- | ------------ | ------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| 2026-07-12 | —            | `f61fa949`   | Hermes Agent 0.18.2 (`4281151`) source / ACP SDK 0.9.0 | Deterministic ACP tests passed; a Mac mini smoke reached model selection and verified detailed error output. |
| 2026-07-13 | `f61fa949`   | `c1ec1915`   | Hermes Agent 0.18.2 (`4281151`) source / ACP SDK 0.9.0 | No Hermes touchpoints changed; mobile conflicts preserved generic-chat guards and personal app identity.     |

Remove `FORK-HERMES-001` only when upstream T3 ships equivalent profile-aware Hermes ACP support and
existing versioned cursors can be migrated or continued without losing sessions. Compare behavior
and tests before replacing the fork implementation; matching provider branding alone is not
sufficient.

## Before merging

Run:

```sh
vp check
vp run typecheck
```

Also run `vp run lint:mobile` after changing mobile native code or configuration.

Never put credentials in commits, issues, PRs, or chat. The complete setup and first-release notes
are in `docs/personal-distribution.md`.
