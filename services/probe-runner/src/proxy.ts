import { ProxyAgent } from "undici";
import { config } from "./config.js";
import type { Region } from "./config.js";

/**
 * Bright Data routes requests to a specific country by encoding it into the
 * proxy username: brd-customer-<id>-zone-<zone>-country-<cc>. Confirm this
 * matches our provisioned zone's auth scheme during the workshop (CLAUDE.md §4).
 */
export function proxyAgentForRegion(region: Region): ProxyAgent {
  const { customerId, zone, zonePassword, proxyHost, proxyPort } = config.brightData;
  const username = `brd-customer-${customerId}-zone-${zone}-country-${region.countryCode}`;
  const proxyUrl = `http://${encodeURIComponent(username)}:${encodeURIComponent(zonePassword)}@${proxyHost}:${proxyPort}`;
  return new ProxyAgent(proxyUrl);
}
