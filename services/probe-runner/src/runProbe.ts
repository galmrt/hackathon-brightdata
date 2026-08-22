import { request } from "undici";
import { SpanStatusCode } from "@opentelemetry/api";
import { tracer } from "./otel.js";
import { proxyAgentForRegion } from "./proxy.js";
import { runAssertions } from "./assertions.js";
import type { AssertionResult } from "./assertions.js";
import type { AssertionSuite, Region } from "./config.js";

export interface RegionProbeResult {
  region: Region;
  targetUrl: string;
  timestamp: string;
  latencyMs: number;
  httpStatus: number | null;
  fetchError: string | null;
  assertions: AssertionResult[];
  allAssertionsPassed: boolean;
}

export interface ProbeRunSummary {
  runId: string;
  timestamp: string;
  targetUrl: string;
  results: RegionProbeResult[];
  regionsPassed: number;
  regionsTotal: number;
  regionAgreement: number; // regionsPassed / regionsTotal, 0..1
}

export async function runRegionProbe(
  region: Region,
  suite: AssertionSuite,
): Promise<RegionProbeResult> {
  return tracer.startActiveSpan(`probe.region.${region.id}`, async (span) => {
    const startedAt = Date.now();
    span.setAttribute("watchtower.region.id", region.id);
    span.setAttribute("watchtower.region.country_code", region.countryCode);
    span.setAttribute("watchtower.target_url", suite.targetUrl);

    let httpStatus: number | null = null;
    let fetchError: string | null = null;
    let assertions: AssertionResult[] = [];

    try {
      const dispatcher = proxyAgentForRegion(region);
      const response = await request(suite.targetUrl, { dispatcher });
      httpStatus = response.statusCode;
      const html = await response.body.text();
      assertions = runAssertions(html, suite.assertions);
    } catch (error) {
      fetchError = error instanceof Error ? error.message : String(error);
      span.recordException(error instanceof Error ? error : new Error(fetchError));
    }

    const latencyMs = Date.now() - startedAt;
    const allAssertionsPassed =
      fetchError === null && assertions.length > 0 && assertions.every((a) => a.passed);

    span.setAttribute("watchtower.latency_ms", latencyMs);
    span.setAttribute("watchtower.http_status", httpStatus ?? -1);
    span.setAttribute("watchtower.assertions_passed", assertions.filter((a) => a.passed).length);
    span.setAttribute("watchtower.assertions_total", assertions.length);
    span.setAttribute("watchtower.all_assertions_passed", allAssertionsPassed);

    for (const assertion of assertions) {
      span.addEvent(`assertion.${assertion.id}`, {
        "watchtower.assertion.test_id": assertion.testId,
        "watchtower.assertion.passed": assertion.passed,
        "watchtower.assertion.reason": assertion.reason,
      });
    }

    span.setStatus({
      code: allAssertionsPassed ? SpanStatusCode.OK : SpanStatusCode.ERROR,
      message: fetchError ?? undefined,
    });
    span.end();

    return {
      region,
      targetUrl: suite.targetUrl,
      timestamp: new Date(startedAt).toISOString(),
      latencyMs,
      httpStatus,
      fetchError,
      assertions,
      allAssertionsPassed,
    };
  });
}

export function summarizeRun(targetUrl: string, results: RegionProbeResult[]): ProbeRunSummary {
  const regionsPassed = results.filter((r) => r.allAssertionsPassed).length;
  const regionsTotal = results.length;

  return {
    runId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    targetUrl,
    results,
    regionsPassed,
    regionsTotal,
    regionAgreement: regionsTotal === 0 ? 0 : regionsPassed / regionsTotal,
  };
}
