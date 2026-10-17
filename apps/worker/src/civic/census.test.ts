import { describe, expect, it } from "vitest";
import { censusIndicators } from "./census.ts";

// The shape of the City's sheet: labels in column A (indented with spaces), one column per
// neighbourhood, and "Renter" appearing in more than one table.
const sheet = [
  ["Neighbourhood Name", "West Humber-Clairville", "Mount Olive-Silverstone-Jamestown"],
  ["Neighbourhood Number", "1", "2"],
  ["  Renter", "999", "999"],
  ["  Median total income of household in 2020 ($)", "92000", "76500"],
  ["Total - Private households by tenure - 25% sample data", "10700", "9740"],
  ["  Owner", "6995", "4480"],
  ["  Renter", "3705", "5260"],
  [
    "  % of tenant households spending 30% or more of its income on shelter costs",
    "34.1",
    "32.299999999999997",
  ],
];

describe("censusIndicators", () => {
  it("reads each neighbourhood's renter share, rent burden and median income by label", () => {
    const rows = censusIndicators(sheet);
    const pick = (area: string, id: string) =>
      rows.find((r) => r.area_id === area && r.indicator_id === id)!;
    expect(rows).toHaveLength(6);
    // 3,705 of 10,700 households: the "Renter" row right after the tenure total, not the earlier one.
    expect(pick("001", "renter_households_pct")).toMatchObject({
      value: 34.6,
      sample_size: 10700,
      period: "2021 Census",
    });
    expect(pick("002", "renters_shelter_cost_30pct").value).toBe(32.3);
    expect(pick("002", "median_household_income")).toMatchObject({ value: 76500, unit: "CAD" });
  });

  it("keeps a blank cell as unknown, and fails loudly when a label is missing", () => {
    const blank = sheet.map((row) =>
      row[0].includes("Median total income") ? [row[0], "", "76500"] : row,
    );
    expect(
      censusIndicators(blank).find(
        (r) => r.area_id === "001" && r.indicator_id === "median_household_income",
      )!.value,
    ).toBeNull();
    expect(() =>
      censusIndicators(sheet.filter((row) => !row[0].includes("tenant households"))),
    ).toThrow(/has the City changed the file/);
  });
});
