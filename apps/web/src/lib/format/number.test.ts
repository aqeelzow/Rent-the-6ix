import { describe, expect, it } from "vitest";
import { formatCad, formatCount } from "./number";

describe("number formatting (en-CA)", () => {
  it("formats rents as whole Canadian dollars", () => {
    expect(formatCad(2450)).toBe("$2,450");
    expect(formatCad(1299.6)).toBe("$1,300");
  });

  it("formats counts with thousands separators", () => {
    expect(formatCount(1520)).toBe("1,520");
    expect(formatCount(8)).toBe("8");
  });
});
