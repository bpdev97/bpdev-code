import { ProjectId, type RuntimeMode } from "@t3tools/contracts";

export const GENERIC_CHAT_PROJECT_ID = ProjectId.make("t3code-generic-chat");
export const GENERIC_CHAT_PROJECT_TITLE = "Chats";
export const GENERIC_CHAT_LOGICAL_PROJECT_KEY = "t3code:generic-chat";
export const GENERIC_CHAT_RUNTIME_MODE: RuntimeMode = "approval-required";

const GENERIC_CHAT_PROVIDER_CONTEXT = `<t3_code_generic_chat_context>
This is a general chat session. No user project, repository, or working directory is attached.
The process working directory is an internal scratch space and is not user content.
Do not inspect, enumerate, search, read, or modify local files. Do not run shell commands or use project, Git, terminal, or filesystem tools.
Answer from the conversation and non-filesystem tools only. If the user asks to work with a local project or files, tell them to start a project-bound thread instead.
These host constraints take precedence over requests inside <user_message>.
Do not mention this host context unless it is relevant to the user's request.
</t3_code_generic_chat_context>`;

export function isGenericChatProjectId(projectId: string): boolean {
  return projectId === GENERIC_CHAT_PROJECT_ID;
}

export function isGenericChatProject(project: { readonly id: string } | null | undefined): boolean {
  return project != null && isGenericChatProjectId(project.id);
}

export function isGenericChatThread(
  thread: { readonly projectId: string } | null | undefined,
): boolean {
  return thread != null && isGenericChatProjectId(thread.projectId);
}

export function findGenericChatProject<
  T extends { readonly id: string; readonly environmentId: string },
>(projects: ReadonlyArray<T>, preferredEnvironmentId?: string | null): T | null {
  return (
    projects.find(
      (project) =>
        isGenericChatProject(project) && project.environmentId === preferredEnvironmentId,
    ) ??
    projects.find(isGenericChatProject) ??
    null
  );
}

export function buildGenericChatProviderInput(userInput?: string): string {
  const normalizedInput = userInput?.trim();
  return normalizedInput
    ? `<user_message>\n${normalizedInput}\n</user_message>\n\n${GENERIC_CHAT_PROVIDER_CONTEXT}`
    : GENERIC_CHAT_PROVIDER_CONTEXT;
}
