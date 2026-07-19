import {
  scopedProjectKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import {
  DEFAULT_RUNTIME_MODE,
  DEFAULT_SERVER_SETTINGS,
  type ScopedProjectRef,
} from "@t3tools/contracts";
import {
  GENERIC_CHAT_RUNTIME_MODE,
  findGenericChatProject,
  isGenericChatProject,
  isGenericChatProjectId,
} from "@t3tools/shared/genericChat";
import { useParams, useRouter } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import {
  markPromotedDraftThreadByRef,
  type DraftThreadEnvMode,
  type DraftThreadState,
  useComposerDraftStore,
} from "../composerDraftStore";
import { newDraftId, newThreadId } from "../lib/utils";
import { orderItemsByPreferredIds } from "../components/Sidebar.logic";
import {
  deriveLogicalProjectKeyFromSettings,
  getProjectOrderKey,
  selectProjectGroupingSettings,
} from "../logicalProject";
import { readThreadShell, useProjects, useServerConfigs, useThread } from "../state/entities";
import { resolveNewDraftStartFromOrigin } from "../lib/chatThreadActions";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { legacyProjectCwdPreferenceKey, useUiStateStore } from "../uiStateStore";
import { useClientSettings } from "./useSettings";
import { usePrimaryEnvironmentId } from "../state/environments";

export function useNewThreadHandler() {
  const projects = useProjects();
  const serverConfigs = useServerConfigs();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const router = useRouter();
  const getCurrentRouteTarget = useCallback(() => {
    const currentRouteParams = router.state.matches[router.state.matches.length - 1]?.params ?? {};
    return resolveThreadRouteTarget(currentRouteParams);
  }, [router]);

  return useCallback(
    (
      projectRef: ScopedProjectRef,
      options?: {
        branch?: string | null;
        worktreePath?: string | null;
        envMode?: DraftThreadEnvMode;
        startFromOrigin?: boolean;
        replace?: boolean;
      },
    ): Promise<void> => {
      const {
        getDraftSessionByLogicalProjectKey,
        getDraftSession,
        getDraftThread,
        applyStickyState,
        setDraftThreadContext,
        setLogicalProjectDraftThreadId,
      } = useComposerDraftStore.getState();
      const currentRouteTarget = getCurrentRouteTarget();
      const project = projects.find(
        (candidate) =>
          candidate.id === projectRef.projectId &&
          candidate.environmentId === projectRef.environmentId,
      );
      const environmentSettings =
        serverConfigs.get(projectRef.environmentId)?.settings ?? DEFAULT_SERVER_SETTINGS;
      const genericChat = isGenericChatProjectId(projectRef.projectId);
      const threadOptions = genericChat
        ? {
            ...options,
            branch: null,
            worktreePath: null,
            envMode: "local" as const,
            startFromOrigin: false,
          }
        : options;
      const logicalProjectKey = project
        ? deriveLogicalProjectKeyFromSettings(project, projectGroupingSettings)
        : scopedProjectKey(projectRef);
      const hasBranchOption = threadOptions?.branch !== undefined;
      const hasWorktreePathOption = threadOptions?.worktreePath !== undefined;
      const hasEnvModeOption = threadOptions?.envMode !== undefined;
      const hasStartFromOriginOption = threadOptions?.startFromOrigin !== undefined;
      const storedDraftThread = getDraftSessionByLogicalProjectKey(logicalProjectKey);
      const storedDraftThreadRef = storedDraftThread
        ? scopeThreadRef(storedDraftThread.environmentId, storedDraftThread.threadId)
        : null;
      const reusableStoredDraftThread =
        storedDraftThreadRef && readThreadShell(storedDraftThreadRef) !== null
          ? null
          : storedDraftThread;
      if (storedDraftThreadRef && reusableStoredDraftThread === null) {
        markPromotedDraftThreadByRef(storedDraftThreadRef);
      }
      const latestActiveDraftThread: DraftThreadState | null = currentRouteTarget
        ? currentRouteTarget.kind === "server"
          ? getDraftThread(currentRouteTarget.threadRef)
          : getDraftSession(currentRouteTarget.draftId)
        : null;
      if (reusableStoredDraftThread) {
        return (async () => {
          if (
            hasBranchOption ||
            hasWorktreePathOption ||
            hasEnvModeOption ||
            hasStartFromOriginOption ||
            genericChat
          ) {
            setDraftThreadContext(reusableStoredDraftThread.draftId, {
              ...(hasBranchOption ? { branch: threadOptions?.branch ?? null } : {}),
              ...(hasWorktreePathOption
                ? { worktreePath: threadOptions?.worktreePath ?? null }
                : {}),
              ...(hasEnvModeOption ? { envMode: threadOptions?.envMode } : {}),
              ...(hasStartFromOriginOption
                ? { startFromOrigin: threadOptions?.startFromOrigin }
                : {}),
              ...(genericChat ? { runtimeMode: GENERIC_CHAT_RUNTIME_MODE } : {}),
            });
          }
          setLogicalProjectDraftThreadId(
            logicalProjectKey,
            projectRef,
            reusableStoredDraftThread.draftId,
            {
              threadId: reusableStoredDraftThread.threadId,
            },
          );
          if (
            currentRouteTarget?.kind === "draft" &&
            currentRouteTarget.draftId === reusableStoredDraftThread.draftId
          ) {
            return;
          }
          await router.navigate({
            to: "/draft/$draftId",
            params: { draftId: reusableStoredDraftThread.draftId },
            replace: options?.replace ?? false,
          });
        })();
      }

      if (
        latestActiveDraftThread &&
        currentRouteTarget?.kind === "draft" &&
        latestActiveDraftThread.logicalProjectKey === logicalProjectKey &&
        latestActiveDraftThread.promotedTo == null
      ) {
        if (
          hasBranchOption ||
          hasWorktreePathOption ||
          hasEnvModeOption ||
          hasStartFromOriginOption ||
          genericChat
        ) {
          setDraftThreadContext(currentRouteTarget.draftId, {
            ...(hasBranchOption ? { branch: threadOptions?.branch ?? null } : {}),
            ...(hasWorktreePathOption ? { worktreePath: threadOptions?.worktreePath ?? null } : {}),
            ...(hasEnvModeOption ? { envMode: threadOptions?.envMode } : {}),
            ...(hasStartFromOriginOption
              ? { startFromOrigin: threadOptions?.startFromOrigin }
              : {}),
            ...(genericChat ? { runtimeMode: GENERIC_CHAT_RUNTIME_MODE } : {}),
          });
        }
        setLogicalProjectDraftThreadId(logicalProjectKey, projectRef, currentRouteTarget.draftId, {
          threadId: latestActiveDraftThread.threadId,
          createdAt: latestActiveDraftThread.createdAt,
          runtimeMode: latestActiveDraftThread.runtimeMode,
          interactionMode: latestActiveDraftThread.interactionMode,
          ...(hasBranchOption ? { branch: threadOptions?.branch ?? null } : {}),
          ...(hasWorktreePathOption ? { worktreePath: threadOptions?.worktreePath ?? null } : {}),
          ...(hasEnvModeOption ? { envMode: threadOptions?.envMode } : {}),
          ...(hasStartFromOriginOption ? { startFromOrigin: threadOptions?.startFromOrigin } : {}),
          ...(genericChat ? { runtimeMode: GENERIC_CHAT_RUNTIME_MODE } : {}),
        });
        return Promise.resolve();
      }

      const draftId = newDraftId();
      const threadId = newThreadId();
      const createdAt = new Date().toISOString();
      const initialEnvMode = threadOptions?.envMode ?? environmentSettings.defaultThreadEnvMode;
      return (async () => {
        setLogicalProjectDraftThreadId(logicalProjectKey, projectRef, draftId, {
          threadId,
          createdAt,
          branch: threadOptions?.branch ?? null,
          worktreePath: threadOptions?.worktreePath ?? null,
          envMode: initialEnvMode,
          startFromOrigin:
            threadOptions?.startFromOrigin ??
            resolveNewDraftStartFromOrigin({
              envMode: initialEnvMode,
              newWorktreesStartFromOrigin: environmentSettings.newWorktreesStartFromOrigin,
            }),
          runtimeMode: genericChat ? GENERIC_CHAT_RUNTIME_MODE : DEFAULT_RUNTIME_MODE,
        });
        applyStickyState(draftId);

        await router.navigate({
          to: "/draft/$draftId",
          params: { draftId },
          replace: options?.replace ?? false,
        });
      })();
    },
    [getCurrentRouteTarget, projectGroupingSettings, projects, router, serverConfigs],
  );
}

export function useHandleNewThread() {
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const routeThreadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const activeThread = useThread(routeThreadRef);
  const getDraftThread = useComposerDraftStore((store) => store.getDraftThread);
  const activeDraftThread = useComposerDraftStore(() =>
    routeTarget
      ? routeTarget.kind === "server"
        ? getDraftThread(routeTarget.threadRef)
        : useComposerDraftStore.getState().getDraftSession(routeTarget.draftId)
      : null,
  );
  const projects = useProjects();
  const orderedProjects = useMemo(() => {
    return orderItemsByPreferredIds({
      items: projects.filter((project) => !isGenericChatProject(project)),
      preferredIds: projectOrder,
      getId: getProjectOrderKey,
      getPreferenceIds: (project) => [
        getProjectOrderKey(project),
        legacyProjectCwdPreferenceKey(project.workspaceRoot),
      ],
    });
  }, [projectOrder, projects]);
  const handleNewThread = useNewThreadHandler();

  return {
    activeDraftThread,
    activeThread,
    defaultProjectRef: orderedProjects[0]
      ? scopeProjectRef(orderedProjects[0].environmentId, orderedProjects[0].id)
      : null,
    handleNewThread,
    routeThreadRef,
  };
}

export function useHandleNewChat() {
  const projects = useProjects();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const handleNewThread = useNewThreadHandler();
  const chatProject = useMemo(
    () => findGenericChatProject(projects, primaryEnvironmentId),
    [primaryEnvironmentId, projects],
  );
  const handleNewChat = useCallback((): Promise<void> => {
    if (!chatProject) {
      return Promise.resolve();
    }
    return handleNewThread(scopeProjectRef(chatProject.environmentId, chatProject.id));
  }, [chatProject, handleNewThread]);

  return { chatProject, handleNewChat };
}
