// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { expect } from "vite-plus/test";

import { HermesSettings, ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { makeHermesAcpUtility } from "./HermesAcpUtility.ts";
import { makeHermesTextGeneration } from "./HermesTextGeneration.ts";

const decodeSettings = Schema.decodeSync(HermesSettings);
const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const mockAgentPath = NodePath.join(__dirname, "../../../scripts/acp-mock-agent.ts");

function makeWrapper(dir: string, requestLogPath: string): string {
  const binaryPath = NodePath.join(dir, "hermes");
  NodeFS.writeFileSync(
    binaryPath,
    [
      "#!/bin/sh",
      `export T3_ACP_REQUEST_LOG_PATH=${JSON.stringify(requestLogPath)}`,
      "export T3_ACP_USE_HERMES_MODES=1",
      `export T3_ACP_PROMPT_RESPONSE_TEXT=${JSON.stringify(JSON.stringify({ title: "Hermes utility title" }))}`,
      'if [ "$1" != "--profile" ] || [ "$2" != "default" ] || [ "$3" != "acp" ]; then exit 12; fi',
      `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(mockAgentPath)} "$@"`,
      "",
    ].join("\n"),
    "utf8",
  );
  NodeFS.chmodSync(binaryPath, 0o755);
  return binaryPath;
}

function readRequests(filePath: string): ReadonlyArray<Record<string, unknown>> {
  return NodeFS.readFileSync(filePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

it.layer(NodeServices.layer)("HermesTextGeneration", (it) => {
  it.effect("reuses one hidden utility session for discovery and serialized generation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3code-hermes-utility-"));
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true })),
        );
        const requestLogPath = NodePath.join(dir, "requests.ndjson");
        const binaryPath = makeWrapper(dir, requestLogPath);
        const utility = yield* makeHermesAcpUtility(
          decodeSettings({ binaryPath, profile: "default" }),
        );
        const models = yield* utility.getModels;
        expect(models?.availableModels.length).toBeGreaterThan(0);
        const textGeneration = yield* makeHermesTextGeneration(utility);
        const modelSelection = createModelSelection(
          ProviderInstanceId.make("hermes"),
          "grok-mock-alt",
        );

        const first = yield* textGeneration.generateThreadTitle({
          cwd: process.cwd(),
          message: "first task",
          modelSelection,
        });
        const second = yield* textGeneration.generateThreadTitle({
          cwd: process.cwd(),
          message: "second task",
          modelSelection,
        });
        expect(first.title).toBe("Hermes utility title");
        expect(second.title).toBe("Hermes utility title");

        const requests = readRequests(requestLogPath);
        expect(requests.filter((request) => request.method === "session/new")).toHaveLength(1);
        expect(
          requests.filter(
            (request) =>
              request.method === "session/prompt" &&
              typeof request.params === "object" &&
              request.params !== null &&
              "prompt" in request.params &&
              JSON.stringify(request.params.prompt).includes("/reset"),
          ).length,
        ).toBeGreaterThanOrEqual(4);
      }),
    ),
  );
});
