import { describe, expect, it } from "vite-plus/test";

import { parseCodexMcpToolApproval, toCodexMcpToolApprovalResponse } from "./CodexMcpApproval.ts";

function makeToolApproval(persist?: unknown) {
  return {
    mode: "form" as const,
    message: "Use computer tool preview_open?",
    requestedSchema: {
      type: "object" as const,
      properties: {},
    },
    serverName: "computer-use",
    threadId: "thread-1",
    turnId: "turn-1",
    _meta: {
      codex_approval_kind: "mcp_tool_call",
      ...(persist === undefined ? {} : { persist }),
    },
  };
}

describe("Codex MCP tool approvals", () => {
  it("recognizes tagged empty-form elicitations and advertised session persistence", () => {
    expect(parseCodexMcpToolApproval(makeToolApproval(["session", "always"]))).toEqual({
      supportsSessionPersistence: true,
    });
    expect(parseCodexMcpToolApproval(makeToolApproval("always"))).toEqual({
      supportsSessionPersistence: false,
    });
  });

  it("does not treat structured MCP forms as tool approvals", () => {
    expect(
      parseCodexMcpToolApproval({
        ...makeToolApproval("session"),
        requestedSchema: {
          type: "object",
          properties: {
            answer: { type: "string" },
          },
        },
      }),
    ).toBeNull();
  });

  it("maps approval decisions to Codex elicitation actions", () => {
    const approval = { supportsSessionPersistence: true };

    expect(toCodexMcpToolApprovalResponse("accept", approval)).toEqual({ action: "accept" });
    expect(toCodexMcpToolApprovalResponse("acceptForSession", approval)).toEqual({
      action: "accept",
      _meta: { persist: "session" },
    });
    expect(
      toCodexMcpToolApprovalResponse("acceptForSession", {
        supportsSessionPersistence: false,
      }),
    ).toEqual({ action: "accept" });
    expect(toCodexMcpToolApprovalResponse("decline", approval)).toEqual({ action: "decline" });
    expect(toCodexMcpToolApprovalResponse("cancel", approval)).toEqual({ action: "cancel" });
  });
});
