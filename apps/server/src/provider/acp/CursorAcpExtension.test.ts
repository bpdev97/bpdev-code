import { describe, expect, it } from "vite-plus/test";

import {
  CursorListAvailableModelsResponse,
  extractPlanApprovalQuestion,
  extractAskQuestions,
  extractPlanMarkdown,
  makeCursorAskQuestionCancelledResponse,
  makeCursorAskQuestionResponse,
  makeCursorCreatePlanResponse,
  makeCursorCreatePlanResponseFromAnswers,
  updateCursorTodoState,
} from "./CursorAcpExtension.ts";

describe("CursorAcpExtension", () => {
  it("extracts ask-question prompts from the real Cursor ACP payload shape", () => {
    const questions = extractAskQuestions({
      toolCallId: "ask-1",
      title: "Need input",
      questions: [
        {
          id: "language",
          prompt: "Which language should I use?",
          options: [
            { id: "ts", label: "TypeScript" },
            { id: "rs", label: "Rust" },
          ],
          allowMultiple: false,
        },
      ],
    });

    expect(questions).toEqual([
      {
        id: "language",
        header: "Question",
        question: "Which language should I use?",
        multiSelect: false,
        options: [
          { label: "TypeScript", description: "TypeScript" },
          { label: "Rust", description: "Rust" },
        ],
      },
    ]);
  });

  it("defaults ask-question multi-select to false when Cursor omits allowMultiple", () => {
    const questions = extractAskQuestions({
      toolCallId: "ask-2",
      questions: [
        {
          id: "mode",
          prompt: "Which mode should I use?",
          options: [
            { id: "agent", label: "Agent" },
            { id: "plan", label: "Plan" },
          ],
        },
      ],
    });

    expect(questions).toEqual([
      {
        id: "mode",
        header: "Question",
        question: "Which mode should I use?",
        multiSelect: false,
        options: [
          { label: "Agent", description: "Agent" },
          { label: "Plan", description: "Plan" },
        ],
      },
    ]);
  });

  it("extracts plan markdown from the real Cursor create-plan payload shape", () => {
    const planMarkdown = extractPlanMarkdown({
      toolCallId: "plan-1",
      name: "Refactor parser",
      overview: "Tighten ACP parsing",
      plan: "# Plan\n\n1. Add schemas\n2. Remove casts",
      todos: [
        { id: "t1", content: "Add schemas", status: "in_progress" },
        { id: "t2", content: "Remove casts", status: "pending" },
      ],
      isProject: false,
    });

    expect(planMarkdown).toBe("# Plan\n\n1. Add schemas\n2. Remove casts");
  });

  it("merges todo updates by id and removes cancelled entries", () => {
    const initial = updateCursorTodoState(new Map(), {
      toolCallId: "todos-1",
      todos: [
        { id: "1", content: "Inspect state", status: "completed" },
        { id: "2", content: "Apply fix", status: "pending" },
      ],
      merge: false,
    });
    const updated = updateCursorTodoState(initial.todos, {
      toolCallId: "todos-2",
      todos: [
        { id: "2", content: "Apply fix", status: "in_progress" },
        { id: "1", content: "Inspect state", status: "cancelled" },
        { id: "3", content: "Verify behavior", status: "pending" },
      ],
      merge: true,
    });

    expect(updated.plan).toEqual([
      { step: "Apply fix", status: "inProgress" },
      { step: "Verify behavior", status: "pending" },
    ]);
  });

  it("replaces todo state when merge is false", () => {
    const current = new Map([
      ["old", { id: "old", content: "Old step", status: "pending" as const }],
    ]);
    expect(
      updateCursorTodoState(current, {
        toolCallId: "todos-1",
        todos: [
          { id: "1", content: "Inspect state", status: "completed" },
          { id: "2", content: "  Apply fix  ", status: "in_progress" },
        ],
        merge: false,
      }).plan,
    ).toEqual([
      { step: "Inspect state", status: "completed" },
      { step: "Apply fix", status: "inProgress" },
    ]);
  });

  it("encodes ask-question answers with Cursor option ids", () => {
    const params = {
      toolCallId: "ask-3",
      questions: [
        {
          id: "scope",
          prompt: "Which scope?",
          options: [
            { id: "workspace", label: "Workspace" },
            { id: "session", label: "Session" },
          ],
          allowMultiple: true,
        },
      ],
    };

    expect(makeCursorAskQuestionResponse(params, { scope: ["Workspace", "session"] })).toEqual({
      outcome: {
        outcome: "answered",
        answers: [{ questionId: "scope", selectedOptionIds: ["workspace", "session"] }],
      },
    });
    expect(makeCursorAskQuestionResponse(params, { scope: "custom text" })).toEqual({
      outcome: {
        outcome: "skipped",
        reason: "No supported option was selected.",
      },
    });
    expect(makeCursorAskQuestionCancelledResponse()).toEqual({
      outcome: { outcome: "cancelled" },
    });
  });

  it("encodes create-plan decisions with the documented outcome envelope", () => {
    expect(makeCursorCreatePlanResponse("accepted")).toEqual({
      outcome: { outcome: "accepted" },
    });
    expect(makeCursorCreatePlanResponse("rejected")).toEqual({
      outcome: { outcome: "rejected" },
    });
  });

  it("maps explicit plan approval answers to Cursor decisions", () => {
    expect(
      extractPlanApprovalQuestion({
        toolCallId: "plan-2",
        name: "Refactor parser",
        overview: "Tighten ACP parsing",
        plan: "# Plan",
        todos: [],
        isProject: false,
      }),
    ).toEqual({
      id: "cursor-plan-approval",
      header: "Plan approval",
      question: "Approve the plan “Refactor parser”?",
      multiSelect: false,
      options: [
        {
          label: "Accept plan",
          description: "Allow Cursor to continue with this plan.",
        },
        {
          label: "Reject plan",
          description: "Reject the plan and stop this plan step.",
        },
      ],
    });
    expect(
      makeCursorCreatePlanResponseFromAnswers({
        "cursor-plan-approval": "Accept plan",
      }),
    ).toEqual({ outcome: { outcome: "accepted" } });
    expect(
      makeCursorCreatePlanResponseFromAnswers({
        "cursor-plan-approval": "The plan needs another step",
      }),
    ).toEqual({
      outcome: {
        outcome: "rejected",
        reason: "The plan needs another step",
      },
    });
  });

  it("decodes Cursor list_available_models responses with per-model config options", () => {
    const decoded = CursorListAvailableModelsResponse.make({
      models: [
        {
          value: "gpt-5.4",
          name: "GPT-5.4",
          configOptions: [
            {
              id: "reasoning",
              name: "Reasoning",
              category: "thought_level",
              type: "select",
              currentValue: "medium",
              options: [
                { value: "low", name: "Low" },
                { value: "medium", name: "Medium" },
              ],
            },
          ],
        },
      ],
    });

    expect(decoded.models[0]?.configOptions?.[0]?.id).toBe("reasoning");
  });
});
