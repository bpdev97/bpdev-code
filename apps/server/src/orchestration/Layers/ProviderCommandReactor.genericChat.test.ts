import { ProjectId } from "@t3tools/contracts";
import { GENERIC_CHAT_PROJECT_ID, GENERIC_CHAT_RUNTIME_MODE } from "@t3tools/shared/genericChat";
import { describe, expect, it } from "vite-plus/test";

import {
  prepareProviderMessageInput,
  resolveProviderRuntimeMode,
  resolveProviderSessionCwd,
} from "./ProviderCommandReactor.ts";

describe("generic chat provider context", () => {
  it("wraps generic chat messages with the no-filesystem host context", () => {
    const input = prepareProviderMessageInput(GENERIC_CHAT_PROJECT_ID, "What is a monad?");

    expect(input).toContain("Do not inspect, enumerate, search, read, or modify local files");
    expect(input).toContain("<user_message>\nWhat is a monad?\n</user_message>");
  });

  it("leaves project-bound messages unchanged", () => {
    expect(prepareProviderMessageInput(ProjectId.make("project-1"), "  Inspect this repo.  ")).toBe(
      "Inspect this repo.",
    );
  });

  it("forces generic chats into the safest existing runtime mode", () => {
    expect(resolveProviderRuntimeMode(GENERIC_CHAT_PROJECT_ID, "full-access")).toBe(
      GENERIC_CHAT_RUNTIME_MODE,
    );
    expect(resolveProviderRuntimeMode(ProjectId.make("project-1"), "full-access")).toBe(
      "full-access",
    );
  });

  it("pins generic sessions to the managed scratch root instead of a thread worktree", () => {
    expect(
      resolveProviderSessionCwd(
        GENERIC_CHAT_PROJECT_ID,
        "/state/workspaces/generic-chat",
        "/user/project/worktree",
      ),
    ).toBe("/state/workspaces/generic-chat");
    expect(
      resolveProviderSessionCwd(
        ProjectId.make("project-1"),
        "/user/project",
        "/user/project/worktree",
      ),
    ).toBe("/user/project/worktree");
  });
});
