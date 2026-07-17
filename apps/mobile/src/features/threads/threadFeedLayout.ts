import type { ThreadFeedEntry } from "../../lib/threadActivity";

const WORK_ROW_HEIGHT = 44;
const WORK_ROW_GAP = 1;
const WORK_LOG_BOTTOM_MARGIN = 4;
const TURN_FOLD_BOTTOM_MARGIN = 12;

/**
 * Returns a size only for feed rows whose collapsed layout is deterministic.
 * Giving LegendList these sizes up front prevents it from seeding compact tool
 * rows with the much larger generic message estimate and correcting them while
 * the user scrolls backward through history.
 */
export function resolveThreadFeedFixedItemSize(
  entry: ThreadFeedEntry,
  expandedWorkRows: Readonly<Record<string, boolean>>,
  fontScale: number,
): number | undefined {
  // Accessibility text can grow beyond the nominal 44-point row target. In
  // that mode the native measurement remains authoritative.
  if (fontScale > 1.5) {
    return undefined;
  }

  if (entry.type === "work-toggle") {
    return WORK_ROW_HEIGHT + WORK_LOG_BOTTOM_MARGIN;
  }

  if (entry.type === "turn-fold") {
    return WORK_ROW_HEIGHT + TURN_FOLD_BOTTOM_MARGIN;
  }

  if (
    entry.type !== "activity-group" ||
    entry.activities.length === 0 ||
    entry.activities.some(
      (activity) => !activity.toolLike || expandedWorkRows[activity.id] === true,
    )
  ) {
    return undefined;
  }

  return (
    entry.activities.length * WORK_ROW_HEIGHT +
    (entry.activities.length - 1) * WORK_ROW_GAP +
    WORK_LOG_BOTTOM_MARGIN
  );
}
