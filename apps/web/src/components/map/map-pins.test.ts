import { describe, expect, it } from "vitest";
import { chipRent } from "./map-pins";

describe("chipRent", () => {
  it("keeps rents under $1,000 whole and shortens the rest to thousands", () => {
    expect(chipRent(850)).toBe("$850");
    expect(chipRent(1000)).toBe("$1k");
    expect(chipRent(1790)).toBe("$1.8k");
    expect(chipRent(2499)).toBe("$2.5k");
    expect(chipRent(12_000)).toBe("$12k");
  });
});
