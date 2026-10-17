import { describe, expect, it } from "vitest";
import { latestPopulationColumn } from "./crime.ts";

describe("latestPopulationColumn", () => {
  it("finds the newest POPULATION_<year> column (headers arrive trimmed)", () => {
    expect(
      latestPopulationColumn([
        "HOOD_158",
        "POPULATION_2024",
        "POPULATION_2025",
        "ASSAULT_RATE_2025",
      ]),
    ).toEqual({
      column: "POPULATION_2025",
      year: 2025,
    });
  });

  it("is null when the file has no population", () => {
    expect(latestPopulationColumn(["HOOD_158", "ASSAULT_RATE_2025"])).toBeNull();
  });
});
