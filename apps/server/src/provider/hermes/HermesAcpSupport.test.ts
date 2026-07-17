import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  applyHermesAcpModelSelection,
  applyHermesRuntimeMode,
  buildHermesAcpSpawnInput,
  hermesModeForRuntimeMode,
  parseHermesAcpConversationCursor,
  resolveHermesAuthMethodId,
  selectHermesAutoApprovalOptionId,
  selectHermesPermissionOptionId,
} from "./HermesAcpSupport.ts";

function permissionRequest(
  options: EffectAcpSchema.RequestPermissionRequest["options"],
): EffectAcpSchema.RequestPermissionRequest {
  return {
    sessionId: "session-1",
    toolCall: {
      toolCallId: "permission-1",
      title: "Run command",
      kind: "execute",
      status: "pending",
    },
    options,
  };
}

describe("Hermes ACP spawn and cursor", () => {
  it("always passes the configured profile explicitly", () => {
    expect(
      buildHermesAcpSpawnInput(
        { binaryPath: "/opt/hermes", profile: "research" },
        "/work/project",
        { HERMES_HOME: "/ignored/sticky/home" },
      ),
    ).toEqual({
      command: "/opt/hermes",
      args: ["--profile", "research", "acp"],
      cwd: "/work/project",
      env: { HERMES_HOME: "/ignored/sticky/home" },
    });
  });

  it("selects configured credentials and never terminal setup", () => {
    expect(
      resolveHermesAuthMethodId({
        protocolVersion: 1,
        agentCapabilities: {},
        authMethods: [
          { type: "terminal", id: "hermes-setup", name: "Setup", args: ["--setup"] },
          { id: "openrouter", name: "OpenRouter credentials" },
        ],
      }),
    ).toBe("openrouter");
    expect(
      resolveHermesAuthMethodId({
        protocolVersion: 1,
        agentCapabilities: {},
        authMethods: [{ type: "terminal", id: "hermes-setup", name: "Setup", args: ["--setup"] }],
      }),
    ).toBeUndefined();
  });

  it("accepts only versioned ACP cursors", () => {
    expect(
      parseHermesAcpConversationCursor({
        schemaVersion: 1,
        transport: "acp",
        sessionId: " session-7 ",
      }),
    ).toEqual({ schemaVersion: 1, transport: "acp", sessionId: "session-7" });
    expect(
      parseHermesAcpConversationCursor({ schemaVersion: 1, sessionId: "legacy" }),
    ).toBeUndefined();
    expect(
      parseHermesAcpConversationCursor({
        schemaVersion: 1,
        transport: "gateway",
        sessionId: "gateway-1",
      }),
    ).toBeUndefined();
  });
});

describe("Hermes runtime modes", () => {
  it("maps T3 runtime modes to Hermes approval modes", () => {
    expect(hermesModeForRuntimeMode("approval-required")).toBe("default");
    expect(hermesModeForRuntimeMode("auto-accept-edits")).toBe("accept_edits");
    expect(hermesModeForRuntimeMode("full-access")).toBe("dont_ask");
  });

  it.effect("uses session/set_mode and skips an already-active mode", () =>
    Effect.gen(function* () {
      const calls: Array<{ method: string; payload: unknown }> = [];
      const runtime = {
        request: (method: string, payload: unknown) =>
          Effect.sync(() => {
            calls.push({ method, payload });
            return {};
          }),
      };
      yield* applyHermesRuntimeMode({
        runtime,
        sessionId: "session-1",
        runtimeMode: "full-access",
        currentModeId: "default",
        mapError: (cause) => cause,
      });
      yield* applyHermesRuntimeMode({
        runtime,
        sessionId: "session-1",
        runtimeMode: "full-access",
        currentModeId: "dont_ask",
        mapError: (cause) => cause,
      });
      expect(calls).toEqual([
        {
          method: "session/set_mode",
          payload: { sessionId: "session-1", modeId: "dont_ask" },
        },
      ]);
    }),
  );
});

describe("Hermes permission selection", () => {
  const request = permissionRequest([
    { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
    { optionId: "allow_session", name: "Allow for session", kind: "allow_always" },
    { optionId: "allow_always", name: "Allow always", kind: "allow_always" },
    { optionId: "deny", name: "Deny", kind: "reject_once" },
  ]);

  it("selects stable Hermes option ids instead of ambiguous kinds", () => {
    expect(selectHermesPermissionOptionId(request, "accept")).toBe("allow_once");
    expect(selectHermesPermissionOptionId(request, "acceptForSession")).toBe("allow_session");
    expect(selectHermesPermissionOptionId(request, "decline")).toBe("deny");
    expect(selectHermesPermissionOptionId(request, "cancel")).toBeUndefined();
    expect(selectHermesAutoApprovalOptionId(request)).toBe("allow_session");
  });

  it("falls back to one-time approval, never permanent approval", () => {
    const withoutSession = permissionRequest([
      { optionId: "once-custom", name: "Allow once", kind: "allow_once" },
      { optionId: "allow_always", name: "Allow always", kind: "allow_always" },
      { optionId: "deny", name: "Deny", kind: "reject_once" },
    ]);
    expect(selectHermesPermissionOptionId(withoutSession, "acceptForSession")).toBe("once-custom");
    expect(selectHermesAutoApprovalOptionId(withoutSession)).toBe("once-custom");
  });
});

describe("Hermes model selection", () => {
  it.effect("switches only when the requested model differs", () =>
    Effect.gen(function* () {
      const calls: Array<string> = [];
      const runtime = {
        setSessionModel: (modelId: string) =>
          Effect.sync(() => {
            calls.push(modelId);
            return {};
          }),
      };
      expect(
        yield* applyHermesAcpModelSelection({
          runtime,
          currentModelId: "openrouter:model-a",
          requestedModelId: "openrouter:model-b",
          mapError: (cause) => cause,
        }),
      ).toBe("openrouter:model-b");
      expect(
        yield* applyHermesAcpModelSelection({
          runtime,
          currentModelId: "openrouter:model-b",
          requestedModelId: "openrouter:model-b",
          mapError: (cause) => cause,
        }),
      ).toBe("openrouter:model-b");
      expect(calls).toEqual(["openrouter:model-b"]);
    }),
  );
});
