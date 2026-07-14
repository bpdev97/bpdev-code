# FORK-PUSH-001: personal APNs relay

This fork can deliver iOS notifications and AgentActivity Live Activity updates without Clerk or
the managed T3 relay. A small container on the tailnet owns the APNs provider key. Mobile devices
register through their already-authenticated T3 server connection, and each T3 server publishes
sanitized agent-awareness state to the container.

## Trust boundary

- The phone never receives the relay bearer token or APNs provider key.
- The T3 server can call only the typed personal-push adapter routes exposed to authenticated mobile
  sessions.
- The container accepts only device registration, Live Activity registration, snapshot reads, and
  agent-activity publication. It cannot forward arbitrary APNs payloads.
- APNs tokens and the last delivered aggregate are stored in SQLite. Logs include only token suffixes.
- Bind the published port to the host's Tailscale address and restrict it with Tailscale grants to
  the machines that run T3 servers.

## Container setup

From `apps/push-relay`, copy `.env.example` to `.env`. Create the secret files without committing
them:

```sh
mkdir -p secrets
openssl rand -hex 32 > secrets/relay-auth-token
chmod 600 secrets/relay-auth-token secrets/AuthKey_KEYID.p8
docker compose --env-file .env -f compose.example.yml up -d --build
```

The Apple Team ID, Key ID, bundle ID, and APNs environment are identifiers, not secrets. The `.p8`
file and relay authentication token are secrets. Use an Apple key restricted to APNs when possible.
Production/TestFlight builds use `APNS_ENVIRONMENT=production`; development-signed builds use
`sandbox` and should use a separate relay instance and database. Device registrations whose bundle
ID or APNs environment differs from the container configuration are rejected.

Each machine running `t3` needs two environment variables. The token content must match the
container's `relay-auth-token` file:

```sh
export T3CODE_PERSONAL_PUSH_RELAY_URL=http://100.x.y.z:8788
export T3CODE_PERSONAL_PUSH_RELAY_TOKEN="$(cat /secure/path/relay-auth-token)"
t3
```

No `.p8` file is installed on a T3 server. Restart the mobile app and T3 servers after first
configuration. The mobile settings registration status reflects whether at least one configured
backend accepted the device.

## Operations

`GET /healthz` is the only unauthenticated route. Back up the `push-relay-data` volume if preserving
registrations matters; otherwise the app re-registers them. Rotate the relay token by updating its
secret file and every T3 server together, then recreate the container. Rotate or revoke the Apple
key in the Apple Developer portal if the `.p8` is exposed.

The protocol is versioned under `/v1`. Upstream maintenance should preserve the personal-push
contract schemas, the additive server route layer, and the mobile connection bridge. Re-run the
focused tests plus the repository checks after changes to agent-awareness projection or relay
contracts.

## Verification

```sh
vp test apps/push-relay/src
vp run --filter @bpdev/push-relay build
vp check
vp run typecheck
vp run lint:mobile
```
