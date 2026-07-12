import { describe, expect, it } from "vite-plus/test";
import * as EffectAcpErrors from "effect-acp/errors";
import { ProviderDriverKind, ThreadId } from "@t3tools/contracts";

import { acpPermissionOutcome, mapAcpToAdapterError } from "./AcpAdapterSupport.ts";

const THREAD_ID = ThreadId.make("thread-1");

describe("AcpAdapterSupport", () => {
  it("maps ACP approval decisions to permission outcomes", () => {
    expect(acpPermissionOutcome("accept")).toBe("allow-once");
    expect(acpPermissionOutcome("acceptForSession")).toBe("allow-always");
    expect(acpPermissionOutcome("decline")).toBe("reject-once");
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
