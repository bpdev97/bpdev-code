import { describe, expect, it } from "vite-plus/test";
import { TurnId } from "@t3tools/contracts";

import type { ThreadFeedActivity, ThreadFeedEntry } from "../../lib/threadActivity";
import { resolveThreadFeedFixedItemSize } from "./threadFeedLayout";

function activity(id: string, toolLike = true): ThreadFeedActivity {
  return {
    id,
    createdAt: "2026-07-17T00:00:00.000Z",
    turnId: null,
    summary: id,
    detail: null,
    fullDetail: null,
    copyText: id,
    icon: "command",
    toolLike,
    status: "success",
  };
}

function activityGroup(activities: ReadonlyArray<ThreadFeedActivity>): ThreadFeedEntry {
  return {
    type: "activity-group",
    id: "activity-group",
    createdAt: "2026-07-17T00:00:00.000Z",
    turnId: null,
    activities,
  };
}

describe("resolveThreadFeedFixedItemSize", () => {
  it("provides exact sizes for compact collapsed tool rows", () => {
    expect(resolveThreadFeedFixedItemSize(activityGroup([activity("one")]), {}, 1)).toBe(48);
    expect(
      resolveThreadFeedFixedItemSize(
        activityGroup([activity("one"), activity("two"), activity("three")]),
        {},
        1,
      ),
    ).toBe(138);
  });

  it("leaves expanded and non-tool work rows measurable", () => {
    expect(
      resolveThreadFeedFixedItemSize(activityGroup([activity("expanded")]), { expanded: true }, 1),
    ).toBeUndefined();
    expect(
      resolveThreadFeedFixedItemSize(activityGroup([activity("status", false)]), {}, 1),
    ).toBeUndefined();
  });

  it("leaves rows measurable when accessibility text can exceed the nominal height", () => {
    expect(
      resolveThreadFeedFixedItemSize(activityGroup([activity("large-text")]), {}, 2),
    ).toBeUndefined();
  });

  it("provides exact sizes for compact disclosure controls", () => {
    expect(
      resolveThreadFeedFixedItemSize(
        {
          type: "work-toggle",
          id: "work-toggle:group",
          createdAt: "2026-07-17T00:00:00.000Z",
          turnId: null,
          groupId: "group",
          hiddenCount: 4,
          expanded: false,
          onlyToolActivities: true,
        },
        {},
        1,
      ),
    ).toBe(48);
    expect(
      resolveThreadFeedFixedItemSize(
        {
          type: "turn-fold",
          id: "turn-fold:response",
          createdAt: "2026-07-17T00:00:00.000Z",
          responseId: "response",
          turnId: TurnId.make("turn"),
          label: "Worked for 5s",
          expanded: false,
        },
        {},
        1,
      ),
    ).toBe(56);
  });
});
