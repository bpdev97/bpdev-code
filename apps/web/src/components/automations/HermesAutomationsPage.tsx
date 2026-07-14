import { useEffect, useMemo, useState } from "react";
import {
  CalendarClockIcon,
  CircleAlertIcon,
  Clock3Icon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import type {
  EnvironmentId,
  HermesAutomation,
  HermesAutomationHost,
  HermesAutomationListResult,
  HermesAutomationMutationInput,
} from "@t3tools/contracts";
import {
  buildHermesAutomationUpsert,
  draftForHermesAutomation,
  type HermesAutomationDraft,
  validateHermesAutomationDraft,
} from "@t3tools/client-runtime/operations/hermes-automations";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import { isElectron } from "~/env";
import { cn } from "~/lib/utils";
import { useEnvironments } from "~/state/environments";
import { hermesAutomationEnvironment } from "~/state/hermesAutomations";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { SidebarInset } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { stackedThreadToast, toastManager } from "../ui/toast";

interface AutomationEditorTarget {
  readonly host: HermesAutomationHost;
  readonly automation: HermesAutomation | null;
}

function formatTimestamp(value: string | null): string {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function mutationMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "The Hermes automation request failed.";
}

function AutomationEditorDialog({
  target,
  submitting,
  onClose,
  onSubmit,
}: {
  readonly target: AutomationEditorTarget | null;
  readonly submitting: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (input: HermesAutomationMutationInput) => void;
}) {
  const [draft, setDraft] = useState<HermesAutomationDraft>(() =>
    draftForHermesAutomation(target?.automation ?? null),
  );
  const editing = target?.automation !== null && target?.automation !== undefined;
  const validation = validateHermesAutomationDraft(draft);
  const valid = Boolean(target) && validation.ok;

  const update = <K extends keyof HermesAutomationDraft>(key: K, value: HermesAutomationDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const submit = () => {
    if (!target || !valid) return;
    const result = buildHermesAutomationUpsert({
      instanceId: target.host.instanceId,
      ...(target.automation ? { automationId: target.automation.id } : {}),
      draft,
    });
    if (result.ok) onSubmit(result.input);
  };

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="max-w-2xl overflow-hidden">
        <DialogHeader className="border-b border-border/70">
          <DialogTitle>{editing ? "Edit automation" : "Create automation"}</DialogTitle>
          <DialogDescription>
            {target?.host.displayName ?? "Hermes"} · profile {target?.host.profile ?? ""}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-xs font-medium">
            Name
            <Input
              value={draft.name}
              onChange={(event) => update("name", event.target.value)}
              placeholder="Morning briefing"
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            Schedule
            <Input
              required
              value={draft.schedule}
              onChange={(event) => update("schedule", event.target.value)}
              placeholder="0 9 * * * or every 2h"
              aria-invalid={!validation.ok && validation.field === "schedule"}
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium sm:col-span-2">
            Prompt
            <Textarea
              value={draft.prompt}
              onChange={(event) => update("prompt", event.target.value)}
              placeholder="Describe what Hermes should do on each run."
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            Delivery target
            <Input
              value={draft.delivery}
              onChange={(event) => update("delivery", event.target.value)}
              placeholder="local, telegram, slack…"
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            Repeat limit
            <Input
              inputMode="numeric"
              value={draft.repeat}
              onChange={(event) => update("repeat", event.target.value)}
              placeholder="Blank for schedule default"
              aria-invalid={!validation.ok && validation.field === "repeat"}
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium sm:col-span-2">
            Skills
            <Input
              value={draft.skills}
              onChange={(event) => update("skills", event.target.value)}
              placeholder="Comma-separated skill names"
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            Script
            <Input
              value={draft.script}
              onChange={(event) => update("script", event.target.value)}
              placeholder="Script under ~/.hermes/scripts"
              aria-invalid={!validation.ok && validation.field === "script"}
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            Working directory
            <Input
              value={draft.workdir}
              onChange={(event) => update("workdir", event.target.value)}
              placeholder="/path/to/project"
            />
          </label>
          <label className="flex items-start gap-2 rounded-lg border border-border/70 bg-muted/30 p-3 text-xs sm:col-span-2">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-primary"
              checked={draft.noAgent}
              onChange={(event) => update("noAgent", event.target.checked)}
            />
            <span>
              <span className="block font-medium text-foreground">Script-only mode</span>
              <span className="text-muted-foreground">
                Skip the model and deliver the script output directly. A script is required.
              </span>
            </span>
          </label>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid || submitting}>
            {submitting ? <Spinner className="size-3.5" /> : null}
            {editing ? "Save changes" : "Create automation"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function AutomationCard({
  automation,
  busy,
  onEdit,
  onAction,
}: {
  readonly automation: HermesAutomation;
  readonly busy: boolean;
  readonly onEdit: () => void;
  readonly onAction: (action: "pause" | "resume" | "run" | "remove") => void;
}) {
  const repeat = automation.repeat.times
    ? `${automation.repeat.completed}/${automation.repeat.times} runs`
    : `${automation.repeat.completed} runs`;
  return (
    <article className="rounded-xl border border-border/70 bg-background p-4 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{automation.name}</h3>
            <Badge variant={automation.enabled ? "success" : "warning"}>{automation.state}</Badge>
            {automation.noAgent ? <Badge variant="outline">script only</Badge> : null}
          </div>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{automation.schedule}</p>
        </div>
        {busy ? <Spinner className="mt-1 size-4 shrink-0" /> : null}
      </div>

      {automation.prompt ? (
        <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-sm text-foreground/85">
          {automation.prompt}
        </p>
      ) : null}

      <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
        <span className="flex items-center gap-1.5">
          <Clock3Icon className="size-3.5" /> Next: {formatTimestamp(automation.nextRunAt)}
        </span>
        <span>Delivery: {automation.delivery.join(", ")}</span>
        <span>{repeat}</span>
        {automation.skills.length > 0 ? <span>Skills: {automation.skills.join(", ")}</span> : null}
        {automation.lastRunAt ? <span>Last: {formatTimestamp(automation.lastRunAt)}</span> : null}
        {automation.lastStatus ? <span>Status: {automation.lastStatus}</span> : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="xs" variant="outline" onClick={onEdit} disabled={busy}>
          <PencilIcon /> Edit
        </Button>
        <Button size="xs" variant="outline" onClick={() => onAction("run")} disabled={busy}>
          <PlayIcon /> Run now
        </Button>
        <Button
          size="xs"
          variant="outline"
          onClick={() => onAction(automation.enabled ? "pause" : "resume")}
          disabled={busy}
        >
          {automation.enabled ? <PauseIcon /> : <PlayIcon />}
          {automation.enabled ? "Pause" : "Resume"}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          onClick={() => onAction("remove")}
          disabled={busy}
        >
          <Trash2Icon /> Delete
        </Button>
      </div>
    </article>
  );
}

function HermesHostCard({
  host,
  busyId,
  onCreate,
  onEdit,
  onAction,
}: {
  readonly host: HermesAutomationHost;
  readonly busyId: string | null;
  readonly onCreate: () => void;
  readonly onEdit: (automation: HermesAutomation) => void;
  readonly onAction: (
    automation: HermesAutomation,
    action: "pause" | "resume" | "run" | "remove",
  ) => void;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card/60 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <CalendarClockIcon className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">{host.displayName}</h2>
            <Badge variant={host.status === "available" ? "success" : "error"}>{host.status}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Hermes profile: {host.profile}</p>
        </div>
        <Button size="sm" onClick={onCreate} disabled={host.status !== "available"}>
          <PlusIcon /> New automation
        </Button>
      </div>

      {host.statusMessage ? (
        <div className="mt-4 flex gap-2 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">
          <CircleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <span>{host.statusMessage}</span>
        </div>
      ) : host.automations.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No automations are configured for this profile.
        </div>
      ) : (
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {host.automations.map((automation) => (
            <AutomationCard
              key={automation.id}
              automation={automation}
              busy={busyId === automation.id}
              onEdit={() => onEdit(automation)}
              onAction={(action) => onAction(automation, action)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function EnvironmentAutomations({
  environmentId,
  label,
  displayUrl,
}: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly displayUrl: string | null;
}) {
  const query = useEnvironmentQuery(hermesAutomationEnvironment.list({ environmentId, input: {} }));
  const mutate = useAtomCommand(hermesAutomationEnvironment.mutate, {
    label: "Manage Hermes automation",
    reportFailure: false,
  });
  const [localResult, setLocalResult] = useState<HermesAutomationListResult | null>(null);
  const [editorTarget, setEditorTarget] = useState<AutomationEditorTarget | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const result = localResult ?? query.data;

  useEffect(() => setLocalResult(null), [query.data]);

  const performMutation = async (input: HermesAutomationMutationInput) => {
    setBusyId("automationId" in input ? input.automationId : "create");
    const outcome = await mutate({ environmentId, input });
    setBusyId(null);
    if (outcome._tag === "Failure") {
      if (!isAtomCommandInterrupted(outcome)) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Hermes automation failed",
            description: mutationMessage(squashAtomCommandFailure(outcome)),
          }),
        );
      }
      return false;
    }
    setLocalResult(outcome.value);
    query.refresh();
    return true;
  };

  const submitEditor = async (input: HermesAutomationMutationInput) => {
    if (await performMutation(input)) {
      setEditorTarget(null);
      toastManager.add({
        type: "success",
        title: input.action === "create" ? "Automation created" : "Automation updated",
      });
    }
  };

  const performLifecycle = async (
    host: HermesAutomationHost,
    automation: HermesAutomation,
    action: "pause" | "resume" | "run" | "remove",
  ) => {
    if (
      action === "remove" &&
      !window.confirm(`Delete automation “${automation.name}”? This cannot be undone.`)
    ) {
      return;
    }
    const succeeded = await performMutation({
      action,
      instanceId: host.instanceId,
      automationId: automation.id,
    });
    if (succeeded) {
      toastManager.add({
        type: "success",
        title:
          action === "run"
            ? "Automation triggered"
            : action === "remove"
              ? "Automation deleted"
              : `Automation ${action}d`,
      });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{label}</h2>
          {displayUrl ? (
            <p className="truncate text-xs text-muted-foreground">{displayUrl}</p>
          ) : null}
        </div>
        <Button size="xs" variant="ghost" onClick={query.refresh} disabled={query.isPending}>
          <RefreshCwIcon className={cn(query.isPending && "animate-spin")} /> Refresh
        </Button>
      </div>

      {query.error ? (
        <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive">
          {query.error}
        </div>
      ) : !result ? (
        <div className="grid min-h-28 place-items-center rounded-xl border border-border/70">
          <Spinner className="size-5" />
        </div>
      ) : result.hosts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
          No enabled Hermes profiles are configured on this environment.
        </div>
      ) : (
        result.hosts.map((host) => (
          <HermesHostCard
            key={host.instanceId}
            host={host}
            busyId={busyId}
            onCreate={() => setEditorTarget({ host, automation: null })}
            onEdit={(automation) => setEditorTarget({ host, automation })}
            onAction={(automation, action) => void performLifecycle(host, automation, action)}
          />
        ))
      )}

      {editorTarget ? (
        <AutomationEditorDialog
          key={`${editorTarget.host.instanceId}:${editorTarget.automation?.id ?? "new"}`}
          target={editorTarget}
          submitting={busyId !== null}
          onClose={() => setEditorTarget(null)}
          onSubmit={(input) => void submitEditor(input)}
        />
      ) : null}
    </div>
  );
}

export function HermesAutomationsPage() {
  const { environments, isReady } = useEnvironments();
  const sortedEnvironments = useMemo(
    () => environments.toSorted((left, right) => left.label.localeCompare(right.label)),
    [environments],
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header
          className={cn(
            "shrink-0 border-b border-border px-4 py-3 sm:px-6",
            isElectron &&
              "drag-region flex h-[52px] items-center py-0 wco:h-[env(titlebar-area-height)] wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]",
            COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
          )}
        >
          <div>
            <h1 className="text-sm font-semibold">Automations</h1>
            {!isElectron ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Manage scheduled jobs across connected Hermes environments.
              </p>
            ) : null}
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          <div className="mx-auto max-w-6xl space-y-7">
            {!isReady ? (
              <div className="grid min-h-40 place-items-center">
                <Spinner className="size-5" />
              </div>
            ) : sortedEnvironments.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-10 text-center">
                <CalendarClockIcon className="mx-auto size-7 text-muted-foreground" />
                <p className="mt-3 text-sm font-medium">No environments are connected</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Connect a Hermes host to manage its automations here.
                </p>
              </div>
            ) : (
              sortedEnvironments.map((environment) => (
                <EnvironmentAutomations
                  key={environment.environmentId}
                  environmentId={environment.environmentId}
                  label={environment.label}
                  displayUrl={environment.displayUrl}
                />
              ))
            )}
          </div>
        </main>
      </div>
    </SidebarInset>
  );
}
