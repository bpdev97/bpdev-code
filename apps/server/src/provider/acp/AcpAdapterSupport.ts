import {
  type ProviderApprovalDecision,
  type ProviderDriverKind,
  type ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  type ProviderAdapterError,
} from "../Errors.ts";
const isAcpProcessExitedError = Schema.is(EffectAcpErrors.AcpProcessExitedError);
const isAcpRequestError = Schema.is(EffectAcpErrors.AcpRequestError);

function acpRequestErrorDetail(error: EffectAcpErrors.AcpRequestError): string {
  const details =
    error.data !== null &&
    typeof error.data === "object" &&
    "details" in error.data &&
    typeof error.data.details === "string"
      ? error.data.details.trim()
      : "";
  if (details.length === 0 || details === error.message) {
    return error.message;
  }
  return `${error.message}: ${details}`;
}

export function mapAcpToAdapterError(
  provider: ProviderDriverKind,
  threadId: ThreadId,
  method: string,
  error: EffectAcpErrors.AcpError,
): ProviderAdapterError {
  if (isAcpProcessExitedError(error)) {
    return new ProviderAdapterSessionClosedError({
      provider,
      threadId,
      cause: error,
    });
  }
  if (isAcpRequestError(error)) {
    return new ProviderAdapterRequestError({
      provider,
      method,
      detail: acpRequestErrorDetail(error),
      cause: error,
    });
  }
  return new ProviderAdapterRequestError({
    provider,
    method,
    detail: error.message,
    cause: error,
  });
}

export function acpPermissionOptionId(
  decision: ProviderApprovalDecision,
  options: ReadonlyArray<EffectAcpSchema.PermissionOption>,
): string | undefined {
  const preferredKinds: ReadonlyArray<EffectAcpSchema.PermissionOptionKind> =
    decision === "acceptForSession"
      ? ["allow_always", "allow_once"]
      : decision === "accept"
        ? ["allow_once", "allow_always"]
        : ["reject_once", "reject_always"];

  for (const kind of preferredKinds) {
    const option = options.find((candidate) => candidate.kind === kind);
    if (option?.optionId.trim()) {
      return option.optionId.trim();
    }
  }
  return undefined;
}
