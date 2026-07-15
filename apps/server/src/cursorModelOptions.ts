import type { ModelSelection, ProviderOptionDescriptor } from "@t3tools/contracts";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";

export const CURSOR_APPROVAL_REVIEWER_OPTION: ProviderOptionDescriptor = {
  id: "approvalsReviewer",
  label: "Approval reviewer",
  description: "Choose whether you or Cursor reviews tool calls before they run.",
  type: "select",
  options: [
    {
      id: "user",
      label: "Ask me",
      isDefault: true,
    },
    {
      id: "auto_review",
      label: "Auto-review",
    },
  ],
  currentValue: "user",
};

export function getCursorApprovalsReviewerOptionValue(
  modelSelection: ModelSelection | null | undefined,
): "user" | "auto_review" | undefined {
  const value = getModelSelectionStringOptionValue(modelSelection, "approvalsReviewer");
  return value === "user" || value === "auto_review" ? value : undefined;
}
