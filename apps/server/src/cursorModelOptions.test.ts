import { ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { describe, expect, it } from "vite-plus/test";

import { getCursorApprovalsReviewerOptionValue } from "./cursorModelOptions.ts";

describe("getCursorApprovalsReviewerOptionValue", () => {
  const selection = (value: string) =>
    createModelSelection(ProviderInstanceId.make("cursor"), "default", [
      { id: "approvalsReviewer", value },
    ]);

  it("accepts supported reviewer values", () => {
    expect(getCursorApprovalsReviewerOptionValue(selection("user"))).toBe("user");
    expect(getCursorApprovalsReviewerOptionValue(selection("auto_review"))).toBe("auto_review");
  });

  it("ignores missing or unsupported reviewer values", () => {
    expect(getCursorApprovalsReviewerOptionValue(selection("unknown"))).toBeUndefined();
    expect(getCursorApprovalsReviewerOptionValue(undefined)).toBeUndefined();
  });
});
