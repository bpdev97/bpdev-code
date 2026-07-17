import {
  formatToolCallDuration,
  toolCallSectionText,
  type ToolCallDetailSection,
  type ToolCallPresentation,
} from "@t3tools/client-runtime/tool-calls";

import { formatWorkspaceRelativePath } from "../../filePathDisplay";
import ChatMarkdown from "../ChatMarkdown";
import { cn } from "~/lib/utils";

function ToolCallDiff(props: { content: string }) {
  const lineOccurrences = new Map<string, number>();
  return (
    <pre className="max-h-72 overflow-auto rounded-md border border-border/45 bg-muted/20 p-2 font-mono text-[11px] leading-relaxed select-text">
      {props.content.split("\n").map((line) => {
        const occurrence = (lineOccurrences.get(line) ?? 0) + 1;
        lineOccurrences.set(line, occurrence);
        const isAddition = line.startsWith("+") && !line.startsWith("+++");
        const isDeletion = line.startsWith("-") && !line.startsWith("---");
        return (
          <span
            key={`${line}:${occurrence}`}
            className={cn(
              "block min-w-max whitespace-pre",
              isAddition && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
              isDeletion && "bg-rose-500/10 text-rose-700 dark:text-rose-300",
              (line.startsWith("@@") || line.startsWith("diff --git")) && "text-muted-foreground",
            )}
          >
            {line || " "}
          </span>
        );
      })}
    </pre>
  );
}

function ToolCallSectionView(props: {
  section: ToolCallDetailSection;
  workspaceRoot: string | undefined;
}) {
  const { section, workspaceRoot } = props;
  return (
    <section className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
        <span>{section.title}</span>
        {"truncated" in section && section.truncated ? (
          <span className="normal-case tracking-normal">truncated</span>
        ) : null}
      </div>
      {section.kind === "files" ? (
        <div className="space-y-2">
          {section.files.map((file) => (
            <div key={file.path} className="space-y-1.5">
              <div className="flex min-w-0 items-center gap-2 rounded-md border border-border/40 bg-muted/15 px-2 py-1.5 font-mono text-[11px]">
                <span className="min-w-0 flex-1 truncate select-text">
                  {formatWorkspaceRelativePath(file.path, workspaceRoot)}
                </span>
                {file.change ? (
                  <span className="shrink-0 font-sans text-[10px] text-muted-foreground">
                    {file.change}
                  </span>
                ) : null}
              </div>
              {file.diff ? <ToolCallDiff content={file.diff} /> : null}
            </div>
          ))}
        </div>
      ) : section.kind === "links" ? (
        <div className="space-y-1">
          {section.links.map((link) => (
            <a
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="block truncate text-[11px] text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
            >
              {link.label}
            </a>
          ))}
        </div>
      ) : section.kind === "code" && section.language === "diff" ? (
        <ToolCallDiff content={section.content} />
      ) : section.kind === "text" && section.format === "markdown" ? (
        <div className="max-h-72 overflow-auto rounded-md border border-border/45 bg-muted/20 px-2 py-1.5">
          <ChatMarkdown
            text={section.content}
            cwd={workspaceRoot}
            className="text-[11px] leading-relaxed [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1"
          />
        </div>
      ) : (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/45 bg-muted/20 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground select-text">
          {toolCallSectionText(section)}
        </pre>
      )}
    </section>
  );
}

export function ToolCallDetails(props: {
  toolCall: ToolCallPresentation;
  workspaceRoot: string | undefined;
}) {
  const { toolCall, workspaceRoot } = props;
  const metadata = [
    toolCall.cwd
      ? { label: "cwd", value: formatWorkspaceRelativePath(toolCall.cwd, workspaceRoot) }
      : null,
    toolCall.exitCode !== undefined ? { label: "exit", value: String(toolCall.exitCode) } : null,
    toolCall.durationMs !== undefined
      ? { label: "duration", value: formatToolCallDuration(toolCall.durationMs) }
      : null,
  ].filter((entry): entry is { label: string; value: string } => entry !== null);

  return (
    <div className="space-y-3">
      {metadata.length > 0 ? (
        <dl className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground/75">
          {metadata.map((entry) => (
            <div key={entry.label} className="flex min-w-0 items-baseline gap-1">
              <dt className="uppercase tracking-wide">{entry.label}</dt>
              <dd className="max-w-80 truncate font-mono text-foreground/70 select-text">
                {entry.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {toolCall.sections.map((section) => (
        <ToolCallSectionView
          key={`${section.kind}:${section.title}`}
          section={section}
          workspaceRoot={workspaceRoot}
        />
      ))}
    </div>
  );
}
