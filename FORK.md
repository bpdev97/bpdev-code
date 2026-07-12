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

## Before merging

Run:

```sh
vp check
vp run typecheck
```

Also run `vp run lint:mobile` after changing mobile native code or configuration.

Never put credentials in commits, issues, PRs, or chat. The complete setup and first-release notes
are in `docs/personal-distribution.md`.
