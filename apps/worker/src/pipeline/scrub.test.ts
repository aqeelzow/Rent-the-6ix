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

  it("removes messaging IDs and @handles", () => {
    const out = scrub("WeChat: rent_to416, WhatsApp ID - abc.123, follow @torontoflats");
    expect(out).not.toMatch(/rent_to416|abc\.123|torontoflats/);
    expect(out).toBe(
      "WeChat [contact removed], WhatsApp [contact removed], follow [contact removed]",
    );
  });

  it("removes names after introductions, titles and sign-offs", () => {
    expect(scrub("Hi, my name is Priya Shah and I own the unit.")).toBe(
      "Hi, my name is [name removed] and I own the unit.",
    );
    expect(scrub("I’m Daniel, a retired teacher.")).toBe("I’m [name removed], a retired teacher.");
    expect(scrub("Viewings with Mrs. O'Brien on weekends")).toBe(
      "Viewings with Mrs. [name removed] on weekends",
    );
    expect(scrub("Speak to Wei Zhang about parking")).toBe("Speak to [name removed] about parking");
    expect(scrub("Bright unit. Thanks, Kevin")).toBe("Bright unit. Thanks, [name removed]");
    expect(scrub("Regards, Ana Silva 416-555-0100")).toBe(
      "Regards, [name removed] [phone removed]",
    );
    expect(scrub("Contact Agent John for a viewing")).toBe(
      "Contact Agent [name removed] for a viewing",
    );
  });

  it("removes names before a role and after DM (seen on Kijiji)", () => {
    expect(scrub("Deniz Rousta Leasing manager text or call 416-555-0100")).toBe(
      "[name removed] Leasing manager text or call [phone removed]",
    );
    expect(scrub("Interested? DM Alex at 647-555-0101")).toBe(
      "Interested? DM [name removed] at [phone removed]",
    );
  });

  it("leaves capitalized words that aren't names", () => {
    for (const text of [
      "Contact Us Today for a viewing",
      "Call Now! Text Me anytime",
      "Thanks, Toronto has never looked better from the 40th floor",
      "I’m renting out a clean 1 bedroom",
      "Close to Union Station and Queen West",
      "Ask for Management on site",
      // Realtor.ca writes remarks in Title Case.
      "Don't Miss Out on This Condo Gem To Call Home!",
      "Steps to Brookbanks Dr. Realstar manages the building",
    ])
      expect(scrub(text)).toBe(text);
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
