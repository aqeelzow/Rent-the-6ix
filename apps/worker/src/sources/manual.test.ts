import { describe, expect, it } from "vitest";
import { normalize } from "../pipeline/normalize.ts";
import { csvField, MANUAL_COLUMNS, parseCsv, parseManual } from "./manual.ts";

const header = MANUAL_COLUMNS.join(",");
const row = (fields: Partial<Record<(typeof MANUAL_COLUMNS)[number], string>>) =>
  MANUAL_COLUMNS.map((c) => csvField(fields[c] ?? "")).join(",");

describe("manual.csv", () => {
  it("parses quoted fields and both line endings", () => {
    expect(parseCsv('a,"b, ""c""",d\r\n1,2,3\n')).toEqual([
      ["a", 'b, "c"', "d"],
      ["1", "2", "3"],
    ]);
    expect(csvField('Say "hi", then go')).toBe('"Say ""hi"", then go"');
  });

  it("loads only checked rows, with a stable id per URL", () => {
    const checked = {
      checked_on: "2026-10-17",
      source_url: "https://www.kijiji.ca/v-x/1",
      original_source: "kijiji",
      title: "Furnished room near York U",
      monthly_rent_cad: "950",
      unit_type: "room",
      furnished: "yes",
      pets_allowed: "cats_only",
      air_conditioning: "central",
      lat: "43.77",
      lng: "-79.50",
    };
    const text = [
      header,
      row(checked),
      row({ ...checked, checked_on: "", source_url: "https://x/2" }),
    ].join("\n");
    const { listings, skipped } = parseManual(text);
    expect(skipped).toBe(1);
    expect(listings).toHaveLength(1);
    expect(listings[0]).toMatchObject({
      source: "manual",
      furnished: true,
      airConditioning: "central",
    });
    expect(listings[0].sourceListingId).toBe(parseManual(text).listings[0].sourceListingId);
    const n = normalize(listings[0])!;
    expect(n).toMatchObject({
      unitType: "room",
      rentIsPerRoom: true,
      petsAllowed: "cats_only",
      airConditioning: "central",
    });
  });

  it("rejects a file with the wrong header", () => {
    expect(() => parseManual("url,rent\nhttps://x,1000")).toThrow(/header/);
  });
});
