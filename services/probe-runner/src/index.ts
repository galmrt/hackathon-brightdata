import { loadAssertionSuite, loadRegions } from "./config.js";
import { runRegionProbe, summarizeRun } from "./runProbe.js";
import { decide } from "./decision.js";
import { draftRepairDescription } from "./repair.js";
import { loadDeployState } from "./deployState.js";
import { postToPort } from "./port.js";
import { shutdownTracing } from "./otel.js";

async function main() {
  const regions = loadRegions();
  const suite = loadAssertionSuite();

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

  await postToPort({ ...summary, decision, repairDescription });
  await shutdownTracing();

  if (decision.decision !== "healthy") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[probe-runner] fatal error:", error);
  process.exitCode = 1;
});
