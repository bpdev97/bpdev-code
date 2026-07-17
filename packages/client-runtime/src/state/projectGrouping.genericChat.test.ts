import { EnvironmentId } from "@t3tools/contracts";
import {
  GENERIC_CHAT_LOGICAL_PROJECT_KEY,
  GENERIC_CHAT_PROJECT_ID,
} from "@t3tools/shared/genericChat";
import { describe, expect, it } from "vite-plus/test";

import { deriveLogicalProjectKey } from "./projectGrouping.ts";

describe("generic chat project grouping", () => {
  it("uses one logical key across environments and grouping preferences", () => {
    const project = {
      id: GENERIC_CHAT_PROJECT_ID,
      environmentId: EnvironmentId.make("local"),
      workspaceRoot: "/state/local/workspaces/generic-chat",
      repositoryIdentity: null,
    };

    expect(deriveLogicalProjectKey(project, { groupingMode: "separate" })).toBe(
      GENERIC_CHAT_LOGICAL_PROJECT_KEY,
    );
    expect(
      deriveLogicalProjectKey(
        {
          ...project,
          environmentId: EnvironmentId.make("remote"),
          workspaceRoot: "/state/remote/workspaces/generic-chat",
        },
        { groupingMode: "repository_path" },
      ),
    ).toBe(GENERIC_CHAT_LOGICAL_PROJECT_KEY);
  });
});
