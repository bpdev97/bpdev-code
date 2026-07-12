import {
  type HermesSettings,
  type ProviderApprovalDecision,
  ProviderDriverKind,
  type RuntimeMode,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import * as AcpSessionRuntime from "../acp/AcpSessionRuntime.ts";

export const HERMES_DRIVER_KIND = ProviderDriverKind.make("hermes");
const HERMES_SETUP_AUTH_METHOD_ID = "hermes-setup";
export const HERMES_RESUME_SCHEMA_VERSION = 1;

export interface HermesAcpConversationCursor {
  readonly schemaVersion: typeof HERMES_RESUME_SCHEMA_VERSION;
  readonly transport: "acp";
  readonly sessionId: string;
}

type HermesAcpRuntimeSettings = Pick<HermesSettings, "binaryPath" | "profile">;

interface HermesAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "clientCapabilities" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly hermesSettings: HermesAcpRuntimeSettings;
  readonly environment?: NodeJS.ProcessEnv;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseHermesAcpConversationCursor(
  raw: unknown,
): HermesAcpConversationCursor | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw.schemaVersion !== HERMES_RESUME_SCHEMA_VERSION || raw.transport !== "acp") {
    return undefined;
  }
  if (typeof raw.sessionId !== "string" || raw.sessionId.trim().length === 0) {
    return undefined;
  }
  return {
    schemaVersion: HERMES_RESUME_SCHEMA_VERSION,
    transport: "acp",
    sessionId: raw.sessionId.trim(),
  };
}

export function buildHermesAcpSpawnInput(
  hermesSettings: HermesAcpRuntimeSettings,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
): AcpSessionRuntime.AcpSpawnInput {
  return {
    command: hermesSettings.binaryPath || "hermes",
    args: ["--profile", hermesSettings.profile, "acp"],
    cwd,
    ...(environment ? { env: environment } : {}),
  };
}

export function resolveHermesAuthMethodId(
  initializeResult: EffectAcpSchema.InitializeResponse,
): string | undefined {
  return initializeResult.authMethods
    ?.find(
      (method) =>
        method.id.trim() !== HERMES_SETUP_AUTH_METHOD_ID &&
        (!("type" in method) || method.type !== "terminal"),
    )
    ?.id.trim();
}

export const makeHermesAcpRuntime = (
  input: HermesAcpRuntimeInput,
): Effect.Effect<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn: buildHermesAcpSpawnInput(input.hermesSettings, input.cwd, input.environment),
        authMethodId: resolveHermesAuthMethodId,
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
      Effect.provide(acpContext),
    );
  });

export function resolveHermesModelId(model: string | null | undefined): string | undefined {
  return model?.trim() || undefined;
}

export function currentHermesModelIdFromSessionSetup(
  sessionSetupResult:
    | EffectAcpSchema.LoadSessionResponse
    | EffectAcpSchema.NewSessionResponse
    | EffectAcpSchema.ResumeSessionResponse,
): string | undefined {
  return resolveHermesModelId(sessionSetupResult.models?.currentModelId);
}

export function applyHermesAcpModelSelection<E>(input: {
  readonly runtime: Pick<AcpSessionRuntime.AcpSessionRuntime["Service"], "setSessionModel">;
  readonly currentModelId: string | undefined;
  readonly requestedModelId: string | undefined;
  readonly mapError: (cause: EffectAcpErrors.AcpError) => E;
}): Effect.Effect<string | undefined, E> {
  const requestedModelId = resolveHermesModelId(input.requestedModelId);
  if (requestedModelId === undefined || requestedModelId === input.currentModelId) {
    return Effect.succeed(input.currentModelId);
  }
  return input.runtime
    .setSessionModel(requestedModelId)
    .pipe(Effect.mapError(input.mapError), Effect.as(requestedModelId));
}

export function hermesModeForRuntimeMode(runtimeMode: RuntimeMode): string {
  switch (runtimeMode) {
    case "auto-accept-edits":
      return "accept_edits";
    case "full-access":
      return "dont_ask";
    case "approval-required":
      return "default";
  }
}

export function applyHermesRuntimeMode<E>(input: {
  readonly runtime: Pick<AcpSessionRuntime.AcpSessionRuntime["Service"], "request">;
  readonly sessionId: string;
  readonly runtimeMode: RuntimeMode;
  readonly currentModeId?: string | undefined;
  readonly mapError: (cause: EffectAcpErrors.AcpError) => E;
}): Effect.Effect<string, E> {
  const modeId = hermesModeForRuntimeMode(input.runtimeMode);
  if (input.currentModeId?.trim() === modeId) {
    return Effect.succeed(modeId);
  }
  return input.runtime
    .request("session/set_mode", {
      sessionId: input.sessionId,
      modeId,
    })
    .pipe(Effect.mapError(input.mapError), Effect.as(modeId));
}

function findPermissionOptionById(
  request: EffectAcpSchema.RequestPermissionRequest,
  optionId: string,
): string | undefined {
  return request.options.find((option) => option.optionId.trim() === optionId)?.optionId.trim();
}

function findPermissionOptionByKind(
  request: EffectAcpSchema.RequestPermissionRequest,
  kind: EffectAcpSchema.PermissionOptionKind,
): string | undefined {
  return request.options.find((option) => option.kind === kind)?.optionId.trim() || undefined;
}

export function selectHermesPermissionOptionId(
  request: EffectAcpSchema.RequestPermissionRequest,
  decision: ProviderApprovalDecision,
): string | undefined {
  switch (decision) {
    case "acceptForSession":
      return (
        findPermissionOptionById(request, "allow_session") ??
        findPermissionOptionById(request, "allow_once") ??
        findPermissionOptionByKind(request, "allow_once")
      );
    case "accept":
      return (
        findPermissionOptionById(request, "allow_once") ??
        findPermissionOptionByKind(request, "allow_once")
      );
    case "decline":
      return (
        findPermissionOptionById(request, "deny") ??
        findPermissionOptionByKind(request, "reject_once")
      );
    case "cancel":
      return undefined;
  }
}

export function selectHermesAutoApprovalOptionId(
  request: EffectAcpSchema.RequestPermissionRequest,
): string | undefined {
  return (
    findPermissionOptionById(request, "allow_session") ??
    findPermissionOptionById(request, "allow_once") ??
    findPermissionOptionByKind(request, "allow_once")
  );
}
