# Hermes

Hermes support is early access and uses Hermes Agent's local ACP server. Install and configure
Hermes before adding it to T3 Code.

## Configure a profile

Use Hermes's own CLI for installation, authentication, and model selection:

```bash
hermes --profile default model
```

For another agent configuration, create or configure a named profile:

```bash
hermes --profile research model
```

T3 does not run this interactive setup for you.

## Add it to T3 Code

Open Settings, add a provider instance, and choose Hermes. Set:

```text
Display name: Hermes Research
Binary path: hermes
Hermes profile: research
```

Create a separate provider instance for every profile you want to use. Profiles are not discovered
automatically.

You can choose a Hermes instance and model for an individual chat or set it as a project's default
model selection. Existing threads remain bound to the instance and Hermes session that created
them.

## Manage automations

Open Automations in the sidebar to manage scheduled jobs for enabled Hermes profiles across all
connected environments. You can create and edit jobs, pause or resume them, trigger an immediate
run, and delete them. T3 uses the binary, profile, and server-side environment from each Hermes
provider instance, so jobs remain isolated to that profile.

Hermes's gateway must be running for scheduled jobs to fire automatically:

```bash
hermes --profile <profile> cron status
hermes --profile <profile> gateway install
```

The Automations page manages Hermes jobs; scheduled output is still delivered through the target
configured on each job. It does not currently create or continue T3 chat threads.

## Runtime modes

- Approval required asks before protected operations.
- Auto-accept edits lets Hermes edit the workspace while retaining sensitive-operation checks.
- Full access uses Hermes's session-scoped don't-ask mode and automatically answers dangerous-command
  prompts without creating permanent approval rules.

Hermes does not currently expose a T3 plan/implementation toggle. Its ACP modes govern approval
behavior instead.

## Troubleshooting

If T3 reports that the binary is missing, set Binary path to the executable returned by:

```bash
command -v hermes
```

If the profile is not ready, configure it and refresh provider status:

```bash
hermes --profile <profile> model
```

If a restored thread fails, verify the same profile still owns the session. Changing a provider
instance's profile intentionally points it at a different Hermes state database.

Automation callbacks into T3 chats are not part of the ACP integration. They will use a Hermes
platform plugin so a scheduled agent can create or continue a T3 thread and trigger the existing
mobile push path.
