import { createFileRoute, redirect } from "@tanstack/react-router";

import { HermesAutomationsPage } from "../components/automations/HermesAutomationsPage";

export const Route = createFileRoute("/automations")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: HermesAutomationsPage,
});
