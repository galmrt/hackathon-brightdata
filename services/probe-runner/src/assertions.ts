import * as cheerio from "cheerio";
import type { AssertionDef } from "./config.js";

export interface AssertionResult {
  id: string;
  testId: string;
  description: string;
  passed: boolean;
  reason: string;
}

export function runAssertions(html: string, assertions: AssertionDef[]): AssertionResult[] {
  const $ = cheerio.load(html);

  return assertions.map((assertion) => {
    const el = $(`[data-testid="${assertion.testId}"]`);

    if (el.length === 0) {
      return {
        id: assertion.id,
        testId: assertion.testId,
        description: assertion.description,
        passed: false,
        reason: `no element with data-testid="${assertion.testId}" found`,
      };
    }

    const text = el.first().text().trim();

    switch (assertion.kind) {
      case "exists":
        return {
          id: assertion.id,
          testId: assertion.testId,
          description: assertion.description,
          passed: true,
          reason: "element present",
        };

      case "text-contains-any": {
        const candidates = assertion.expectedTextIncludesAny ?? [];
        const passed = candidates.some((needle) =>
          text.toLowerCase().includes(needle.toLowerCase()),
        );
        return {
          id: assertion.id,
          testId: assertion.testId,
          description: assertion.description,
          passed,
          reason: passed
            ? `text "${text}" contains an expected phrase`
            : `text "${text}" does not contain any of [${candidates.join(", ")}]`,
        };
      }

      case "text-matches": {
        const pattern = assertion.expectedPattern ?? ".*";
        const passed = new RegExp(pattern).test(text);
        return {
          id: assertion.id,
          testId: assertion.testId,
          description: assertion.description,
          passed,
          reason: passed
            ? `text "${text}" matches /${pattern}/`
            : `text "${text}" does not match /${pattern}/`,
        };
      }

      default:
        return {
          id: assertion.id,
          testId: assertion.testId,
          description: assertion.description,
          passed: false,
          reason: `unknown assertion kind: ${assertion.kind}`,
        };
    }
  });
}
