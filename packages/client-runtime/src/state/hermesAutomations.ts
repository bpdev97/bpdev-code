import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";

export function createHermesAutomationEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:hermes-automations:list",
      tag: WS_METHODS.hermesAutomationsList,
      staleTimeMs: 15_000,
      refreshIntervalMs: 60_000,
    }),
    mutate: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:hermes-automations:mutate",
      tag: WS_METHODS.hermesAutomationsMutate,
      scheduler,
      concurrency: {
        mode: "serial",
        key: (target) => `${target.environmentId}:${target.input.instanceId}`,
      },
    }),
  };
}
