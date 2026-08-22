import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

export interface Region {
  id: string;
  label: string;
  countryCode: string;
}

export type AssertionKind = "exists" | "text-contains-any" | "text-matches";

export interface AssertionDef {
  id: string;
  testId: string;
  kind: AssertionKind;
  description: string;
  expectedTextIncludesAny?: string[];
  expectedPattern?: string;
}

export interface AssertionSuite {
  description: string;
  targetUrl: string;
  assertions: AssertionDef[];
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var ${name}. Copy .env.example to .env and fill it in (see CLAUDE.md §4 for where each value comes from).`,
    );
  }
  return value;
}

export function loadRegions(): Region[] {
  const raw = readFileSync(path.join(repoRoot, "probes", "regions.json"), "utf-8");
  return (JSON.parse(raw) as { regions: Region[] }).regions;
}

export function loadAssertionSuite(): AssertionSuite {
  const raw = readFileSync(
    path.join(repoRoot, "probes", "demo-app.assertions.json"),
    "utf-8",
  );
  const suite = JSON.parse(raw) as AssertionSuite;
  if (suite.targetUrl === "DEMO_APP_URL") {
    suite.targetUrl = requireEnv("DEMO_APP_URL");
  }
  return suite;
}

export const config = {
  brightData: {
    get customerId() {
      return requireEnv("BRIGHTDATA_CUSTOMER_ID");
    },
    get zone() {
      return requireEnv("BRIGHTDATA_ZONE");
    },
    get apiToken() {
      return requireEnv("BRIGHTDATA_API_TOKEN");
    },
    proxyHost: process.env.BRIGHTDATA_PROXY_HOST || "brd.superproxy.io",
    proxyPort: process.env.BRIGHTDATA_PROXY_PORT || "22225",
  },
  signoz: {
    endpoint: process.env.SIGNOZ_ENDPOINT,
    apiKey: process.env.SIGNOZ_API_KEY,
  },
  port: {
    webhookUrl: process.env.PORT_WEBHOOK_URL,
  },
};
