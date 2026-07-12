import { describe, expect, it } from "vite-plus/test";

import {
  deriveThreadResponseGrouping,
  type ThreadResponseGroupingEntry,
} from "./threadResponseGrouping.ts";

describe("deriveThreadResponseGrouping", () => {
  it("keeps separate terminal answers when a follow-up stays in the same provider turn", () => {
    const entries: ThreadResponseGroupingEntry[] = [
      { kind: "user", id: "user-1", createdAt: "2026-01-01T00:00:00Z" },
      {
        kind: "assistant",
        id: "commentary-1",
        turnId: "turn-1",
        streaming: false,
        createdAt: "2026-01-01T00:00:01Z",
        updatedAt: "2026-01-01T00:00:01Z",
      },
      {
        kind: "assistant",
        id: "answer-1",
        turnId: "turn-1",
        streaming: false,
        createdAt: "2026-01-01T00:00:02Z",
        updatedAt: "2026-01-01T00:00:03Z",
      },
      { kind: "user", id: "user-2", createdAt: "2026-01-01T00:00:04Z" },
      {
        kind: "assistant",
        id: "commentary-2",
        turnId: "turn-1",
        streaming: false,
        createdAt: "2026-01-01T00:00:05Z",
        updatedAt: "2026-01-01T00:00:05Z",
      },
      {
        kind: "assistant",
        id: "answer-2",
        turnId: "turn-1",
        streaming: false,
        createdAt: "2026-01-01T00:00:06Z",
        updatedAt: "2026-01-01T00:00:07Z",
      },
    ];

    const grouping = deriveThreadResponseGrouping({
      entries,
      latestTurn: {
        turnId: "turn-1",
        state: "completed",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: "2026-01-01T00:00:07Z",
      },
    });

    expect([...grouping.terminalAssistantEntryIds]).toEqual(["answer-1", "answer-2"]);
    expect([...grouping.foldsByAnchorEntryId.values()]).toHaveLength(2);
    expect(grouping.responseIdsByTurnId.get("turn-1")).toHaveLength(2);
  });

  it("folds prior work after a steer while leaving the current response unsettled", () => {
    const grouping = deriveThreadResponseGrouping({
      entries: [
        { kind: "user", id: "user-1", createdAt: "2026-01-01T00:00:00Z" },
        {
          kind: "work",
          id: "work-1",
          turnId: "turn-1",
          createdAt: "2026-01-01T00:00:01Z",
        },
        { kind: "user", id: "user-2", createdAt: "2026-01-01T00:00:02Z" },
        {
          kind: "assistant",
          id: "answer-2",
          turnId: "turn-1",
          streaming: true,
          createdAt: "2026-01-01T00:00:03Z",
          updatedAt: "2026-01-01T00:00:03Z",
        },
      ],
      latestTurn: {
        turnId: "turn-1",
        state: "running",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: null,
      },
      runningTurnId: "turn-1",
    });

    expect([...grouping.foldsByAnchorEntryId.keys()]).toEqual(["work-1"]);
    expect(grouping.foldsByAnchorEntryId.has("answer-2")).toBe(false);
  });
});
