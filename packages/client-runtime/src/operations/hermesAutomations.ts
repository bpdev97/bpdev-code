import type {
  HermesAutomation,
  HermesAutomationMutationInput,
  ProviderInstanceId,
} from "@t3tools/contracts";

export interface HermesAutomationDraft {
  readonly name: string;
  readonly schedule: string;
  readonly prompt: string;
  readonly delivery: string;
  readonly repeat: string;
  readonly skills: string;
  readonly script: string;
  readonly workdir: string;
  readonly noAgent: boolean;
}

export type HermesAutomationDraftValidation =
  | {
      readonly ok: true;
      readonly repeat: number | undefined;
    }
  | {
      readonly ok: false;
      readonly field: "schedule" | "repeat" | "script";
      readonly message: string;
    };

export function draftForHermesAutomation(
  automation: HermesAutomation | null,
): HermesAutomationDraft {
  return {
    name: automation?.name ?? "",
    schedule: automation?.schedule ?? "",
    prompt: automation?.prompt ?? "",
    delivery: automation?.delivery.join(",") ?? "local",
    repeat: automation?.repeat.times == null ? "" : String(automation.repeat.times),
    skills: automation?.skills.join(", ") ?? "",
    script: automation?.script ?? "",
    workdir: automation?.workdir ?? "",
    noAgent: automation?.noAgent ?? false,
  };
}

export function validateHermesAutomationDraft(
  draft: HermesAutomationDraft,
): HermesAutomationDraftValidation {
  if (draft.schedule.trim().length === 0) {
    return { ok: false, field: "schedule", message: "Enter a schedule." };
  }

  const repeat = draft.repeat.trim().length > 0 ? Number(draft.repeat) : undefined;
  if (
    repeat !== undefined &&
    (!Number.isInteger(repeat) || !Number.isFinite(repeat) || repeat <= 0)
  ) {
    return {
      ok: false,
      field: "repeat",
      message: "Repeat limit must be a positive whole number.",
    };
  }

  if (draft.noAgent && draft.script.trim().length === 0) {
    return {
      ok: false,
      field: "script",
      message: "Script-only mode requires a script.",
    };
  }

  return { ok: true, repeat };
}

function commaSeparated(value: string): ReadonlyArray<string> {
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

export function buildHermesAutomationUpsert(input: {
  readonly instanceId: ProviderInstanceId;
  readonly automationId?: string;
  readonly draft: HermesAutomationDraft;
}):
  | { readonly ok: true; readonly input: HermesAutomationMutationInput }
  | { readonly ok: false; readonly message: string } {
  const validation = validateHermesAutomationDraft(input.draft);
  if (!validation.ok) {
    return validation;
  }

  const common = {
    instanceId: input.instanceId,
    schedule: input.draft.schedule.trim(),
    prompt: input.draft.prompt,
    ...(input.draft.name.trim() ? { name: input.draft.name.trim() } : {}),
    ...(input.draft.delivery.trim() ? { delivery: input.draft.delivery.trim() } : {}),
    ...(validation.repeat === undefined ? {} : { repeat: validation.repeat }),
    skills: commaSeparated(input.draft.skills),
    script: input.draft.script,
    noAgent: input.draft.noAgent,
    workdir: input.draft.workdir,
  } as const;

  return {
    ok: true,
    input:
      input.automationId === undefined
        ? { action: "create", ...common }
        : { action: "update", automationId: input.automationId, ...common },
  };
}
