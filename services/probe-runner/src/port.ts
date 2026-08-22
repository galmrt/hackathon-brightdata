import { config } from "./config.js";
import type { ProbeRunSummary } from "./runProbe.js";
import type { DecisionResult } from "./decision.js";

export type PortProbeRunPayload = ProbeRunSummary & { decision: DecisionResult };

export async function postToPort(summary: PortProbeRunPayload): Promise<void> {
  if (!config.port.webhookUrl) {
    console.warn(
      "[port] PORT_WEBHOOK_URL not set — skipping webhook post. Set it in .env once the Port workflow is built (CLAUDE.md Phase 3).",
    );
    return;
  }

  const response = await fetch(config.port.webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(summary),
  });

  if (!response.ok) {
    throw new Error(
      `Port webhook responded ${response.status} ${response.statusText}: ${await response.text()}`,
    );
  }
}
