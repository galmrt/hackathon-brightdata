import * as cheerio from "cheerio";
import type { Region } from "./config.js";

// Act 2 demo lever. All three logical regions physically route through
// country=nl (see probes/regions.json), so a genuine single-region failure
// can't occur naturally — and Vercel serves static files, so the app can't
// break itself per-region server-side either. Instead, setting
// WATCHTOWER_BREAK_REGION=<region-id> corrupts that ONE region's fetched HTML
// before assertions run (strips the buy-button element), simulating "one
// region sees broken content." This exercises the exact same decision path
// real regional breakage would: partial disagreement → hard escalate, no
// repair description. Every injection is loudly logged as [fault-injection]
// and stamped on the region's OTel span — this is a demo lever, not a
// hidden backdoor, and we say so to judges.

export const FAULT_ENV_VAR = "WATCHTOWER_BREAK_REGION";

export function faultTargetRegionId(): string | undefined {
  return process.env[FAULT_ENV_VAR] || undefined;
}

export function shouldInjectFault(region: Region): boolean {
  return faultTargetRegionId() === region.id;
}

export function injectFault(region: Region, html: string): string {
  const $ = cheerio.load(html);
  const removed = $('[data-testid="buy-button"]').remove().length;
  console.warn(
    `[fault-injection] ${FAULT_ENV_VAR}=${region.id}: removed ${removed} buy-button element(s) from ${region.id}'s fetched HTML — simulating single-region breakage before assertions run`,
  );
  return $.html();
}
