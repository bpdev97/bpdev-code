import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as EffectAcpErrors from "effect-acp/errors";

import { HermesSettings } from "@t3tools/contracts";
import {
  buildHermesModelsFromSessionState,
  buildInitialHermesProviderSnapshot,
  checkHermesProviderStatus,
  describeHermesDiscoveryFailure,
} from "./HermesProvider.ts";

const decodeSettings = Schema.decodeSync(HermesSettings);

describe("Hermes provider snapshot", () => {
  it.effect("starts pending and exposes only configured fallback models", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialHermesProviderSnapshot(
        decodeSettings({ profile: "research", customModels: ["custom:model"] }),
      );
      expect(snapshot.status).toBe("warning");
      expect(snapshot.badgeLabel).toBe("Early Access");
      expect(snapshot.showInteractionModeToggle).toBe(false);
      expect(snapshot.requiresNewThreadForModelChange).toBe(false);
      expect(snapshot.models.map((model) => model.slug)).toEqual(["custom:model"]);
      expect(snapshot.message).toContain("research");
    }),
  );

  it("deduplicates model ids and retains provider labels", () => {
    expect(
      buildHermesModelsFromSessionState({
        currentModelId: "openrouter:model-a",
        availableModels: [
          { modelId: "openrouter:model-a", name: "Model A" },
          { modelId: "openrouter:model-a", name: "Duplicate" },
          { modelId: "nous:model-b", name: "Model B" },
        ],
      }),
    ).toMatchObject([
      { slug: "openrouter:model-a", name: "Model A", subProvider: "openrouter" },
      { slug: "nous:model-b", name: "Model B", subProvider: "nous" },
    ]);
  });

  it("distinguishes setup from protocol failures without exposing raw errors", () => {
    expect(
      describeHermesDiscoveryFailure(
        new EffectAcpErrors.AcpTransportError({
          operation: "call-rpc",
          method: "authenticate",
          detail: "private detail",
          cause: undefined,
        }),
        "research",
      ),
    ).toEqual({
      auth: { status: "unauthenticated" },
      message:
        "Hermes profile 'research' is not ready. Configure it with `hermes --profile research model`, then refresh provider status.",
    });
    expect(
      describeHermesDiscoveryFailure(
        new EffectAcpErrors.AcpProtocolParseError({
          operation: "decode-wire-message",
          cause: "private protocol payload",
        }),
        "research",
      ),
    ).toEqual({
      auth: { status: "unknown" },
      message:
        "Hermes Agent returned an incompatible ACP response. Update Hermes or check the fork compatibility record.",
    });
  });
});

it.layer(NodeServices.layer)("checkHermesProviderStatus", (it) => {
  it.effect("reports a missing binary without attempting ACP discovery", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkHermesProviderStatus(
        decodeSettings({ binaryPath: "/definitely/missing/hermes", profile: "default" }),
        process.env,
        Effect.die("model discovery must not run"),
      );
      expect(snapshot.installed).toBe(false);
      expect(snapshot.status).toBe("error");
      expect(snapshot.message).toContain("not installed");
    }),
  );

  it.effect("uses profile-aware version args and publishes discovered models", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-hermes-provider-" });
        const argsPath = path.join(dir, "args.txt");
        const binaryPath = path.join(dir, "hermes");
        const quotedArgsPath = `'${argsPath.replaceAll("'", `'"'"'`)}'`;
        yield* fs.writeFileString(
          binaryPath,
          [
            "#!/bin/sh",
            `printf '%s\\n' "$*" > ${quotedArgsPath}`,
            "echo 'Hermes Agent 0.18.2'",
            "exit 0",
            "",
          ].join("\n"),
        );
        yield* fs.chmod(binaryPath, 0o755);

        const snapshot = yield* checkHermesProviderStatus(
          decodeSettings({
            binaryPath,
            profile: "research",
            customModels: ["custom:model"],
          }),
          process.env,
          Effect.succeed({
            currentModelId: "openrouter:model-a",
            availableModels: [{ modelId: "openrouter:model-a", name: "Model A" }],
          }),
        );
        expect(yield* fs.readFileString(argsPath)).toContain("--profile research acp --version");
        expect(snapshot.status).toBe("ready");
        expect(snapshot.version).toBe("0.18.2");
        expect(snapshot.auth).toEqual({ status: "authenticated", label: "research" });
        expect(snapshot.models.map((model) => model.slug)).toEqual([
          "openrouter:model-a",
          "custom:model",
        ]);
      }),
    ),
  );
});
