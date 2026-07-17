import { useMemo } from "react";
import { isGenericChatThread } from "@t3tools/shared/genericChat";

import { useSelectedThreadDetail } from "./use-thread-detail";
import { useThreadSelection } from "./use-thread-selection";
import { resolvePreferredThreadWorktreePath } from "../features/terminal/terminalLaunchContext";

export function useSelectedThreadWorktree() {
  const { selectedThread, selectedThreadProject } = useThreadSelection();
  const selectedThreadDetail = useSelectedThreadDetail();
  const isGenericChat = isGenericChatThread(selectedThread);

  const selectedThreadWorktreePath = useMemo(
    () =>
      isGenericChat
        ? null
        : resolvePreferredThreadWorktreePath({
            threadShellWorktreePath: selectedThread?.worktreePath ?? null,
            threadDetailWorktreePath: selectedThreadDetail?.worktreePath ?? null,
          }),
    [isGenericChat, selectedThread?.worktreePath, selectedThreadDetail?.worktreePath],
  );

  return {
    selectedThreadWorktreePath,
    selectedThreadCwd: isGenericChat
      ? null
      : (selectedThreadWorktreePath ?? selectedThreadProject?.workspaceRoot ?? null),
  };
}
