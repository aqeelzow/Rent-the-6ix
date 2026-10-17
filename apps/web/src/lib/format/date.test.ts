import { describe, expect, it } from "vitest";
import { formatDate, formatDaysAgo } from "./date";

describe("date formatting (en-CA)", () => {
  it("formats ISO dates without shifting the day", () => {
    expect(formatDate("2026-11-01")).toBe("Nov 1, 2026");
  });

  it("says how long ago in plain words", () => {
    expect(formatDaysAgo(0)).toBe("today");
    expect(formatDaysAgo(1)).toBe("yesterday");
    expect(formatDaysAgo(3)).toBe("3 days ago");
  });
});
