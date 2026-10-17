import { describe, expect, it } from "vitest";
import { EXCERPT_MAX, excerpt, scrub } from "./scrub.ts";

describe("scrub", () => {
  it("removes emails, phone numbers, links and names after contact verbs", () => {
    const text =
      "Call 416-555-0199 or (647) 555 0100, email jo@example.com, see www.example.com. Ask for Maria Lopez.";
    const out = scrub(text);
    expect(out).not.toMatch(/555|example|Maria|Lopez/);
    expect(out).toContain("[phone removed]");
    expect(out).toContain("[email removed]");
    expect(out).toContain("Ask for [name removed]");
  });

  it("keeps prices and years", () => {
    expect(scrub("$2,450/month, built 2018, 2 bed")).toBe("$2,450/month, built 2018, 2 bed");
  });
});

describe("excerpt", () => {
  it("cuts long text to the limit on a word boundary", () => {
    const out = excerpt("word ".repeat(200));
    expect(out.length).toBeLessThanOrEqual(EXCERPT_MAX);
    expect(out.endsWith("word…")).toBe(true);
  });

  it("is empty for missing text", () => {
    expect(excerpt(null)).toBe("");
  });
});
