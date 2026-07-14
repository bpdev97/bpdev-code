import { describe, expect, it } from "vite-plus/test";

import { sortEnvironmentsByLabel } from "./automationsPresentation";

describe("automation environment presentation", () => {
  it("sorts environments by label without mutating the source", () => {
    const environments = [
      { id: "zulu", label: "Zulu" },
      { id: "alpha", label: "Alpha" },
    ] as const;

    const sorted = sortEnvironmentsByLabel(environments);

    expect(sorted.map((environment) => environment.id)).toEqual(["alpha", "zulu"]);
    expect(environments.map((environment) => environment.id)).toEqual(["zulu", "alpha"]);
  });
});
