import {
  type HermesSettings,
  type ModelCapabilities,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { causeErrorTag } from "@t3tools/shared/observability";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import type * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  buildServerProvider,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import { HERMES_DRIVER_KIND } from "./HermesAcpSupport.ts";

const HERMES_PRESENTATION = {
  displayName: "Hermes",
  badgeLabel: "Early Access",
  showInteractionModeToggle: false,
  requiresNewThreadForModelChange: false,
} as const;
const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({ optionDescriptors: [] });
const VERSION_PROBE_TIMEOUT_MS = 4_000;
const MODEL_DISCOVERY_TIMEOUT_MS = 15_000;

export function describeHermesDiscoveryFailure(
  error: EffectAcpErrors.AcpError | undefined,
  profile: string,
): {
  readonly auth: { readonly status: "unauthenticated" | "unknown" };
  readonly message: string;
} {
  if (
    (error?._tag === "AcpTransportError" && error.method === "authenticate") ||
    (error?._tag === "AcpRequestError" && error.method === "authenticate")
  ) {
    return {
      auth: { status: "unauthenticated" },
      message: `Hermes profile '${profile}' is not ready. Configure it with \`hermes --profile ${profile} model\`, then refresh provider status.`,
    };
  }
  if (error?._tag === "AcpProtocolParseError") {
    return {
      auth: { status: "unknown" },
      message:
        "Hermes Agent returned an incompatible ACP response. Update Hermes or check the fork compatibility record.",
    };
  }
  return {
    auth: { status: "unknown" },
    message: "Hermes Agent is installed but ACP startup failed. Check server logs for details.",
  };
}

function modelsFromSettings(
  customModels: ReadonlyArray<string> | undefined,
  discoveredModels: ReadonlyArray<ServerProviderModel> = [],
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(
    discoveredModels,
    HERMES_DRIVER_KIND,
    customModels ?? [],
    EMPTY_CAPABILITIES,
  );
}

export function buildHermesModelsFromSessionState(
  modelState: EffectAcpSchema.SessionModelState | null | undefined,
): ReadonlyArray<ServerProviderModel> {
  if (!modelState) return [];
  const seen = new Set<string>();
  return modelState.availableModels.flatMap((model) => {
    const slug = model.modelId.trim();
    if (!slug || seen.has(slug)) return [];
    seen.add(slug);
    const separator = slug.indexOf(":");
    const subProvider = separator > 0 ? slug.slice(0, separator) : undefined;
    return [
      {
        slug,
        name: model.name.trim() || slug,
        ...(subProvider ? { subProvider } : {}),
        isCustom: false,
        capabilities: EMPTY_CAPABILITIES,
      } satisfies ServerProviderModel,
    ];
  });
}

export const buildInitialHermesProviderSnapshot = Effect.fn("buildInitialHermesProviderSnapshot")(
  function* (hermesSettings: HermesSettings) {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    const models = modelsFromSettings(hermesSettings.customModels);
    if (!hermesSettings.enabled) {
      return buildServerProvider({
        presentation: HERMES_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Hermes is disabled in T3 Code settings.",
        },
      });
    }
    return buildServerProvider({
      presentation: HERMES_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: `Checking Hermes profile '${hermesSettings.profile}'...`,
      },
    });
  },
);

const runVersionCommand = (settings: HermesSettings, environment: NodeJS.ProcessEnv) =>
  Effect.gen(function* () {
    const command = settings.binaryPath || "hermes";
    const args = ["--profile", settings.profile, "acp", "--version"];
    const spawnCommand = yield* resolveSpawnCommand(command, args, { env: environment });
    return yield* spawnAndCollect(
      command,
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        env: environment,
        extendEnv: true,
        shell: spawnCommand.shell,
      }),
    );
  });

export const checkHermesProviderStatus = Effect.fn("checkHermesProviderStatus")(function* (
  settings: HermesSettings,
  environment: NodeJS.ProcessEnv,
  discoverModels: Effect.Effect<
    EffectAcpSchema.SessionModelState | null | undefined,
    EffectAcpErrors.AcpError
  >,
): Effect.fn.Return<ServerProviderDraft, never, ChildProcessSpawner.ChildProcessSpawner> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const fallbackModels = modelsFromSettings(settings.customModels);
  if (!settings.enabled) {
    return yield* buildInitialHermesProviderSnapshot(settings);
  }

  const versionResult = yield* runVersionCommand(settings, environment).pipe(
    Effect.timeoutOption(VERSION_PROBE_TIMEOUT_MS),
    Effect.result,
  );
  if (Result.isFailure(versionResult)) {
    const error = versionResult.failure;
    return buildServerProvider({
      presentation: HERMES_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: !isCommandMissingCause(error),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(error)
          ? "Hermes Agent (`hermes`) is not installed or not on PATH."
          : "Failed to execute the Hermes Agent health check.",
      },
    });
  }
  if (Option.isNone(versionResult.success)) {
    return buildServerProvider({
      presentation: HERMES_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "Hermes Agent timed out while reporting its ACP version.",
      },
    });
  }

  const versionOutput = versionResult.success.value;
  const version = parseGenericCliVersion(`${versionOutput.stdout}\n${versionOutput.stderr}`);
  if (versionOutput.code !== 0) {
    return buildServerProvider({
      presentation: HERMES_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: "Hermes Agent is installed but its ACP version check failed.",
      },
    });
  }

  const discoveryExit = yield* discoverModels.pipe(
    Effect.timeoutOption(MODEL_DISCOVERY_TIMEOUT_MS),
    Effect.exit,
  );
  if (Exit.isFailure(discoveryExit)) {
    const failure = discoveryExit.cause.reasons.find(Cause.isFailReason)?.error;
    const diagnostic = describeHermesDiscoveryFailure(failure, settings.profile);
    yield* Effect.logWarning("Hermes ACP model discovery failed", {
      errorTag: causeErrorTag(discoveryExit.cause),
      profile: settings.profile,
    });
    return buildServerProvider({
      presentation: HERMES_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: diagnostic.auth,
        message: diagnostic.message,
      },
    });
  }
  if (Option.isNone(discoveryExit.value)) {
    return buildServerProvider({
      presentation: HERMES_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: "Hermes ACP startup timed out while discovering models.",
      },
    });
  }

  const discoveredModels = buildHermesModelsFromSessionState(discoveryExit.value.value);
  return buildServerProvider({
    presentation: HERMES_PRESENTATION,
    enabled: true,
    checkedAt,
    models: modelsFromSettings(settings.customModels, discoveredModels),
    probe: {
      installed: true,
      version,
      status: "ready",
      auth: { status: "authenticated", label: settings.profile },
    },
  });
});
