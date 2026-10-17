import { describe, expect, it } from "vitest";
import {
  cityValueText,
  factLabel,
  factValueText,
  formatFactNumber,
  periodLabel,
} from "./fact-format";

const fact = (over: Partial<Parameters<typeof factValueText>[0]> = {}) => ({
  indicatorId: "median_asking_rent_1br",
  value: 2500,
  cityValue: 2199,
  unit: "CAD/month",
  period: "30 days to 2026-10-17",
  sourceId: "rentthe6ix-listings",
  sampleSize: 703,
  note: null,
  ...over,
});

describe("formatFactNumber", () => {
  it("formats by unit", () => {
    expect(formatFactNumber(2500, "CAD/month")).toBe("$2,500 a month");
    expect(formatFactNumber(92000, "CAD")).toBe("$92,000");
    expect(formatFactNumber(13.8, "% of area")).toBe("13.8%");
    expect(formatFactNumber(90.4, "score out of 100")).toBe("90.4 / 100");
    expect(formatFactNumber(14.1, "stops per km²")).toBe("14.1 per km²");
    expect(formatFactNumber(48033, "units")).toBe("48,033");
  });
});

describe("value texts", () => {
  it("never shows a missing figure as zero", () => {
    expect(factValueText(fact())).toBe("$2,500 a month");
    expect(factValueText(fact({ value: null, note: "…; fewer than 5 listings" }))).toBe(
      "Not enough data",
    );
    expect(factValueText(fact({ value: null }))).toBe("Not available");
    expect(cityValueText(fact({ cityValue: null }))).toBe("No city-wide figure");
  });
});

describe("labels", () => {
  it("names periods and figures in plain words", () => {
    expect(periodLabel("30 days to 2026-10-17")).toBe("30 days to Oct 17, 2026");
    expect(periodLabel("12 months to 2026-10")).toBe("12 months to October 2026");
    expect(periodLabel("2021 Census")).toBe("2021 Census");
    expect(factLabel("rapid_transit_within_800m_pct")).toBe(
      "Area within 800 m of a subway or rail stop",
    );
    expect(factLabel("something_new")).toBe("something_new");
  });
});
