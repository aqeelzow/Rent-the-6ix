import { describe, expect, it } from "vitest";
import { normalizeAddress } from "./address.ts";

describe("normalizeAddress", () => {
  it("abbreviates street types and directions the way the City does", () => {
    expect(normalizeAddress("123 Queen Street West")).toBe("123 QUEEN ST W");
    expect(normalizeAddress("45 St. Clair Avenue East")).toBe("45 ST CLAIR AVE E");
    expect(normalizeAddress("10 Yonge Boulevard")).toBe("10 YONGE BLVD");
  });

  it("drops unit and suite tokens so a unit matches its building", () => {
    expect(normalizeAddress("Unit 4 - 123 Queen St W")).toBe("123 QUEEN ST W");
    expect(normalizeAddress("Apt. 1203, 88 Harbour Street")).toBe("88 HARBOUR ST");
    expect(normalizeAddress("#5 200 Front St W")).toBe("200 FRONT ST W");
    expect(normalizeAddress("Suite 200 – 25 The Esplanade")).toBe("25 THE ESPLANADE");
  });

  it("gives the same key for the same address spelled two ways", () => {
    expect(normalizeAddress("181-183  GERRARD ST E")).toBe(
      normalizeAddress("181 183 Gerrard St E"),
    );
    expect(normalizeAddress("77 Howard St.")).toBe(normalizeAddress("77 Howard Street"));
  });

  it("keeps an address that is only a number usable", () => {
    expect(normalizeAddress("1001")).toBe("1001");
    expect(normalizeAddress("   ")).toBe("");
  });
});
