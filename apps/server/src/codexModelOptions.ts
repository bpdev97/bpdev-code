import type { ModelSelection } from "@t3tools/contracts";
import {
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
} from "@t3tools/shared/model";

export function getCodexServiceTierOptionValue(
  modelSelection: ModelSelection | null | undefined,
): string | undefined {
  return (
    getModelSelectionStringOptionValue(modelSelection, "serviceTier") ??
    (getModelSelectionBooleanOptionValue(modelSelection, "fastMode") === true ? "fast" : undefined)
  );
}

export function getCodexApprovalsReviewerOptionValue(
  modelSelection: ModelSelection | null | undefined,
): "user" | "auto_review" | undefined {
  const value = getModelSelectionStringOptionValue(modelSelection, "approvalsReviewer");
  return value === "user" || value === "auto_review" ? value : undefined;
}
