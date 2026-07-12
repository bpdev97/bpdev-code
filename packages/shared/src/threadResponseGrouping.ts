import { formatDuration } from "./orchestrationTiming.ts";

export type ThreadResponseGroupingEntry =
  | {
      readonly kind: "user";
      readonly id: string;
      readonly createdAt: string;
    }
  | {
      readonly kind: "assistant";
      readonly id: string;
      readonly createdAt: string;
      readonly updatedAt: string;
      readonly turnId: string | null;
      readonly streaming: boolean;
    }
  | {
      readonly kind: "work";
      readonly id: string;
      readonly createdAt: string;
      readonly updatedAt?: string;
      readonly turnId: string | null;
    };

export interface ThreadResponseGroupingLatestTurn {
  readonly turnId: string;
  readonly state: "running" | "completed" | "interrupted" | "error";
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

export interface ThreadResponseFold {
  readonly responseId: string;
  readonly turnId: string;
  readonly anchorEntryId: string;
  readonly createdAt: string;
  readonly hiddenEntryIds: ReadonlySet<string>;
  readonly label: string;
}

export interface ThreadResponseGrouping {
  readonly terminalAssistantEntryIds: ReadonlySet<string>;
  readonly foldsByAnchorEntryId: ReadonlyMap<string, ThreadResponseFold>;
  readonly responseIdsByTurnId: ReadonlyMap<string, ReadonlyArray<string>>;
  readonly responseIdByEntryId: ReadonlyMap<string, string>;
  readonly activeResponseId: string | null;
}

interface ResponseBoundary {
  readonly id: string;
  readonly createdAt: string | null;
}

interface ResponseGroup {
  readonly responseId: string;
  readonly turnId: string | null;
  readonly boundary: ResponseBoundary;
  readonly entries: Array<Exclude<ThreadResponseGroupingEntry, { readonly kind: "user" }>>;
}

const PRELUDE_BOUNDARY_ID = "prelude";

function responseId(turnId: string | null, boundaryId: string): string {
  return `response:${encodeURIComponent(turnId ?? "unkeyed")}:${encodeURIComponent(boundaryId)}`;
}

function elapsedMs(startIso: string, endIso: string): number | null {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  return Math.max(0, end - start);
}

function laterTimestamp(left: string, right: string): string {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (!Number.isFinite(leftMs)) return right;
  if (!Number.isFinite(rightMs)) return left;
  return rightMs > leftMs ? right : left;
}

function unsettledTurnId(
  latestTurn: ThreadResponseGroupingLatestTurn | null,
  runningTurnId: string | null,
): string | null {
  if (runningTurnId !== null) {
    return runningTurnId;
  }
  if (latestTurn === null) {
    return null;
  }
  return latestTurn.completedAt === null || latestTurn.state === "running"
    ? latestTurn.turnId
    : null;
}

export function deriveThreadResponseGrouping(input: {
  readonly entries: ReadonlyArray<ThreadResponseGroupingEntry>;
  readonly latestTurn: ThreadResponseGroupingLatestTurn | null;
  readonly runningTurnId?: string | null;
}): ThreadResponseGrouping {
  const groups = new Map<string, ResponseGroup>();
  const groupOrder: ResponseGroup[] = [];
  let boundary: ResponseBoundary = { id: PRELUDE_BOUNDARY_ID, createdAt: null };

  for (const entry of input.entries) {
    if (entry.kind === "user") {
      boundary = { id: entry.id, createdAt: entry.createdAt };
      continue;
    }
    if (entry.kind === "work" && entry.turnId === null) {
      continue;
    }

    const id = responseId(entry.turnId, boundary.id);
    let group = groups.get(id);
    if (group === undefined) {
      group = {
        responseId: id,
        turnId: entry.turnId,
        boundary,
        entries: [],
      };
      groups.set(id, group);
      groupOrder.push(group);
    }
    group.entries.push(entry);
  }

  const terminalAssistantEntryIds = new Set<string>();
  const responseIdsByTurnId = new Map<string, string[]>();
  const responseIdByEntryId = new Map<string, string>();
  const lastGroupByTurnId = new Map<string, ResponseGroup>();
  for (const group of groupOrder) {
    for (const entry of group.entries) {
      responseIdByEntryId.set(entry.id, group.responseId);
    }
    const terminalAssistant = group.entries.findLast((entry) => entry.kind === "assistant");
    if (terminalAssistant !== undefined) {
      terminalAssistantEntryIds.add(terminalAssistant.id);
    }
    if (group.turnId !== null) {
      const ids = responseIdsByTurnId.get(group.turnId) ?? [];
      ids.push(group.responseId);
      responseIdsByTurnId.set(group.turnId, ids);
      lastGroupByTurnId.set(group.turnId, group);
    }
  }

  const activeTurnId = unsettledTurnId(input.latestTurn, input.runningTurnId ?? null);
  const activeGroup = activeTurnId === null ? undefined : lastGroupByTurnId.get(activeTurnId);
  const activeResponseId =
    activeGroup !== undefined && activeGroup.boundary.id === boundary.id
      ? activeGroup.responseId
      : null;
  const foldsByAnchorEntryId = new Map<string, ThreadResponseFold>();
  for (const group of groupOrder) {
    if (group.turnId === null || group.entries.length === 0) {
      continue;
    }
    const isLastGroupForTurn = lastGroupByTurnId.get(group.turnId) === group;
    const isCurrentResponse = group.responseId === activeResponseId;
    if (isCurrentResponse) {
      continue;
    }
    if (group.entries.some((entry) => entry.kind === "assistant" && entry.streaming)) {
      continue;
    }

    const terminalAssistant = group.entries.findLast((entry) => entry.kind === "assistant");
    const hiddenEntryIds = new Set(
      group.entries.filter((entry) => entry.id !== terminalAssistant?.id).map((entry) => entry.id),
    );
    if (hiddenEntryIds.size === 0) {
      continue;
    }

    const firstEntry = group.entries[0]!;
    const lastEntry = group.entries.at(-1)!;
    const isOnlyGroupForLatestTurn =
      input.latestTurn?.turnId === group.turnId &&
      responseIdsByTurnId.get(group.turnId)?.length === 1;
    const startAt =
      isOnlyGroupForLatestTurn && input.latestTurn?.startedAt
        ? input.latestTurn.startedAt
        : (group.boundary.createdAt ?? firstEntry.createdAt);
    let endAt =
      lastEntry.kind === "assistant"
        ? lastEntry.updatedAt
        : (lastEntry.updatedAt ?? lastEntry.createdAt);
    if (
      isLastGroupForTurn &&
      input.latestTurn?.turnId === group.turnId &&
      input.latestTurn.completedAt !== null
    ) {
      endAt = laterTimestamp(endAt, input.latestTurn.completedAt);
    }
    const durationMs = elapsedMs(startAt, endAt);
    const duration = durationMs === null ? null : formatDuration(durationMs);
    const interrupted =
      isLastGroupForTurn &&
      input.latestTurn?.turnId === group.turnId &&
      input.latestTurn.state === "interrupted";
    const label = interrupted
      ? duration
        ? `You stopped after ${duration}`
        : "You stopped this response"
      : duration
        ? `Worked for ${duration}`
        : "Worked";

    foldsByAnchorEntryId.set(firstEntry.id, {
      responseId: group.responseId,
      turnId: group.turnId,
      anchorEntryId: firstEntry.id,
      createdAt: firstEntry.createdAt,
      hiddenEntryIds,
      label,
    });
  }

  return {
    terminalAssistantEntryIds,
    foldsByAnchorEntryId,
    responseIdsByTurnId,
    responseIdByEntryId,
    activeResponseId,
  };
}
