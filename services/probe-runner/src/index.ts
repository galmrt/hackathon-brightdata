import { loadAssertionSuite, loadRegions } from "./config.js";
import { runRegionProbe, summarizeRun } from "./runProbe.js";
import { decide } from "./decision.js";
import { draftRepairDescription } from "./repair.js";
import { loadDeployState } from "./deployState.js";
import { FAULT_ENV_VAR, faultTargetRegionId } from "./fault.js";
import { postToPort } from "./port.js";
import { writeDashboardFeed } from "./dashboardFeed.js";
import { shutdownTracing } from "./otel.js";

async function main() {
  const regions = loadRegions();
  const suite = loadAssertionSuite();

  const faultTarget = faultTargetRegionId();
  if (faultTarget && !regions.some((r) => r.id === faultTarget)) {
    // A typo'd region id would silently break nothing and the demo would
    // show healthy — fail fast instead.
    throw new Error(
      `${FAULT_ENV_VAR}="${faultTarget}" matches no region id (known: ${regions.map((r) => r.id).join(", ")})`,
    );
  }

  console.log(`[probe-runner] probing ${suite.targetUrl} from ${regions.length} region(s)...`);

  const results = await Promise.all(regions.map((region) => runRegionProbe(region, suite)));
  const summary = summarizeRun(suite.targetUrl, results);

  for (const result of results) {
    const status = result.allAssertionsPassed ? "PASS" : "FAIL";
    console.log(
      `[probe-runner] ${status} ${result.region.id} (${result.latencyMs}ms) — ${
        result.fetchError ?? `${result.assertions.filter((a) => a.passed).length}/${result.assertions.length} assertions passed`
      }`,
    );
  }

  console.log(
    `[probe-runner] region agreement: ${summary.regionsPassed}/${summary.regionsTotal} (${(summary.regionAgreement * 100).toFixed(0)}%)`,
  );

  const deployState = loadDeployState();
  const decision = decide(summary, deployState);

  console.log(
    `[probe-runner] decision: ${decision.decision} (confidence ${(decision.confidence * 100).toFixed(0)}%)`,
  );
  for (const reason of decision.reasons) {
    console.log(`[probe-runner]   - ${reason}`);
  }

  const repairDescription = draftRepairDescription(summary, decision);
  if (repairDescription) {
    console.log("[probe-runner] drafted repair description for Bright Data self-heal:");
    for (const line of repairDescription.split("\n")) {
      console.log(`[probe-runner]   | ${line}`);
    }
  }

  const payload = { ...summary, decision, repairDescription };
  // Feed the local dashboard before the Port post so the control room still
  // updates even if the webhook call fails.
  writeDashboardFeed(payload);
  await postToPort(payload);
  await shutdownTracing();

  if (decision.decision !== "healthy") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[probe-runner] fatal error:", error);
  process.exitCode = 1;
});
