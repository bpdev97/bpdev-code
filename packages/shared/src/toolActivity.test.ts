import { describe, expect, it } from "vite-plus/test";

import { boundToolActivityData, deriveToolActivityPresentation } from "./toolActivity.ts";

describe("toolActivity", () => {
  it("bounds nested provider data and reports why diagnostics are partial", () => {
    const result = boundToolActivityData(
      {
        command: "vp test",
        output: `start-${"x".repeat(2_000)}-end`,
        entries: Array.from({ length: 20 }, (_, index) => ({ index })),
      },
      {
        maxEntriesPerCollection: 4,
        maxStringCharacters: 100,
        maxTotalCharacters: 300,
        maxSerializedBytes: 1_000,
      },
    );
    const value = result.value as Record<string, unknown>;

    expect(value.command).toBe("vp test");
    expect(value.output).toMatch(/^start-/u);
    expect(value.output).toMatch(/-end$/u);
    expect(value.output).toContain("… tool payload truncated …");
    expect(value.entries).toHaveLength(4);
    expect(result.truncation).toMatchObject({
      truncated: true,
      reasons: expect.arrayContaining(["collection-size", "string-size"]),
      omittedEntries: 16,
    });
    expect(new TextEncoder().encode(JSON.stringify(result.value)).byteLength).toBeLessThanOrEqual(
      1_000,
    );
  });

  it("turns circular and unsupported values into JSON-safe diagnostics", () => {
    const data: Record<string, unknown> = { count: 1n };
    data.self = data;

    const result = boundToolActivityData(data);

    expect(() => JSON.stringify(result.value)).not.toThrow();
    expect(result.value).toEqual({
      count: "1",
      self: "… tool payload truncated …",
    });
    expect(result.truncation?.reasons).toEqual(["circular-reference", "unsupported-value"]);
  });

  it("normalizes command tools to a stable ran-command label", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "command_execution",
        title: "Terminal",
        detail: "Terminal",
        data: {
          command: "bun run lint",
        },
        fallbackSummary: "Terminal",
      }),
    ).toEqual({
      summary: "Ran command",
      detail: "bun run lint",
    });
  });

  it("uses structured file paths for read-file tools when available", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "dynamic_tool_call",
        title: "Read File",
        detail: "Read File",
        data: {
          kind: "read",
          locations: [{ path: "/tmp/app.ts" }],
        },
        fallbackSummary: "Read File",
      }),
    ).toEqual({
      summary: "Read file",
      detail: "/tmp/app.ts",
    });
  });

  it("drops duplicated generic read-file detail when no path is available", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "dynamic_tool_call",
        title: "Read File",
        detail: "Read File",
        data: {
          kind: "read",
          rawInput: {},
        },
        fallbackSummary: "Read File",
      }),
    ).toEqual({
      summary: "Read file",
    });
  });

  it("distinguishes ACP file searches from web fetches", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "web_search",
        title: "search: tool calls",
        data: { kind: "search" },
      }),
    ).toEqual({ summary: "Searched files" });

    expect(
      deriveToolActivityPresentation({
        itemType: "web_search",
        title: "web search: ACP tool calls",
        data: { kind: "fetch" },
      }),
    ).toEqual({ summary: "Searched web" });
  });
});
