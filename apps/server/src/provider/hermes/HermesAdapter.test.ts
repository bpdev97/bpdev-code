// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import {
  ApprovalRequestId,
  HermesSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { ServerConfig } from "../../config.ts";
import { makeHermesAdapter } from "./HermesAdapter.ts";

const decodeSettings = Schema.decodeSync(HermesSettings);
const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const mockAgentPath = NodePath.join(__dirname, "../../../scripts/acp-mock-agent.ts");

async function makeMockHermesWrapper(
  profile: string,
  extraEnv?: Readonly<Record<string, string>>,
): Promise<string> {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "hermes-acp-mock-"));
  const wrapperPath = NodePath.join(dir, "hermes");
  const env = {
    T3_ACP_USE_HERMES_MODES: "1",
    T3_ACP_ALLOW_ONCE_OPTION_ID: "allow_once",
    T3_ACP_ALLOW_SESSION_OPTION_ID: "allow_session",
    T3_ACP_ALLOW_ALWAYS_OPTION_ID: "allow_always",
    T3_ACP_REJECT_ONCE_OPTION_ID: "deny",
    ...extraEnv,
  };
  const envExports = Object.entries(env)
    .map(([key, value]) => `export ${key}=${JSON.stringify(value)}`)
    .join("\n");
  const script = [
    "#!/bin/sh",
    envExports,
    `if [ "$1" != "--profile" ] || [ "$2" != ${JSON.stringify(profile)} ] || [ "$3" != "acp" ]; then`,
    '  printf "unexpected args: %s\\n" "$*" >&2',
    "  exit 12",
    "fi",
    `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(mockAgentPath)} "$@"`,
    "",
  ].join("\n");
  await NodeFSP.writeFile(wrapperPath, script, "utf8");
  await NodeFSP.chmod(wrapperPath, 0o755);
  return wrapperPath;
}

async function readJsonLines(filePath: string): Promise<Array<Record<string, unknown>>> {
  const raw = await NodeFSP.readFile(filePath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

const testLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3code-hermes-adapter-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

it.layer(testLayer)("HermesAdapter", (it) => {
  it.effect("starts, selects model and mode, streams reasoning, and persists an ACP cursor", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("hermes-main-flow");
      const dir = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "hermes-request-log-")),
      );
      const requestLogPath = NodePath.join(dir, "requests.ndjson");
      const binaryPath = yield* Effect.promise(() =>
        makeMockHermesWrapper("research", {
          T3_ACP_REQUEST_LOG_PATH: requestLogPath,
          T3_ACP_EMIT_AGENT_THOUGHT: "1",
        }),
      );
      const adapter = yield* makeHermesAdapter(
        decodeSettings({ binaryPath, profile: "research" }),
        { instanceId: ProviderInstanceId.make("hermes_research") },
      );
      const events: ProviderRuntimeEvent[] = [];
      const eventFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => events.push(event)),
      ).pipe(Effect.forkChild);

      const session = yield* adapter.startSession({
        threadId,
        provider: ProviderDriverKind.make("hermes"),
        cwd: process.cwd(),
        runtimeMode: "full-access",
        modelSelection: {
          instanceId: ProviderInstanceId.make("hermes_research"),
          model: "grok-mock-alt",
        },
      });
      assert.deepEqual(session.resumeCursor, {
        schemaVersion: 1,
        transport: "acp",
        sessionId: "mock-session-1",
      });
      assert.equal(session.model, "grok-mock-alt");

      yield* adapter.sendTurn({ threadId, input: "hello Hermes", attachments: [] });
      const requests = yield* Effect.promise(() => readJsonLines(requestLogPath));
      assert.isTrue(
        requests.some(
          (entry) =>
            entry.method === "session/set_mode" &&
            typeof entry.params === "object" &&
            entry.params !== null &&
            "modeId" in entry.params &&
            entry.params.modeId === "dont_ask",
        ),
      );
      assert.isTrue(
        requests.some(
          (entry) =>
            entry.method === "session/set_model" &&
            typeof entry.params === "object" &&
            entry.params !== null &&
            "modelId" in entry.params &&
            entry.params.modelId === "grok-mock-alt",
        ),
      );
      assert.isTrue(
        requests.some(
          (entry) =>
            entry.method === "authenticate" &&
            typeof entry.params === "object" &&
            entry.params !== null &&
            "methodId" in entry.params &&
            entry.params.methodId === "mock-provider",
        ),
      );
      assert.isFalse(
        requests.some(
          (entry) =>
            entry.method === "authenticate" &&
            typeof entry.params === "object" &&
            entry.params !== null &&
            "methodId" in entry.params &&
            entry.params.methodId === "hermes-setup",
        ),
      );
      assert.isTrue(
        events.some(
          (event) =>
            event.type === "content.delta" &&
            event.payload.streamKind === "reasoning_text" &&
            event.payload.delta === "mock reasoning",
        ),
      );
      assert.isTrue(events.some((event) => event.type === "turn.completed"));

      yield* Fiber.interrupt(eventFiber);
      yield* adapter.stopSession(threadId);
    }),
  );

  it.effect("loads a persisted Hermes ACP session", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("hermes-resume");
      const dir = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "hermes-resume-log-")),
      );
      const requestLogPath = NodePath.join(dir, "requests.ndjson");
      const binaryPath = yield* Effect.promise(() =>
        makeMockHermesWrapper("default", { T3_ACP_REQUEST_LOG_PATH: requestLogPath }),
      );
      const adapter = yield* makeHermesAdapter(decodeSettings({ binaryPath, profile: "default" }));
      yield* adapter.startSession({
        threadId,
        cwd: process.cwd(),
        runtimeMode: "approval-required",
        resumeCursor: {
          schemaVersion: 1,
          transport: "acp",
          sessionId: "persisted-session",
        },
      });
      const requests = yield* Effect.promise(() => readJsonLines(requestLogPath));
      assert.isTrue(
        requests.some(
          (entry) =>
            entry.method === "session/load" &&
            typeof entry.params === "object" &&
            entry.params !== null &&
            "sessionId" in entry.params &&
            entry.params.sessionId === "persisted-session",
        ),
      );
      yield* adapter.stopSession(threadId);
    }),
  );

  it.effect("keeps assistant item ids unique after resuming the same Hermes session", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("hermes-resume-item-identity");
      const binaryPath = yield* Effect.promise(() => makeMockHermesWrapper("default"));
      const adapter = yield* makeHermesAdapter(decodeSettings({ binaryPath, profile: "default" }));
      const events: ProviderRuntimeEvent[] = [];
      const eventFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => events.push(event)),
      ).pipe(Effect.forkChild);

      const firstSession = yield* adapter.startSession({
        threadId,
        cwd: process.cwd(),
        runtimeMode: "approval-required",
      });
      yield* adapter.sendTurn({ threadId, input: "first prompt", attachments: [] });
      yield* adapter.stopSession(threadId);

      yield* adapter.startSession({
        threadId,
        cwd: process.cwd(),
        runtimeMode: "approval-required",
        resumeCursor: firstSession.resumeCursor,
      });
      yield* adapter.sendTurn({ threadId, input: "second prompt", attachments: [] });

      const assistantDeltas = events.filter(
        (event) => event.type === "content.delta" && event.payload.streamKind === "assistant_text",
      );
      assert.lengthOf(assistantDeltas, 2);
      assert.notEqual(String(assistantDeltas[0]?.itemId), String(assistantDeltas[1]?.itemId));

      yield* Fiber.interrupt(eventFiber);
      yield* adapter.stopSession(threadId);
    }),
  );

  it.effect("delivers follow-up steering while the active Hermes prompt is still running", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("hermes-active-steer");
      const binaryPath = yield* Effect.promise(() =>
        makeMockHermesWrapper("default", {
          T3_ACP_EMIT_MESSAGE_THEN_HANG_UNTIL_STEER: "1",
        }),
      );
      const adapter = yield* makeHermesAdapter(decodeSettings({ binaryPath }));
      const firstDelta =
        yield* Deferred.make<Extract<ProviderRuntimeEvent, { type: "content.delta" }>>();
      const steerDelta =
        yield* Deferred.make<Extract<ProviderRuntimeEvent, { type: "content.delta" }>>();
      const eventFiber = yield* Stream.runForEach(adapter.streamEvents, (event) => {
        if (event.type !== "content.delta") return Effect.void;
        if (event.payload.delta === "waiting for steer") {
          return Deferred.succeed(firstDelta, event).pipe(Effect.ignore);
        }
        if (event.payload.delta === "steer accepted") {
          return Deferred.succeed(steerDelta, event).pipe(Effect.ignore);
        }
        return Effect.void;
      }).pipe(Effect.forkChild);

      yield* adapter.startSession({
        threadId,
        cwd: process.cwd(),
        runtimeMode: "approval-required",
      });
      const firstTurnFiber = yield* adapter
        .sendTurn({ threadId, input: "start a long task", attachments: [] })
        .pipe(Effect.forkChild);
      const initial = yield* Deferred.await(firstDelta).pipe(Effect.timeout("2 seconds"));

      yield* adapter
        .sendTurn({ threadId, input: "change direction", attachments: [] })
        .pipe(Effect.timeout("2 seconds"));
      const steered = yield* Deferred.await(steerDelta).pipe(Effect.timeout("2 seconds"));

      assert.equal(steered.turnId, initial.turnId);
      assert.notEqual(String(steered.itemId), String(initial.itemId));

      yield* adapter.interruptTurn(threadId, initial.turnId);
      yield* Fiber.join(firstTurnFiber).pipe(Effect.timeout("2 seconds"));
      yield* Fiber.interrupt(eventFiber);
      yield* adapter.stopSession(threadId);
    }).pipe(TestClock.withLive),
  );

  it.effect("forwards image attachments as ACP image content", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("hermes-image");
      const serverConfig = yield* ServerConfig;
      const dir = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "hermes-image-log-")),
      );
      const requestLogPath = NodePath.join(dir, "requests.ndjson");
      const binaryPath = yield* Effect.promise(() =>
        makeMockHermesWrapper("default", { T3_ACP_REQUEST_LOG_PATH: requestLogPath }),
      );
      const attachmentId = "hermes-image-123e4567-e89b-12d3-a456-426614174000";
      yield* Effect.promise(() => NodeFSP.mkdir(serverConfig.attachmentsDir, { recursive: true }));
      yield* Effect.promise(() =>
        NodeFSP.writeFile(
          NodePath.join(serverConfig.attachmentsDir, `${attachmentId}.png`),
          Uint8Array.from([1, 2, 3]),
        ),
      );
      const adapter = yield* makeHermesAdapter(decodeSettings({ binaryPath }));
      yield* adapter.startSession({
        threadId,
        cwd: process.cwd(),
        runtimeMode: "approval-required",
      });
      yield* adapter.sendTurn({
        threadId,
        attachments: [
          {
            type: "image",
            id: attachmentId,
            name: "test.png",
            mimeType: "image/png",
            sizeBytes: 3,
          },
        ],
      });

      const requests = yield* Effect.promise(() => readJsonLines(requestLogPath));
      const promptRequest = requests.find((entry) => entry.method === "session/prompt");
      const params = promptRequest?.params;
      const prompt =
        typeof params === "object" && params !== null && "prompt" in params
          ? params.prompt
          : undefined;
      assert.isArray(prompt);
      assert.deepInclude(prompt, {
        type: "image",
        mimeType: "image/png",
        data: "AQID",
      });
      yield* adapter.stopSession(threadId);
    }),
  );

  it.effect("answers session approval with allow_session rather than allow_always", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("hermes-session-approval");
      const dir = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "hermes-approval-log-")),
      );
      const requestLogPath = NodePath.join(dir, "requests.ndjson");
      const binaryPath = yield* Effect.promise(() =>
        makeMockHermesWrapper("default", {
          T3_ACP_REQUEST_LOG_PATH: requestLogPath,
          T3_ACP_EMIT_TOOL_CALLS: "1",
        }),
      );
      const adapter = yield* makeHermesAdapter(decodeSettings({ binaryPath }));
      const opened =
        yield* Deferred.make<Extract<ProviderRuntimeEvent, { type: "request.opened" }>>();
      const eventFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        event.type === "request.opened"
          ? Deferred.succeed(opened, event).pipe(Effect.ignore)
          : Effect.void,
      ).pipe(Effect.forkChild);
      yield* adapter.startSession({
        threadId,
        cwd: process.cwd(),
        runtimeMode: "approval-required",
      });
      const turnFiber = yield* adapter
        .sendTurn({ threadId, input: "run the tool", attachments: [] })
        .pipe(Effect.forkChild);
      const request = yield* Deferred.await(opened);
      yield* adapter.respondToRequest(
        threadId,
        ApprovalRequestId.make(String(request.requestId)),
        "acceptForSession",
      );
      yield* Fiber.join(turnFiber);

      const requests = yield* Effect.promise(() => readJsonLines(requestLogPath));
      assert.isTrue(
        requests.some((entry) => {
          if ("method" in entry || typeof entry.result !== "object" || entry.result === null) {
            return false;
          }
          if (!("outcome" in entry.result)) return false;
          const outcome = entry.result.outcome;
          return (
            typeof outcome === "object" &&
            outcome !== null &&
            "optionId" in outcome &&
            outcome.optionId === "allow_session"
          );
        }),
      );
      yield* Fiber.interrupt(eventFiber);
      yield* adapter.stopSession(threadId);
    }),
  );

  it.effect("cancels an active turn once and drops late ACP output", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("hermes-cancel");
      const binaryPath = yield* Effect.promise(() =>
        makeMockHermesWrapper("default", {
          T3_ACP_HANG_PROMPT_FOREVER: "1",
          T3_ACP_EMIT_LATE_UPDATE_AFTER_CANCEL: "1",
        }),
      );
      const adapter = yield* makeHermesAdapter(decodeSettings({ binaryPath }));
      const events: ProviderRuntimeEvent[] = [];
      const started = yield* Deferred.make<TurnId>();
      const eventFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => events.push(event)).pipe(
          Effect.andThen(
            event.type === "turn.started" && event.turnId !== undefined
              ? Deferred.succeed(started, event.turnId).pipe(Effect.ignore)
              : Effect.void,
          ),
        ),
      ).pipe(Effect.forkChild);
      yield* adapter.startSession({
        threadId,
        cwd: process.cwd(),
        runtimeMode: "approval-required",
      });
      const turnFiber = yield* adapter
        .sendTurn({ threadId, input: "wait forever", attachments: [] })
        .pipe(Effect.forkChild);
      const turnId = yield* Deferred.await(started);
      yield* adapter.interruptTurn(threadId, turnId);
      yield* Fiber.join(turnFiber);
      yield* Effect.sleep("100 millis");

      const completions = events.filter(
        (event) => event.type === "turn.completed" && event.turnId === turnId,
      );
      assert.lengthOf(completions, 1);
      assert.isTrue(
        completions[0]?.type === "turn.completed" && completions[0].payload.state === "cancelled",
      );
      assert.isFalse(
        events.some(
          (event) => event.type === "content.delta" && event.payload.delta === "late after cancel",
        ),
      );
      yield* Fiber.interrupt(eventFiber);
      yield* adapter.stopSession(threadId);
    }).pipe(TestClock.withLive),
  );

  it.effect("closes only the stopped Hermes session process", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("hermes-stop");
      const dir = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "hermes-exit-log-")),
      );
      const exitLogPath = NodePath.join(dir, "exit.log");
      const binaryPath = yield* Effect.promise(() =>
        makeMockHermesWrapper("personal", { T3_ACP_EXIT_LOG_PATH: exitLogPath }),
      );
      const adapter = yield* makeHermesAdapter(decodeSettings({ binaryPath, profile: "personal" }));
      yield* adapter.startSession({
        threadId,
        cwd: process.cwd(),
        runtimeMode: "approval-required",
      });
      yield* adapter.stopSession(threadId);
      const exitLog = yield* Effect.promise(() => NodeFSP.readFile(exitLogPath, "utf8"));
      assert.include(exitLog, "SIGTERM");
    }),
  );
});
