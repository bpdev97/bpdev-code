import { createHermesAutomationEnvironmentAtoms } from "@t3tools/client-runtime/state/hermes-automations";

import { connectionAtomRuntime } from "../connection/runtime";

export const hermesAutomationEnvironment =
  createHermesAutomationEnvironmentAtoms(connectionAtomRuntime);
