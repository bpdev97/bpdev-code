/**
 * Optional end-to-end check against a real local Hermes ACP install.
 * Enable with: T3_HERMES_ACP_PROBE=1 vp test HermesAcpCliProbe
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import {
  HermesSettings,
  ProviderDriverKind,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { describe, expect } from "vite-plus/test";

import { ServerConfig } from "../../config.ts";
import { makeHermesAdapter } from "./HermesAdapter.ts";

const decodeSettings = Schema.decodeSync(HermesSettings);
const testLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3code-hermes-real-probe-",
}).pipe(Layer.provideMerge(NodeServices.layer));

describe.runIf(process.env.T3_HERMES_ACP_PROBE === "1")("Hermes ACP CLI probe", () => {
  it.effect("streams live reasoning and a completed answer through the T3 adapter", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("hermes-real-acp-probe");
      const adapter = yield* makeHermesAdapter(
        decodeSettings({
          binaryPath: process.env.T3_HERMES_BINARY_PATH ?? "hermes",
          profile: process.env.T3_HERMES_PROFILE ?? "default",
        }),
      );
      yield* Effect.addFinalizer(() => adapter.stopSession(threadId).pipe(Effect.ignore));

      const events: ProviderRuntimeEvent[] = [];
      yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => events.push(event)),
      ).pipe(Effect.forkScoped);

      yield* adapter.startSession({
        threadId,
        provider: ProviderDriverKind.make("hermes"),
        cwd: process.cwd(),
        runtimeMode: "full-access",
      });
      yield* adapter
        .sendTurn({
          threadId,
          input:
            "Use only read-only tools to inspect package.json. Do not modify any files. Determine the package manager and list the workspace globs, explaining your approach as you work.",
          attachments: [],
        })
        .pipe(Effect.timeout("3 minutes"));

      const assistantText = events
        .filter(
          (event) =>
            event.type === "content.delta" && event.payload.streamKind === "assistant_text",
        )
        .map((event) => (event.type === "content.delta" ? event.payload.delta : ""))
        .join("");
      const reasoningText = events
        .filter(
          (event) =>
            event.type === "content.delta" && event.payload.streamKind === "reasoning_text",
        )
        .map((event) => (event.type === "content.delta" ? event.payload.delta : ""))
        .join("");

      expect(reasoningText.trim().length).toBeGreaterThan(0);
      expect(assistantText).toMatch(/packageManager|package manager|workspace/i);
      expect(
        events.some(
          (event) =>
            (event.type === "item.updated" || event.type === "item.completed") &&
            event.payload.itemType !== "assistant_message",
        ),
      ).toBe(true);
      expect(
        events.some(
          (event) => event.type === "turn.completed" && event.payload.state === "completed",
        ),
      ).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );
});
