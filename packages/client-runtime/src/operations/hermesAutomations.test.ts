import { ProviderInstanceId, type HermesAutomation } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildHermesAutomationUpsert,
  draftForHermesAutomation,
  validateHermesAutomationDraft,
} from "./hermesAutomations.ts";

const automation: HermesAutomation = {
  id: "job-1",
  name: "Morning briefing",
  prompt: "Summarize open pull requests.",
  schedule: "0 9 * * *",
  enabled: true,
  state: "active",
  skills: ["github", "summary"],
  delivery: ["local"],
  repeat: { times: 4, completed: 1 },
  nextRunAt: null,
  lastRunAt: null,
  lastStatus: null,
  script: null,
  noAgent: false,
  workdir: "/work/repo",
};

describe("Hermes automation form operations", () => {
  it("creates an editable draft from an existing automation", () => {
    expect(draftForHermesAutomation(automation)).toEqual({
      name: "Morning briefing",
      schedule: "0 9 * * *",
      prompt: "Summarize open pull requests.",
      delivery: "local",
      repeat: "4",
      skills: "github, summary",
      script: "",
      workdir: "/work/repo",
      noAgent: false,
    });
  });

  it("rejects invalid repeat limits and script-only jobs without scripts", () => {
    const draft = draftForHermesAutomation(null);
    expect(
      validateHermesAutomationDraft({ ...draft, schedule: "every 2h", repeat: "1.5" }),
    ).toEqual({
      ok: false,
      field: "repeat",
      message: "Repeat limit must be a positive whole number.",
    });
    expect(
      validateHermesAutomationDraft({ ...draft, schedule: "every 2h", noAgent: true }),
    ).toEqual({
      ok: false,
      field: "script",
      message: "Script-only mode requires a script.",
    });
  });

  it("builds create and update mutations with normalized optional fields", () => {
    const draft = {
      ...draftForHermesAutomation(null),
      name: "  Nightly review  ",
      schedule: "  every 24h  ",
      prompt: "Review failures.",
      repeat: "3",
      skills: "github, summary, github",
    };
    const instanceId = ProviderInstanceId.make("hermes-default");

    expect(buildHermesAutomationUpsert({ instanceId, draft })).toEqual({
      ok: true,
      input: {
        action: "create",
        instanceId,
        name: "Nightly review",
        schedule: "every 24h",
        prompt: "Review failures.",
        delivery: "local",
        repeat: 3,
        skills: ["github", "summary"],
        script: "",
        noAgent: false,
        workdir: "",
      },
    });

    expect(buildHermesAutomationUpsert({ instanceId, automationId: "job-1", draft })).toMatchObject(
      {
        ok: true,
        input: { action: "update", instanceId, automationId: "job-1" },
      },
    );
  });
});
