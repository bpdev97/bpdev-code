import { useNavigation } from "@react-navigation/native";
import type { EnvironmentId } from "@t3tools/contracts";
import { findGenericChatProject, GENERIC_CHAT_PROJECT_TITLE } from "@t3tools/shared/genericChat";
import { useCallback, useMemo } from "react";

import { useProjects } from "../../state/entities";

export function useStartGenericChat(preferredEnvironmentId?: EnvironmentId | null) {
  const navigation = useNavigation();
  const projects = useProjects();
  const genericChatProject = useMemo(
    () => findGenericChatProject(projects, preferredEnvironmentId),
    [preferredEnvironmentId, projects],
  );

  const startGenericChat = useCallback(() => {
    if (genericChatProject === null) {
      return;
    }
    navigation.navigate("NewTaskSheet", {
      screen: "NewTaskDraft",
      params: {
        environmentId: String(genericChatProject.environmentId),
        projectId: String(genericChatProject.id),
        title: GENERIC_CHAT_PROJECT_TITLE,
      },
    });
  }, [genericChatProject, navigation]);

  return {
    genericChatAvailable: genericChatProject !== null,
    startGenericChat,
  };
}
