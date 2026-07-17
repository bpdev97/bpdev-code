import { assert, it } from "@effect/vitest";

import { ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

import {
  getCodexApprovalsReviewerOptionValue,
  getCodexServiceTierOptionValue,
} from "./codexModelOptions.ts";

it("returns the selected Codex service tier id", () => {
  const selection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.5", [
    { id: "serviceTier", value: "flex" },
  ]);

  assert.equal(getCodexServiceTierOptionValue(selection), "flex");
});

it("keeps legacy persisted fast mode selections working", () => {
  const selection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
    { id: "fastMode", value: true },
  ]);

  assert.equal(getCodexServiceTierOptionValue(selection), "fast");
});

it("returns only supported Codex approval reviewers", () => {
  const autoReview = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.5", [
    { id: "approvalsReviewer", value: "auto_review" },
  ]);
  const unsupported = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.5", [
    { id: "approvalsReviewer", value: "guardian_subagent" },
  ]);

  assert.equal(getCodexApprovalsReviewerOptionValue(autoReview), "auto_review");
  assert.equal(getCodexApprovalsReviewerOptionValue(unsupported), undefined);
});
