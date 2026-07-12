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

  it("keeps one response when a user send spans multiple provider turns", () => {
    const grouping = deriveThreadResponseGrouping({
      entries: [
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
          kind: "work",
          id: "work-2",
          turnId: "turn-2",
          createdAt: "2026-01-01T00:00:03Z",
        },
        {
          kind: "assistant",
          id: "answer-2",
          turnId: "turn-2",
          streaming: false,
          createdAt: "2026-01-01T00:00:05Z",
          updatedAt: "2026-01-01T00:00:06Z",
        },
      ],
      latestTurn: {
        turnId: "turn-2",
        state: "completed",
        startedAt: "2026-01-01T00:00:02Z",
        completedAt: "2026-01-01T00:00:06Z",
      },
    });

    expect([...grouping.terminalAssistantEntryIds]).toEqual(["answer-2"]);
    expect(grouping.responseIdByEntryId.get("commentary-1")).toBe("response:user-1");
    expect(grouping.responseIdByEntryId.get("work-2")).toBe("response:user-1");
    expect(grouping.responseIdByEntryId.get("answer-2")).toBe("response:user-1");
    expect(grouping.responseIdsByTurnId.get("turn-1")).toEqual(["response:user-1"]);
    expect(grouping.responseIdsByTurnId.get("turn-2")).toEqual(["response:user-1"]);
    expect([...grouping.foldsByAnchorEntryId.values()]).toEqual([
      expect.objectContaining({
        responseId: "response:user-1",
        turnId: "turn-2",
        label: "Worked for 6.0s",
      }),
    ]);
  });

  it("keeps a multi-turn response unfolded while its latest turn is active", () => {
    const grouping = deriveThreadResponseGrouping({
      entries: [
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
          id: "answer-2",
          turnId: "turn-2",
          streaming: true,
          createdAt: "2026-01-01T00:00:03Z",
          updatedAt: "2026-01-01T00:00:03Z",
        },
      ],
      latestTurn: {
        turnId: "turn-2",
        state: "running",
        startedAt: "2026-01-01T00:00:02Z",
        completedAt: null,
      },
      runningTurnId: "turn-2",
    });

    expect(grouping.activeResponseId).toBe("response:user-1");
    expect(grouping.foldsByAnchorEntryId.size).toBe(0);
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
