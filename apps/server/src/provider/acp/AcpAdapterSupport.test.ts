import { describe, expect, it } from "vite-plus/test";
import * as EffectAcpErrors from "effect-acp/errors";
import { ProviderDriverKind, ThreadId } from "@t3tools/contracts";

import { acpPermissionOptionId, mapAcpToAdapterError } from "./AcpAdapterSupport.ts";

const THREAD_ID = ThreadId.make("thread-1");

describe("AcpAdapterSupport", () => {
  it("maps ACP approval decisions to advertised option ids", () => {
    const options = [
      { optionId: "permit-once-custom", name: "Allow once", kind: "allow_once" as const },
      { optionId: "permit-session-custom", name: "Allow always", kind: "allow_always" as const },
      { optionId: "reject-custom", name: "Reject", kind: "reject_once" as const },
    ];
    expect(acpPermissionOptionId("accept", options)).toBe("permit-once-custom");
    expect(acpPermissionOptionId("acceptForSession", options)).toBe("permit-session-custom");
    expect(acpPermissionOptionId("decline", options)).toBe("reject-custom");
    expect(acpPermissionOptionId("acceptForSession", options.slice(0, 1))).toBe(
      "permit-once-custom",
    );
  });

  it("maps ACP request errors to provider adapter request errors", () => {
    const error = mapAcpToAdapterError(
      ProviderDriverKind.make("cursor"),
      THREAD_ID,
      "session/prompt",
      new EffectAcpErrors.AcpRequestError({
        code: -32602,
        errorMessage: "Invalid params",
      }),
    );

    expect(error._tag).toBe("ProviderAdapterRequestError");
    expect(error.message).toContain("Invalid params");
  });

  it("includes non-empty ACP error data details in provider request errors", () => {
    const error = mapAcpToAdapterError(
      ProviderDriverKind.make("hermes"),
      THREAD_ID,
      "session/set_model",
      new EffectAcpErrors.AcpRequestError({
        code: -32603,
        errorMessage: "Internal error",
        data: {
          details: "No LLM provider configured.",
        },
      }),
    );

    expect(error._tag).toBe("ProviderAdapterRequestError");
    expect(error.message).toContain("Internal error: No LLM provider configured.");
  });

  it("does not render arbitrary ACP error data", () => {
    const error = mapAcpToAdapterError(
      ProviderDriverKind.make("hermes"),
      THREAD_ID,
      "session/set_model",
      new EffectAcpErrors.AcpRequestError({
        code: -32603,
        errorMessage: "Internal error",
        data: {
          token: "provider-secret",
        },
      }),
    );

    expect(error.message).toContain("Internal error");
    expect(error.message).not.toContain("provider-secret");
  });
});
