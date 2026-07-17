import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { ProviderInstanceId, ServerSettings } from "@t3tools/contracts";
import { BUILT_IN_DRIVERS } from "../builtInDrivers.ts";
import { deriveProviderInstanceConfigMap } from "../Layers/ProviderInstanceRegistryHydration.ts";
import { HermesDriver } from "./HermesDriver.ts";

const decodeSettings = Schema.decodeSync(ServerSettings);

describe("HermesDriver registration", () => {
  it("registers Hermes as a multi-instance built-in with safe defaults", () => {
    expect(BUILT_IN_DRIVERS).toContain(HermesDriver);
    expect(HermesDriver.metadata.supportsMultipleInstances).toBe(true);
    expect(HermesDriver.defaultConfig()).toEqual({
      enabled: true,
      binaryPath: "hermes",
      profile: "default",
      customModels: [],
    });
  });

  it("does not synthesize a legacy Hermes instance", () => {
    const derived = deriveProviderInstanceConfigMap(decodeSettings({}));
    expect(derived[ProviderInstanceId.make("hermes")]).toBeUndefined();
  });

  it("preserves an explicit profile-backed Hermes instance", () => {
    const instanceId = ProviderInstanceId.make("hermes_research");
    const derived = deriveProviderInstanceConfigMap(
      decodeSettings({
        providerInstances: {
          hermes_research: {
            driver: "hermes",
            displayName: "Hermes Research",
            config: { profile: "research" },
          },
        },
      }),
    );
    expect(derived[instanceId]).toEqual({
      driver: "hermes",
      displayName: "Hermes Research",
      config: { profile: "research" },
    });
  });
});
