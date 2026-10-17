import { describe, expect, it } from "vitest";
import { csvTable, parseCsvLine, pick, toInt } from "./csv.ts";

describe("parseCsvLine", () => {
  it("keeps commas inside quoted fields", () => {
    expect(parseCsvLine('1,"OCT 18, 2021",YES')).toEqual(["1", "OCT 18, 2021", "YES"]);
    expect(parseCsvLine('"181-183  GERRARD ST E",PRIVATE')).toEqual([
      "181-183  GERRARD ST E",
      "PRIVATE",
    ]);
  });

  it("decodes doubled quotes and keeps empty trailing fields", () => {
    expect(parseCsvLine('a,"say ""hi""",')).toEqual(["a", 'say "hi"', ""]);
  });
});

describe("csvTable", () => {
  it("indexes rows by header and trims values", () => {
    const { rows } = csvTable("RSN,YEAR_BUILT\n 4153437 , 1930 \n");
    const collected = [...rows];
    expect(collected).toEqual([{ RSN: "4153437", YEAR_BUILT: "1930" }]);
  });
});

describe("pick and toInt", () => {
  it("falls back across column spellings and ignores values it cannot read", () => {
    expect(pick({ "YEAR BUILT": "1925" }, "YEAR_BUILT", "YEAR BUILT")).toBe("1925");
    expect(pick({ YEAR_BUILT: "" }, "YEAR_BUILT")).toBeNull();
    expect(toInt("1,234 m²")).toBe(1234);
    expect(toInt("N/A")).toBeNull();
    expect(toInt(null)).toBeNull();
  });
});
