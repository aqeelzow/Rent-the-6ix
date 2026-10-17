import { describe, expect, it } from "vitest";
import { interpolate, t, type MessageKey } from "./messages";

describe("t", () => {
  it("returns the English string for a key", () => {
    expect(t("common.appName")).toBe("RentThe6ix");
    expect(t("landing.examples.family.label")).toBe("Family");
  });

  it("fills placeholders and leaves unknown ones alone", () => {
    expect(interpolate("{count} listings from {sources}", { count: 1520, sources: "Kijiji" })).toBe(
      "1520 listings from Kijiji",
    );
    expect(interpolate("seen {days} days ago", {})).toBe("seen {days} days ago");
    expect(t("common.search", { unused: 1 })).toBe("Search");
  });

  it("falls back to the key when a key is missing", () => {
    expect(t("landing.nope" as MessageKey)).toBe("landing.nope");
    expect(t("landing" as MessageKey)).toBe("landing");
  });
});
