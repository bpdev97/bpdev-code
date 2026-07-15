/**
 * Public Docs: https://cursor.com/docs/cli/acp#cursor-extension-methods
 * Additional reference provided by the Cursor team: https://anysphere.enterprise.slack.com/files/U068SSJE141/F0APT1HSZRP/cursor-acp-extension-method-schemas.md
 */
import type { ProviderUserInputAnswers, UserInputQuestion } from "@t3tools/contracts";
import * as AcpSchema from "effect-acp/schema";
import * as Schema from "effect/Schema";

const CursorAskQuestionOption = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
});

const CursorAskQuestion = Schema.Struct({
  id: Schema.String,
  prompt: Schema.String,
  options: Schema.Array(CursorAskQuestionOption),
  allowMultiple: Schema.optional(Schema.Boolean),
});

export const CursorAskQuestionRequest = Schema.Struct({
  toolCallId: Schema.String,
  title: Schema.optional(Schema.String),
  questions: Schema.Array(CursorAskQuestion),
});

const CursorTodoStatus = Schema.Literals(["pending", "in_progress", "completed", "cancelled"]);

const CursorTodo = Schema.Struct({
  id: Schema.String,
  content: Schema.String,
  status: CursorTodoStatus,
});

export type CursorTodo = typeof CursorTodo.Type;

const CursorPlanPhase = Schema.Struct({
  name: Schema.String,
  todos: Schema.Array(CursorTodo),
});

export const CursorCreatePlanRequest = Schema.Struct({
  toolCallId: Schema.String,
  name: Schema.optional(Schema.String),
  overview: Schema.optional(Schema.String),
  plan: Schema.String,
  todos: Schema.Array(CursorTodo),
  isProject: Schema.optional(Schema.Boolean),
  phases: Schema.optional(Schema.Array(CursorPlanPhase)),
});

export const CursorUpdateTodosRequest = Schema.Struct({
  toolCallId: Schema.String,
  todos: Schema.Array(CursorTodo),
  merge: Schema.Boolean,
});

const CursorTaskSubagentType = Schema.Union([
  Schema.Literals([
    "unspecified",
    "computer_use",
    "explore",
    "video_review",
    "browser_use",
    "shell",
    "vm_setup_helper",
  ]),
  Schema.Struct({ custom: Schema.String }),
]);

export const CursorTaskRequest = Schema.Struct({
  toolCallId: Schema.String,
  description: Schema.String,
  prompt: Schema.String,
  subagentType: CursorTaskSubagentType,
  model: Schema.optional(Schema.String),
  agentId: Schema.optional(Schema.String),
  durationMs: Schema.optional(Schema.Number),
});

export const CursorGenerateImageRequest = Schema.Struct({
  toolCallId: Schema.String,
  description: Schema.String,
  filePath: Schema.optional(Schema.String),
  referenceImagePaths: Schema.optional(Schema.Array(Schema.String)),
});

export type CursorAskQuestionResponse =
  | {
      readonly outcome: {
        readonly outcome: "answered";
        readonly answers: ReadonlyArray<{
          readonly questionId: string;
          readonly selectedOptionIds: ReadonlyArray<string>;
        }>;
      };
    }
  | {
      readonly outcome: {
        readonly outcome: "skipped";
        readonly reason?: string;
      };
    }
  | {
      readonly outcome: {
        readonly outcome: "cancelled";
      };
    };

export type CursorCreatePlanResponse = {
  readonly outcome:
    | { readonly outcome: "accepted"; readonly planUri?: string }
    | { readonly outcome: "rejected"; readonly reason?: string }
    | { readonly outcome: "cancelled" };
};

const CURSOR_PLAN_APPROVAL_QUESTION_ID = "cursor-plan-approval";
const CURSOR_PLAN_ACCEPT_LABEL = "Accept plan";
const CURSOR_PLAN_REJECT_LABEL = "Reject plan";

const CursorAvailableModel = Schema.Struct({
  value: Schema.String,
  name: Schema.String,
  configOptions: Schema.optional(Schema.Array(AcpSchema.SessionConfigOption)),
});

export const CursorListAvailableModelsResponse = Schema.Struct({
  models: Schema.Array(CursorAvailableModel),
});

export function extractAskQuestions(
  params: typeof CursorAskQuestionRequest.Type,
): ReadonlyArray<UserInputQuestion> {
  return params.questions.map((question) => ({
    id: question.id,
    header: "Question",
    question: question.prompt,
    multiSelect: question.allowMultiple === true,
    options:
      question.options.length > 0
        ? question.options.map((option) => ({
            label: option.label,
            description: option.label,
          }))
        : [{ label: "OK", description: "Continue" }],
  }));
}

function answerValues(answer: unknown): ReadonlyArray<string> {
  const values = Array.isArray(answer) ? answer : [answer];
  return values.flatMap((value) => {
    if (typeof value !== "string") {
      return [];
    }
    const normalized = value.trim();
    return normalized.length > 0 ? [normalized] : [];
  });
}

export function makeCursorAskQuestionResponse(
  params: typeof CursorAskQuestionRequest.Type,
  answers: ProviderUserInputAnswers,
): CursorAskQuestionResponse {
  const resolvedAnswers = params.questions.flatMap((question) => {
    const selectedValues = answerValues(answers[question.id]);
    const selectedOptionIds = selectedValues.flatMap((value) => {
      const option = question.options.find(
        (candidate) => candidate.id === value || candidate.label === value,
      );
      return option ? [option.id] : [];
    });
    return selectedOptionIds.length > 0 ? [{ questionId: question.id, selectedOptionIds }] : [];
  });

  if (resolvedAnswers.length === 0) {
    return {
      outcome: {
        outcome: "skipped",
        reason: "No supported option was selected.",
      },
    };
  }

  return {
    outcome: {
      outcome: "answered",
      answers: resolvedAnswers,
    },
  };
}

export function makeCursorAskQuestionCancelledResponse(): CursorAskQuestionResponse {
  return { outcome: { outcome: "cancelled" } };
}

export function makeCursorCreatePlanResponse(
  decision: "accepted" | "rejected" | "cancelled",
  reason?: string,
): CursorCreatePlanResponse {
  return {
    outcome:
      decision === "rejected" && reason?.trim()
        ? { outcome: decision, reason: reason.trim() }
        : { outcome: decision },
  };
}

export function extractPlanApprovalQuestion(
  params: typeof CursorCreatePlanRequest.Type,
): UserInputQuestion {
  return {
    id: CURSOR_PLAN_APPROVAL_QUESTION_ID,
    header: "Plan approval",
    question: params.name?.trim()
      ? `Approve the plan “${params.name.trim()}”?`
      : "Approve this plan?",
    multiSelect: false,
    options: [
      { label: CURSOR_PLAN_ACCEPT_LABEL, description: "Allow Cursor to continue with this plan." },
      { label: CURSOR_PLAN_REJECT_LABEL, description: "Reject the plan and stop this plan step." },
    ],
  };
}

export function makeCursorCreatePlanResponseFromAnswers(
  answers: ProviderUserInputAnswers,
): CursorCreatePlanResponse {
  const values = answerValues(answers[CURSOR_PLAN_APPROVAL_QUESTION_ID]);
  if (values.includes(CURSOR_PLAN_ACCEPT_LABEL)) {
    return makeCursorCreatePlanResponse("accepted");
  }
  const reason = values.find((value) => value !== CURSOR_PLAN_REJECT_LABEL);
  return makeCursorCreatePlanResponse("rejected", reason);
}

export function extractPlanMarkdown(params: typeof CursorCreatePlanRequest.Type): string {
  return params.plan || "# Plan\n\n(Cursor did not supply plan text.)";
}

export function updateCursorTodoState(
  current: ReadonlyMap<string, CursorTodo>,
  params: typeof CursorUpdateTodosRequest.Type,
): {
  readonly todos: ReadonlyMap<string, CursorTodo>;
  readonly plan: ReadonlyArray<{
    readonly step: string;
    readonly status: "pending" | "inProgress" | "completed";
  }>;
} {
  const todos = params.merge ? new Map(current) : new Map<string, CursorTodo>();
  for (const todo of params.todos) {
    if (todo.status === "cancelled") {
      todos.delete(todo.id);
    } else {
      todos.set(todo.id, todo);
    }
  }

  const plan = Array.from(todos.values()).flatMap((todo) => {
    const step = todo.content.trim();
    if (step.length === 0) return [];
    const status: "pending" | "inProgress" | "completed" =
      todo.status === "completed"
        ? "completed"
        : todo.status === "in_progress"
          ? "inProgress"
          : "pending";
    return [{ step, status }];
  });
  return { todos, plan };
}
