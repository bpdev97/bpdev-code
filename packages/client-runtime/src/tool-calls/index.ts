import type { ToolLifecycleItemType } from "@t3tools/contracts";

export const DEFAULT_VISIBLE_TOOL_CALL_COUNT = 3;

const MAX_SECTION_CHARACTERS = 32_000;
const MAX_FILES = 50;
const MAX_LINKS = 12;

export type ToolCallCategory =
  | "command"
  | "file-change"
  | "read"
  | "search"
  | "web"
  | "mcp"
  | "agent"
  | "image"
  | "other";

export type ToolCallStatus = "inProgress" | "completed" | "failed" | "declined" | "stopped";

export interface ToolCallFile {
  readonly path: string;
  readonly change?: string;
  readonly diff?: string;
}

export interface ToolCallLink {
  readonly label: string;
  readonly url: string;
}

export type ToolCallDetailSection =
  | {
      readonly kind: "code";
      readonly title: string;
      readonly content: string;
      readonly language?: "shell" | "text" | "diff";
      readonly truncated?: boolean;
    }
  | {
      readonly kind: "text";
      readonly title: string;
      readonly content: string;
      readonly format?: "plain" | "markdown";
      readonly truncated?: boolean;
    }
  | {
      readonly kind: "json";
      readonly title: string;
      readonly content: string;
      readonly truncated?: boolean;
    }
  | {
      readonly kind: "files";
      readonly title: string;
      readonly files: ReadonlyArray<ToolCallFile>;
    }
  | {
      readonly kind: "links";
      readonly title: string;
      readonly links: ReadonlyArray<ToolCallLink>;
    };

export interface ToolCallPresentation {
  readonly callId?: string;
  readonly category: ToolCallCategory;
  readonly title: string;
  readonly preview?: string;
  readonly status?: ToolCallStatus;
  readonly cwd?: string;
  readonly exitCode?: number;
  readonly durationMs?: number;
  readonly sections: ReadonlyArray<ToolCallDetailSection>;
  readonly copyText: string;
}

export interface ToolCallPresentationInput {
  readonly activityKind: string;
  readonly summary: string;
  readonly payload: unknown;
  readonly command?: string;
  readonly rawCommand?: string;
  readonly detail?: string;
  readonly changedFiles?: ReadonlyArray<string>;
}

export interface ToolLifecycleEntry {
  readonly activityKind: string;
  readonly toolCallId?: string;
}

interface LimitedText {
  readonly text: string;
  readonly truncated: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function extractToolCallIdentity(payloadValue: unknown): string | null {
  const payload = asRecord(payloadValue);
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item);
  return firstString(
    payload?.itemId,
    payload?.toolCallId,
    payload?.toolUseId,
    data?.toolCallId,
    data?.toolUseId,
    item?.id,
  );
}

export function isToolLifecycleActivityKind(kind: string): boolean {
  return (
    kind === "tool.started" ||
    kind === "tool.progress" ||
    kind === "tool.updated" ||
    kind === "tool.completed"
  );
}

export function collapseToolLifecycleEntries<T extends ToolLifecycleEntry>(
  entries: ReadonlyArray<T>,
  mergeEntries: (previous: T, next: T) => T,
  shouldCollapseAdjacent: (previous: T, next: T) => boolean,
): T[] {
  const collapsed: Array<T | null> = [];
  const stableToolIndexes = new Map<string, number>();

  for (const entry of entries) {
    const stableKey = entry.toolCallId ? `tool:${entry.toolCallId}` : null;
    const stableIndex = stableKey ? stableToolIndexes.get(stableKey) : undefined;
    if (stableKey !== null && stableIndex !== undefined) {
      const previous = collapsed[stableIndex];
      if (previous && previous.activityKind !== "tool.completed") {
        collapsed[stableIndex] = null;
        collapsed.push(mergeEntries(previous, entry));
        stableToolIndexes.set(stableKey, collapsed.length - 1);
        continue;
      }
    }

    const previous = collapsed.findLast((candidate) => candidate !== null) ?? undefined;
    if (previous && shouldCollapseAdjacent(previous, entry)) {
      const previousIndex = collapsed.lastIndexOf(previous);
      collapsed[previousIndex] = mergeEntries(previous, entry);
      if (stableKey) stableToolIndexes.set(stableKey, previousIndex);
      continue;
    }

    collapsed.push(entry);
    if (stableKey) stableToolIndexes.set(stableKey, collapsed.length - 1);
  }

  return collapsed.filter((entry): entry is T => entry !== null);
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asInteger(value: unknown): number | null {
  const number = asNumber(value);
  return number !== null && Number.isInteger(number) ? number : null;
}

function firstString(...values: ReadonlyArray<unknown>): string | null {
  for (const value of values) {
    const string = asString(value);
    if (string) return string;
  }
  return null;
}

function firstNumber(...values: ReadonlyArray<unknown>): number | null {
  for (const value of values) {
    const number = asNumber(value);
    if (number !== null) return number;
  }
  return null;
}

function formatCommand(value: unknown): string | null {
  const direct = asString(value);
  if (direct) return direct;
  if (!Array.isArray(value)) return null;
  const parts = value.flatMap((part) => {
    const string = asString(part);
    if (!string) return [];
    return /[\s"'`]/u.test(string) ? [`"${string.replaceAll('"', '\\"')}"`] : [string];
  });
  return parts.length > 0 ? parts.join(" ") : null;
}

function limitText(value: string): LimitedText {
  if (value.length <= MAX_SECTION_CHARACTERS) {
    return { text: value, truncated: false };
  }
  const half = Math.floor((MAX_SECTION_CHARACTERS - 80) / 2);
  return {
    text: `${value.slice(0, half)}\n\n… output truncated for display …\n\n${value.slice(-half)}`,
    truncated: true,
  };
}

function safeStringify(value: unknown): string {
  try {
    const serialized = JSON.stringify(value, null, 2);
    return serialized ?? String(value);
  } catch {
    return String(value);
  }
}

function jsonSection(title: string, value: unknown): ToolCallDetailSection {
  const limited = limitText(safeStringify(value));
  return {
    kind: "json",
    title,
    content: limited.text,
    ...(limited.truncated ? { truncated: true } : {}),
  };
}

function normalizedStatus(value: unknown): ToolCallStatus | undefined {
  const normalized = asString(value)?.replaceAll("_", "").replaceAll("-", "").toLowerCase();
  switch (normalized) {
    case "inprogress":
    case "pending":
    case "running":
      return "inProgress";
    case "completed":
    case "complete":
    case "success":
    case "succeeded":
      return "completed";
    case "failed":
    case "failure":
    case "error":
      return "failed";
    case "declined":
    case "denied":
      return "declined";
    case "stopped":
    case "cancelled":
    case "canceled":
    case "interrupted":
      return "stopped";
    default:
      return undefined;
  }
}

function lifecycleStatus(
  activityKind: string,
  payload: Record<string, unknown>,
  data: Record<string, unknown>,
  item: Record<string, unknown>,
): ToolCallStatus | undefined {
  const explicit =
    normalizedStatus(payload.status) ??
    normalizedStatus(item.status) ??
    normalizedStatus(data.status);
  if (explicit) return explicit;
  if (activityKind === "tool.completed") return "completed";
  if (activityKind === "tool.denied") return "declined";
  if (
    activityKind === "tool.started" ||
    activityKind === "tool.updated" ||
    activityKind === "tool.progress"
  ) {
    return "inProgress";
  }
  return undefined;
}

function normalizeTitle(value: string): string {
  return value.replace(/\s+(?:started|complete|completed)$/iu, "").trim();
}

function categoryFromInput(input: {
  readonly itemType: ToolLifecycleItemType | null;
  readonly kind: string | null;
  readonly title: string;
  readonly toolName: string | null;
  readonly hasUrl: boolean;
}): ToolCallCategory {
  switch (input.kind?.toLowerCase()) {
    case "execute":
      return "command";
    case "edit":
    case "delete":
    case "move":
    case "write":
      return "file-change";
    case "read":
      return "read";
    case "search":
      return "search";
    case "fetch":
      return "web";
  }
  if (input.itemType === "command_execution") return "command";
  if (input.itemType === "file_change") return "file-change";
  if (input.itemType === "mcp_tool_call") return "mcp";
  if (input.itemType === "collab_agent_tool_call") return "agent";
  if (input.itemType === "image_view") return "image";
  if (input.itemType === "web_search") return "web";

  const hint = [input.kind, input.toolName, input.title]
    .filter(Boolean)
    .join(" ")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replaceAll(/[_-]+/gu, " ")
    .toLowerCase();
  if (/\b(?:exec|execute|terminal|bash|shell|command)\b/u.test(hint)) return "command";
  if (/\b(?:write|edit|patch|replace|delete|move|rename)\b/u.test(hint)) return "file-change";
  if (/\b(?:read|open file|view file|list files|glob)\b/u.test(hint)) return "read";
  if (/\b(?:web search|browse|fetch url)\b/u.test(hint)) return "web";
  if (/\b(?:grep|search|find)\b/u.test(hint)) return input.hasUrl ? "web" : "search";
  if (input.hasUrl) return "web";
  if (/\b(?:agent|task|delegate|collab)\b/u.test(hint)) return "agent";
  if (/\b(?:image|screenshot)\b/u.test(hint)) return "image";
  return "other";
}

function collectSearchQueries(value: unknown, queries: Map<string, string>, depth = 0): void {
  if (depth > 3 || value === null || value === undefined) return;
  const direct = asString(value);
  if (direct) {
    queries.set(direct.toLowerCase(), direct);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectSearchQueries(entry, queries, depth + 1);
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  for (const key of [
    "query",
    "queries",
    "q",
    "search_query",
    "searchQuery",
    "pattern",
    "term",
  ] as const) {
    if (record[key] !== undefined) collectSearchQueries(record[key], queries, depth + 1);
  }
}

function isToolLifecycleItemType(value: unknown): value is ToolLifecycleItemType {
  return (
    value === "command_execution" ||
    value === "file_change" ||
    value === "mcp_tool_call" ||
    value === "dynamic_tool_call" ||
    value === "collab_agent_tool_call" ||
    value === "web_search" ||
    value === "image_view"
  );
}

function collectFiles(value: unknown, files: Map<string, ToolCallFile>, depth = 0): void {
  if (depth > 4 || files.size >= MAX_FILES || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const entry of value) collectFiles(entry, files, depth + 1);
    return;
  }
  const record = asRecord(value);
  if (!record) return;

  const path = firstString(record.path, record.filePath, record.filename, record.file);
  if (path) {
    const existing = files.get(path);
    const change = firstString(record.kind, record.change, record.type) ?? existing?.change;
    const diff = firstString(record.diff, record.patch, record.unifiedDiff) ?? existing?.diff;
    files.set(path, {
      path,
      ...(change ? { change } : {}),
      ...(diff ? { diff: limitText(diff).text } : {}),
    });
  }

  for (const key of ["changes", "files", "locations"] as const) {
    if (record[key] !== undefined) collectFiles(record[key], files, depth + 1);
  }
}

function collectLinks(value: unknown, links: Map<string, ToolCallLink>, depth = 0): void {
  if (depth > 4 || links.size >= MAX_LINKS || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const entry of value) collectLinks(entry, links, depth + 1);
    return;
  }
  const record = asRecord(value);
  if (!record) return;

  for (const key of ["url", "uri", "href"] as const) {
    const url = asString(record[key]);
    if (url && /^https?:\/\//iu.test(url)) {
      links.set(url, {
        url,
        label: firstString(record.title, record.label, record.name) ?? url,
      });
    }
  }

  for (const [key, child] of Object.entries(record)) {
    if (["result", "results", "content", "links", "sources", "items"].includes(key)) {
      collectLinks(child, links, depth + 1);
    }
  }
}

function collectAcpContent(
  value: unknown,
  text: string[],
  files: Map<string, ToolCallFile>,
  links: Map<string, ToolCallLink>,
  terminals: string[],
  depth = 0,
): void {
  if (depth > 5 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const entry of value) collectAcpContent(entry, text, files, links, terminals, depth + 1);
    return;
  }
  const record = asRecord(value);
  if (!record) return;

  const type = asString(record.type);
  if (type === "diff") {
    const path = firstString(record.path);
    const newText = asString(record.newText);
    if (path && newText) {
      const oldText = asString(record.oldText);
      const diff = oldText ? `--- ${path}\n+++ ${path}\n@@\n${oldText}\n${newText}` : newText;
      files.set(path, { path, change: "update", diff: limitText(diff).text });
    }
    return;
  }
  if (type === "terminal") {
    const terminalId = firstString(record.terminalId);
    if (terminalId) terminals.push(terminalId);
    return;
  }
  if (type === "resource_link") {
    const uri = firstString(record.uri);
    if (uri && /^https?:\/\//iu.test(uri)) {
      links.set(uri, { url: uri, label: firstString(record.title, record.name) ?? uri });
    }
    return;
  }
  if (type === "content") {
    collectAcpContent(record.content, text, files, links, terminals, depth + 1);
    return;
  }
  if (type === "text") {
    const content = asString(record.text);
    if (content) text.push(content);
  }
}

function extractTextContent(value: unknown): string | null {
  const direct = asString(value);
  if (direct) return direct;
  const record = asRecord(value);
  if (record) {
    return firstString(record.content, record.text, record.output, record.stdout);
  }
  if (!Array.isArray(value)) return null;
  const chunks = value.flatMap((entry) => {
    const item = asRecord(entry);
    const text = firstString(item?.text, item?.content);
    return text ? [text] : [];
  });
  return chunks.length > 0 ? chunks.join("\n") : null;
}

function firstLine(value: string): string | null {
  const line = value
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  if (!line) return null;
  return line.length <= 120 ? line : `${line.slice(0, 119).trimEnd()}…`;
}

function compactJson(value: unknown): string | null {
  const text = safeStringify(value).replace(/\s+/gu, " ").trim();
  if (text.length === 0 || text === "{}" || text === "[]") return null;
  return text.length <= 120 ? text : `${text.slice(0, 119).trimEnd()}…`;
}

function hasUsefulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  const record = asRecord(value);
  return record ? Object.keys(record).length > 0 : true;
}

function appendTextSection(
  sections: ToolCallDetailSection[],
  kind: "code" | "text",
  title: string,
  value: string | null,
  language?: "shell" | "text" | "diff",
  format?: "plain" | "markdown",
): void {
  if (!value) return;
  const limited = limitText(value);
  if (
    sections.some(
      (section) =>
        (section.kind === "code" || section.kind === "text") &&
        section.content.trim() === limited.text.trim(),
    )
  ) {
    return;
  }
  if (kind === "code") {
    sections.push({
      kind,
      title,
      content: limited.text,
      ...(language ? { language } : {}),
      ...(limited.truncated ? { truncated: true } : {}),
    });
  } else {
    sections.push({
      kind,
      title,
      content: limited.text,
      ...(format ? { format } : {}),
      ...(limited.truncated ? { truncated: true } : {}),
    });
  }
}

function providerTitleDetail(
  providerTitle: string | null,
  category: ToolCallCategory,
): string | null {
  if (!providerTitle) return null;
  const separator = providerTitle.indexOf(":");
  if (separator < 0) return null;
  const prefix = providerTitle.slice(0, separator).trim().toLowerCase();
  const detail = providerTitle.slice(separator + 1).trim();
  if (!detail || detail === "?") return null;
  if (category === "search" && ["search", "find", "grep"].includes(prefix)) return detail;
  if (category === "web" && ["web search", "extract", "navigate"].includes(prefix)) {
    return detail;
  }
  return null;
}

function sectionCopyText(section: ToolCallDetailSection): string {
  switch (section.kind) {
    case "code":
    case "text":
      return `${section.title}\n${section.content}`;
    case "json":
      return `${section.title}\n${section.content}`;
    case "files":
      return `${section.title}\n${section.files
        .map((file) =>
          [file.path, file.change, file.diff]
            .filter((part): part is string => Boolean(part))
            .join("\n"),
        )
        .join("\n\n")}`;
    case "links":
      return `${section.title}\n${section.links.map((link) => link.url).join("\n")}`;
  }
}

function buildCopyText(presentation: Omit<ToolCallPresentation, "copyText">): string {
  const metadata = [
    presentation.cwd ? `Working directory: ${presentation.cwd}` : null,
    presentation.exitCode !== undefined ? `Exit code: ${presentation.exitCode}` : null,
    presentation.durationMs !== undefined
      ? `Duration: ${formatToolCallDuration(presentation.durationMs)}`
      : null,
  ].filter((value): value is string => value !== null);
  return [presentation.title, ...metadata, ...presentation.sections.map(sectionCopyText)].join(
    "\n\n",
  );
}

export function toolCallSectionText(section: ToolCallDetailSection): string {
  switch (section.kind) {
    case "code":
    case "text":
      return section.content;
    case "json":
      return section.content;
    case "files":
      return section.files
        .map((file) => [file.path, file.change, file.diff].filter(Boolean).join("\n"))
        .join("\n\n");
    case "links":
      return section.links.map((link) => `${link.label}\n${link.url}`).join("\n\n");
  }
}

export function formatToolCallDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "0ms";
  if (durationMs < 1_000) return `${Math.max(1, Math.round(durationMs))}ms`;
  if (durationMs < 10_000) {
    const tenths = Math.round(durationMs / 100) / 10;
    return tenths >= 10 ? "10s" : `${tenths.toFixed(1)}s`;
  }
  if (durationMs < 60_000) return `${Math.round(durationMs / 1_000)}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1_000);
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function toolCallHasDetails(toolCall: ToolCallPresentation): boolean {
  return (
    toolCall.sections.length > 0 ||
    toolCall.cwd !== undefined ||
    toolCall.exitCode !== undefined ||
    toolCall.durationMs !== undefined
  );
}

export function deriveToolCallPresentation(
  input: ToolCallPresentationInput,
): ToolCallPresentation | undefined {
  const payload = asRecord(input.payload) ?? {};
  const itemType = isToolLifecycleItemType(payload.itemType) ? payload.itemType : null;
  const isToolActivity = input.activityKind.startsWith("tool.") || itemType !== null;
  if (!isToolActivity) return undefined;

  const data = asRecord(payload.data) ?? {};
  const item = asRecord(data.item) ?? data;
  const itemInput = asRecord(item.input) ?? {};
  const itemResult = asRecord(item.result);
  const rawInput = asRecord(data.rawInput) ?? {};
  const rawOutput = asRecord(data.rawOutput);
  const resultRecord = itemResult ?? asRecord(data.result) ?? rawOutput;

  const callId = firstString(
    payload.itemId,
    payload.toolCallId,
    payload.toolUseId,
    data.toolCallId,
    data.toolUseId,
    item.id,
    item.callId,
  );
  const server = firstString(item.server, data.server);
  const providerTitle = firstString(item.providerTitle, data.providerTitle);
  const toolName = firstString(item.tool, data.tool, data.toolName, payload.toolName);
  const baseTitle = normalizeTitle(
    firstString(
      payload.title,
      server && toolName ? `${server} · ${toolName}` : null,
      input.summary,
    ) ?? "Tool call",
  );

  const files = new Map<string, ToolCallFile>();
  for (const path of input.changedFiles ?? []) files.set(path, { path });
  collectFiles(item.changes, files);
  collectFiles(data.changes, files);
  collectFiles(data.locations, files);
  collectFiles(rawOutput?.changes, files);

  const links = new Map<string, ToolCallLink>();
  collectLinks(item, links);
  collectLinks(data, links);

  const contentText: string[] = [];
  const terminalIds: string[] = [];
  collectAcpContent(data.content, contentText, files, links, terminalIds);
  collectAcpContent(rawOutput?.content, contentText, files, links, terminalIds);

  const kind = firstString(data.kind, item.kind, item.type);
  const category = categoryFromInput({
    itemType,
    kind,
    title: baseTitle,
    toolName,
    hasUrl: links.size > 0,
  });
  const searchQueries = new Map<string, string>();
  if (category === "search" || category === "web") {
    collectSearchQueries(item, searchQueries);
    collectSearchQueries(itemInput, searchQueries);
    collectSearchQueries(data, searchQueries);
    collectSearchQueries(rawInput, searchQueries);
    const titleQuery = providerTitleDetail(providerTitle, category);
    if (titleQuery) searchQueries.set(titleQuery.toLowerCase(), titleQuery);
  }
  const command =
    input.command ??
    formatCommand(item.command) ??
    formatCommand(itemInput.command) ??
    formatCommand(data.command) ??
    formatCommand(rawInput.command);
  const rawCommand = input.rawCommand && input.rawCommand !== command ? input.rawCommand : null;
  const cwd = firstString(item.cwd, itemInput.cwd, data.cwd, rawInput.cwd);
  const exitCode =
    asInteger(item.exitCode) ??
    asInteger(itemResult?.exitCode) ??
    asInteger(data.exitCode) ??
    asInteger(rawOutput?.exitCode) ??
    undefined;
  const elapsedSeconds = firstNumber(payload.elapsedSeconds, data.elapsedSeconds);
  const durationMs =
    firstNumber(item.durationMs, itemResult?.durationMs, data.durationMs) ??
    (elapsedSeconds !== null ? elapsedSeconds * 1_000 : undefined);
  const status = lifecycleStatus(input.activityKind, payload, data, item);
  const presentationTitle =
    status === "inProgress" && category === "command" && /^ran command$/iu.test(baseTitle)
      ? "Running command"
      : baseTitle;

  const argumentsValue =
    item.arguments ??
    data.arguments ??
    (hasUsefulValue(data.input) ? data.input : undefined) ??
    (hasUsefulValue(rawInput) ? rawInput : undefined) ??
    (hasUsefulValue(itemInput) ? itemInput : undefined);
  const output = firstString(
    item.aggregatedOutput,
    item.output,
    itemResult?.output,
    itemResult?.content,
    rawOutput?.content,
    rawOutput?.stdout,
    data.output,
  );
  const contentOutput = contentText.length > 0 ? contentText.join("\n\n") : null;
  const stderr = firstString(item.stderr, itemResult?.stderr, rawOutput?.stderr, data.stderr);
  const errorValue = item.error ?? data.error ?? resultRecord?.error;
  const resultValue =
    item.result ?? data.result ?? (category === "mcp" ? data.rawOutput : undefined);

  const sections: ToolCallDetailSection[] = [];
  appendTextSection(sections, "code", "Command", command, "shell");
  appendTextSection(sections, "code", "Invocation", rawCommand, "shell");
  if (searchQueries.size > 0) {
    appendTextSection(
      sections,
      "text",
      searchQueries.size === 1 ? "Search query" : "Search queries",
      [...searchQueries.values()].join("\n"),
    );
  }
  if (hasUsefulValue(argumentsValue) && category !== "command") {
    sections.push(jsonSection(category === "mcp" ? "Arguments" : "Input", argumentsValue));
  }
  if (files.size > 0) {
    sections.push({
      kind: "files",
      title: files.size === 1 ? "File" : "Files",
      files: [...files.values()],
    });
  }
  appendTextSection(sections, "code", "Output", output, "text");
  if (contentOutput && contentOutput !== output) {
    appendTextSection(sections, "text", "Tool output", contentOutput, undefined, "markdown");
  }
  appendTextSection(sections, "code", "Error output", stderr, "text");

  if (terminalIds.length > 0) {
    appendTextSection(sections, "code", "Terminal", [...new Set(terminalIds)].join("\n"), "text");
  }

  if (hasUsefulValue(resultValue)) {
    const resultText = extractTextContent(resultValue);
    if (resultText && resultText !== output) {
      appendTextSection(sections, "text", "Result", resultText);
    } else if (!resultText || category === "mcp") {
      sections.push(jsonSection("Result", resultValue));
    }
  }
  if (hasUsefulValue(errorValue)) {
    const errorText = extractTextContent(errorValue);
    if (errorText) appendTextSection(sections, "text", "Error", errorText);
    else sections.push(jsonSection("Error", errorValue));
  }
  if (links.size > 0) {
    sections.push({
      kind: "links",
      title: links.size === 1 ? "Link" : "Links",
      links: [...links.values()],
    });
  }

  const normalizedDetail = asString(input.detail);
  if (
    normalizedDetail &&
    normalizedDetail.toLowerCase() !== presentationTitle.toLowerCase() &&
    normalizedDetail !== command &&
    normalizedDetail !== output
  ) {
    appendTextSection(sections, "text", "Details", normalizedDetail);
  }

  if (sections.length === 0 && hasUsefulValue(data)) {
    sections.push(jsonSection("Details", data));
  }

  const filePreview = files.keys().next().value as string | undefined;
  const firstSearchQuery = searchQueries.values().next().value as string | undefined;
  const preview = firstString(
    command,
    firstSearchQuery
      ? searchQueries.size === 1
        ? firstLine(firstSearchQuery)
        : `${firstLine(firstSearchQuery)} +${searchQueries.size - 1} more`
      : null,
    filePreview
      ? files.size === 1
        ? filePreview
        : `${filePreview} +${files.size - 1} more`
      : null,
    category === "mcp" && hasUsefulValue(argumentsValue) ? compactJson(argumentsValue) : null,
    output ? firstLine(output) : null,
    normalizedDetail && normalizedDetail.toLowerCase() !== presentationTitle.toLowerCase()
      ? firstLine(normalizedDetail)
      : null,
  );

  const presentationWithoutCopy: Omit<ToolCallPresentation, "copyText"> = {
    ...(callId ? { callId } : {}),
    category,
    title: presentationTitle,
    ...(preview ? { preview } : {}),
    ...(status ? { status } : {}),
    ...(cwd ? { cwd } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    sections,
  };
  return {
    ...presentationWithoutCopy,
    copyText: buildCopyText(presentationWithoutCopy),
  };
}

function mergeFiles(
  previous: ReadonlyArray<ToolCallFile>,
  next: ReadonlyArray<ToolCallFile>,
): ReadonlyArray<ToolCallFile> {
  const files = new Map(previous.map((file) => [file.path, file]));
  for (const file of next) {
    files.set(file.path, { ...files.get(file.path), ...file });
  }
  return [...files.values()];
}

function mergeLinks(
  previous: ReadonlyArray<ToolCallLink>,
  next: ReadonlyArray<ToolCallLink>,
): ReadonlyArray<ToolCallLink> {
  return [...new Map([...previous, ...next].map((link) => [link.url, link])).values()];
}

function mergeSections(
  previous: ReadonlyArray<ToolCallDetailSection>,
  next: ReadonlyArray<ToolCallDetailSection>,
): ReadonlyArray<ToolCallDetailSection> {
  const nextHasStructuredDetails = next.some(
    (section) => section.kind !== "json" || section.title !== "Details",
  );
  const previousSections = nextHasStructuredDetails
    ? previous.filter((section) => section.kind !== "json" || section.title !== "Details")
    : previous;
  const sections = new Map<string, ToolCallDetailSection>();
  for (const section of [...previousSections, ...next]) {
    const key = `${section.kind}:${section.title}`;
    const existing = sections.get(key);
    if (existing?.kind === "files" && section.kind === "files") {
      sections.set(key, { ...section, files: mergeFiles(existing.files, section.files) });
    } else if (existing?.kind === "links" && section.kind === "links") {
      sections.set(key, { ...section, links: mergeLinks(existing.links, section.links) });
    } else {
      sections.set(key, section);
    }
  }
  return [...sections.values()];
}

export function mergeToolCallPresentations(
  previous: ToolCallPresentation | undefined,
  next: ToolCallPresentation | undefined,
): ToolCallPresentation | undefined {
  if (!previous) return next;
  if (!next) return previous;
  const sections = mergeSections(previous.sections, next.sections);
  const callId = next.callId ?? previous.callId;
  const preview = next.preview ?? previous.preview;
  const status = next.status ?? previous.status;
  const cwd = next.cwd ?? previous.cwd;
  const exitCode = next.exitCode ?? previous.exitCode;
  const durationMs = next.durationMs ?? previous.durationMs;
  const category = next.category === "other" ? previous.category : next.category;
  const title =
    next.category === "other" && previous.category !== "other" ? previous.title : next.title;
  const mergedWithoutCopy: Omit<ToolCallPresentation, "copyText"> = {
    ...(callId ? { callId } : {}),
    category,
    title,
    ...(preview ? { preview } : {}),
    ...(status ? { status } : {}),
    ...(cwd ? { cwd } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    sections,
  };
  return {
    ...mergedWithoutCopy,
    copyText: buildCopyText(mergedWithoutCopy),
  };
}
