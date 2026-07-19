import { describe, expect, it } from "vite-plus/test";

import { buildHermesModelsFromGateway } from "./HermesProvider.ts";

describe("HermesProvider", () => {
  it("discovers authenticated gateway models with stable provider-qualified ids", () => {
    expect(
      buildHermesModelsFromGateway({
        providers: [
          {
            slug: "openrouter",
            name: "OpenRouter",
            authenticated: true,
            models: ["x-ai/grok-4.5"],
          },
          { slug: "missing", name: "Missing", authenticated: false, models: ["nope"] },
        ],
      }).map((model) => model.slug),
    ).toEqual(["openrouter:x-ai/grok-4.5"]);
  });
});
