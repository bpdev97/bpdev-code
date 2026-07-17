import type { ToolLifecycleItemType } from "@t3tools/contracts";

export interface ToolActivityPayloadLimits {
  readonly maxDepth: number;
  readonly maxEntriesPerCollection: number;
  readonly maxNodes: number;
  readonly maxStringCharacters: number;
  readonly maxTotalCharacters: number;
  readonly maxSerializedBytes: number;
}

export interface ToolActivityPayloadTruncation {
  readonly truncated: true;
  readonly reasons: ReadonlyArray<
    | "circular-reference"
    | "collection-size"
    | "depth"
    | "node-count"
    | "serialized-size"
    | "string-size"
    | "total-size"
    | "unsupported-value"
  >;
  readonly omittedCharacters: number;
  readonly omittedEntries: number;
  readonly retainedNodes: number;
}

export interface BoundedToolActivityData {
  readonly value: unknown;
  readonly truncation?: ToolActivityPayloadTruncation;
}

export const DEFAULT_TOOL_ACTIVITY_PAYLOAD_LIMITS: ToolActivityPayloadLimits = {
  maxDepth: 10,
  maxEntriesPerCollection: 100,
  maxNodes: 2_000,
  maxStringCharacters: 32_000,
  maxTotalCharacters: 64_000,
  maxSerializedBytes: 128_000,
};

const PAYLOAD_TRUNCATION_MARKER = "… tool payload truncated …";

type TruncationReason = ToolActivityPayloadTruncation["reasons"][number];

interface PayloadBudgetState {
  readonly limits: ToolActivityPayloadLimits;
  readonly reasons: Set<TruncationReason>;
  readonly seen: WeakSet<object>;
  nodes: number;
  characters: number;
  omittedCharacters: number;
  omittedEntries: number;
}

const serializedByteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

function recordOmission(
  state: PayloadBudgetState,
  reason: TruncationReason,
  omittedEntries = 0,
  omittedCharacters = 0,
): void {
  state.reasons.add(reason);
  state.omittedEntries += omittedEntries;
  state.omittedCharacters += omittedCharacters;
}

function retainString(value: string, state: PayloadBudgetState): string {
  const available = Math.max(0, state.limits.maxTotalCharacters - state.characters);
  const retainedLength = Math.min(value.length, state.limits.maxStringCharacters, available);
  if (retainedLength >= value.length) {
    state.characters += value.length;
    return value;
  }

  recordOmission(
    state,
    value.length > state.limits.maxStringCharacters ? "string-size" : "total-size",
    0,
    value.length - retainedLength,
  );
  if (retainedLength <= PAYLOAD_TRUNCATION_MARKER.length + 2) {
    const marker = PAYLOAD_TRUNCATION_MARKER.slice(0, retainedLength);
    state.characters += marker.length;
    return marker;
  }

  const contentLength = retainedLength - PAYLOAD_TRUNCATION_MARKER.length;
  const startLength = Math.ceil(contentLength / 2);
  const endLength = Math.floor(contentLength / 2);
  const retained = `${value.slice(0, startLength)}${PAYLOAD_TRUNCATION_MARKER}${value.slice(-endLength)}`;
  state.characters += retained.length;
  return retained;
}

function visitPayloadValue(value: unknown, state: PayloadBudgetState, depth: number): unknown {
  state.nodes += 1;
  if (state.nodes > state.limits.maxNodes) {
    recordOmission(state, "node-count", 1);
    return PAYLOAD_TRUNCATION_MARKER;
  }
  if (depth > state.limits.maxDepth) {
    recordOmission(state, "depth", 1);
    return PAYLOAD_TRUNCATION_MARKER;
  }

  if (typeof value === "string") {
    return retainString(value, state);
  }
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    state.characters += String(value).length;
    return Number.isFinite(value as number) || typeof value !== "number" ? value : String(value);
  }
  if (typeof value === "bigint") {
    recordOmission(state, "unsupported-value");
    return retainString(String(value), state);
  }
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    recordOmission(state, "unsupported-value");
    return null;
  }

  if (state.seen.has(value)) {
    recordOmission(state, "circular-reference", 1);
    return PAYLOAD_TRUNCATION_MARKER;
  }
  state.seen.add(value);

  if (Array.isArray(value)) {
    const retained: unknown[] = [];
    const length = Math.min(value.length, state.limits.maxEntriesPerCollection);
    for (let index = 0; index < length; index += 1) {
      if (
        state.characters >= state.limits.maxTotalCharacters ||
        state.nodes >= state.limits.maxNodes
      ) {
        recordOmission(state, "total-size", value.length - index);
        break;
      }
      retained.push(visitPayloadValue(value[index], state, depth + 1));
    }
    if (value.length > length) {
      recordOmission(state, "collection-size", value.length - length);
    }
    state.seen.delete(value);
    return retained;
  }

  const retained: Record<string, unknown> = {};
  let visitedEntries = 0;
  for (const key in value) {
    if (!Object.hasOwn(value, key)) {
      continue;
    }
    if (visitedEntries >= state.limits.maxEntriesPerCollection) {
      recordOmission(state, "collection-size", 1);
      continue;
    }
    if (
      state.characters >= state.limits.maxTotalCharacters ||
      state.nodes >= state.limits.maxNodes
    ) {
      recordOmission(state, "total-size", 1);
      continue;
    }
    visitedEntries += 1;
    const retainedKey = retainString(key, state);
    retained[retainedKey] = visitPayloadValue(
      (value as Record<string, unknown>)[key],
      state,
      depth + 1,
    );
  }
  state.seen.delete(value);
  return retained;
}

function withSerializedSizeReason(result: BoundedToolActivityData): BoundedToolActivityData {
  return {
    ...result,
    truncation: {
      truncated: true,
      reasons: [
        ...new Set([...(result.truncation?.reasons ?? []), "serialized-size" as const]),
      ].toSorted(),
      omittedCharacters: result.truncation?.omittedCharacters ?? 0,
      omittedEntries: result.truncation?.omittedEntries ?? 0,
      retainedNodes: result.truncation?.retainedNodes ?? 1,
    },
  };
}

function boundToolActivityDataOnce(
  value: unknown,
  limits: ToolActivityPayloadLimits,
): BoundedToolActivityData {
  const state: PayloadBudgetState = {
    limits,
    reasons: new Set(),
    seen: new WeakSet(),
    nodes: 0,
    characters: 0,
    omittedCharacters: 0,
    omittedEntries: 0,
  };
  const bounded = visitPayloadValue(value, state, 0);
  return {
    value: bounded,
    ...(state.reasons.size > 0
      ? {
          truncation: {
            truncated: true as const,
            reasons: [...state.reasons].toSorted(),
            omittedCharacters: state.omittedCharacters,
            omittedEntries: state.omittedEntries,
            retainedNodes: Math.min(state.nodes, limits.maxNodes),
          },
        }
      : {}),
  };
}

/**
 * Produces a JSON-safe provider payload with bounded depth, fan-out, node count, strings, and
 * serialized size. The separate metadata is intended to be persisted beside `data`, so clients can
 * explain that diagnostics are partial without changing provider-specific payload shapes.
 */
export function boundToolActivityData(
  value: unknown,
  overrides: Partial<ToolActivityPayloadLimits> = {},
): BoundedToolActivityData {
  let limits = { ...DEFAULT_TOOL_ACTIVITY_PAYLOAD_LIMITS, ...overrides };
  let result = boundToolActivityDataOnce(value, limits);
  let exceededSerializedSize = false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const serialized = JSON.stringify(result.value);
    if (serializedByteLength(serialized) <= limits.maxSerializedBytes) {
      return exceededSerializedSize ? withSerializedSizeReason(result) : result;
    }
    exceededSerializedSize = true;
    limits = Object.assign({}, limits, {
      maxTotalCharacters: Math.max(256, Math.floor(limits.maxTotalCharacters / 2)),
    });
    result = boundToolActivityDataOnce(value, limits);
  }

  return {
    value: PAYLOAD_TRUNCATION_MARKER,
    truncation: {
      truncated: true,
      reasons: ["serialized-size"],
      omittedCharacters: result.truncation?.omittedCharacters ?? 0,
      omittedEntries: result.truncation?.omittedEntries ?? 1,
      retainedNodes: 1,
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeCommandValue(value: unknown): string | undefined {
  const direct = asTrimmedString(value);
  if (direct) {
    return direct;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const parts: string[] = [];
  for (const entry of value.slice(0, 100)) {
    const part = asTrimmedString(entry);
    if (part !== undefined) {
      parts.push(part);
    }
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function stripTrailingExitCode(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  const match = /^(?<output>[\s\S]*?)(?:\s*<exited with exit code \d+>)\s*$/iu.exec(trimmed);
  const output = match?.groups?.output?.trim() ?? trimmed;
  return output.length > 0 ? output : undefined;
}

function extractCommandFromTitle(title: string | undefined): string | undefined {
  if (!title) {
    return undefined;
  }
  const backtickMatch = /`([^`]+)`/u.exec(title);
  return backtickMatch?.[1]?.trim() || undefined;
}

function extractToolCommand(data: Record<string, unknown> | undefined, title: string | undefined) {
  const item = asRecord(data?.item);
  const itemInput = asRecord(item?.input);
  const itemResult = asRecord(item?.result);
  const rawInput = asRecord(data?.rawInput);
  const candidates = [
    normalizeCommandValue(item?.command),
    normalizeCommandValue(itemInput?.command),
    normalizeCommandValue(itemResult?.command),
    normalizeCommandValue(data?.command),
    normalizeCommandValue(rawInput?.command),
  ];
  const direct = candidates.find((candidate) => candidate !== undefined);
  if (direct) {
    return direct;
  }
  const executable = asTrimmedString(rawInput?.executable);
  const args = normalizeCommandValue(rawInput?.args);
  if (executable && args) {
    return `${executable} ${args}`;
  }
  if (executable) {
    return executable;
  }
  return extractCommandFromTitle(title);
}

function maybePathLike(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (
    value.includes("/") ||
    value.includes("\\") ||
    value.startsWith(".") ||
    /\.(?:[a-z0-9]{1,12})$/iu.test(value)
  ) {
    return value;
  }
  return undefined;
}

function collectPaths(
  value: unknown,
  paths: string[],
  seen: Set<string>,
  depth: number,
  budget: { remainingNodes: number },
): void {
  if (depth > 4 || paths.length >= 8 || budget.remainingNodes <= 0) {
    return;
  }
  budget.remainingNodes -= 1;
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectPaths(entry, paths, seen, depth + 1, budget);
      if (paths.length >= 8 || budget.remainingNodes <= 0) {
        return;
      }
    }
    return;
  }
  const record = asRecord(value);
  if (!record) {
    return;
  }
  for (const key of ["path", "filePath", "relativePath", "filename", "newPath", "oldPath"]) {
    const candidate = maybePathLike(asTrimmedString(record[key]));
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    paths.push(candidate);
    if (paths.length >= 8) {
      return;
    }
  }
  for (const nestedKey of ["locations", "item", "input", "result", "rawInput", "data", "changes"]) {
    if (!(nestedKey in record)) {
      continue;
    }
    collectPaths(record[nestedKey], paths, seen, depth + 1, budget);
    if (paths.length >= 8 || budget.remainingNodes <= 0) {
      return;
    }
  }
}

function extractPrimaryPath(data: Record<string, unknown> | undefined): string | undefined {
  const paths: string[] = [];
  collectPaths(data, paths, new Set<string>(), 0, { remainingNodes: 1_000 });
  return paths[0];
}

function normalizeEquivalentValue(value: string | undefined): string | undefined {
  const trimmed = asTrimmedString(value);
  if (!trimmed) {
    return undefined;
  }
  return trimmed
    .replace(/\s+/gu, " ")
    .replace(/\s+(?:complete|completed|started)\s*$/iu, "")
    .trim();
}

function isEquivalent(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = normalizeEquivalentValue(left)?.toLowerCase();
  const normalizedRight = normalizeEquivalentValue(right)?.toLowerCase();
  return normalizedLeft !== undefined && normalizedLeft === normalizedRight;
}

function classifyToolAction(input: {
  readonly itemType?: ToolLifecycleItemType | null | undefined;
  readonly title?: string | undefined;
  readonly data?: Record<string, unknown> | undefined;
}): "command" | "read" | "file_change" | "file_search" | "web_search" | "other" {
  const itemType = input.itemType ?? undefined;
  const kind = asTrimmedString(input.data?.kind)?.toLowerCase();
  const title = asTrimmedString(input.title)?.toLowerCase();
  if (itemType === "command_execution" || kind === "execute" || title === "terminal") {
    return "command";
  }
  if (kind === "read" || title === "read file") {
    return "read";
  }
  if (
    itemType === "file_change" ||
    kind === "edit" ||
    kind === "move" ||
    kind === "delete" ||
    kind === "write"
  ) {
    return "file_change";
  }
  if (kind === "search" || title === "find" || title === "grep") {
    return "file_search";
  }
  if (kind === "fetch" || itemType === "web_search") {
    return "web_search";
  }
  return "other";
}

export interface ToolActivityPresentationInput {
  readonly itemType?: ToolLifecycleItemType | null | undefined;
  readonly title?: string | null | undefined;
  readonly detail?: string | null | undefined;
  readonly data?: unknown;
  readonly fallbackSummary?: string | null | undefined;
}

export interface ToolActivityPresentation {
  readonly summary: string;
  readonly detail?: string | undefined;
}

export function deriveToolActivityPresentation(
  input: ToolActivityPresentationInput,
): ToolActivityPresentation {
  const title = asTrimmedString(input.title);
  const detail = stripTrailingExitCode(asTrimmedString(input.detail));
  const fallbackSummary = asTrimmedString(input.fallbackSummary) ?? "Tool";
  const data = asRecord(input.data);
  const command = extractToolCommand(data, title);
  const primaryPath = extractPrimaryPath(data);
  const action = classifyToolAction({
    itemType: input.itemType,
    title,
    data,
  });

  if (action === "command") {
    return {
      summary: "Ran command",
      ...(command ? { detail: command } : {}),
    };
  }

  if (action === "read") {
    if (primaryPath) {
      return {
        summary: "Read file",
        detail: primaryPath,
      };
    }
    return {
      summary: "Read file",
    };
  }

  if (action === "file_change") {
    return {
      summary: "Changed files",
      ...(primaryPath ? { detail: primaryPath } : {}),
    };
  }

  if (action === "file_search" || action === "web_search") {
    const query =
      asTrimmedString(asRecord(data?.rawInput)?.query) ??
      asTrimmedString(asRecord(data?.rawInput)?.pattern) ??
      asTrimmedString(asRecord(data?.rawInput)?.searchTerm);
    return {
      summary: action === "file_search" ? "Searched files" : "Searched web",
      ...(query ? { detail: query } : {}),
    };
  }

  if (detail && !isEquivalent(detail, title) && !isEquivalent(detail, fallbackSummary)) {
    return {
      summary: title ?? fallbackSummary,
      detail,
    };
  }

  return {
    summary: title ?? fallbackSummary,
  };
}
