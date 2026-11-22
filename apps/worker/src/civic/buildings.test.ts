import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CSV_PATH, parseCatalogue } from "./buildings.ts";

describe("parseCatalogue", () => {
  it("reads the seed catalogue", () => {
    const rows = parseCatalogue(readFileSync(CSV_PATH, "utf8"));
    expect(rows.length).toBeGreaterThan(50);
    expect(rows.find((r) => r.id === "icon")).toMatchObject({
      name: "ICON",
      kind: "student",
      addresses: ["330 Phillip St"],
      strictAliases: ["ICON"],
    });
    expect(rows.find((r) => r.id === "the-cooperage")!.addresses).toHaveLength(2);
    // Case-insensitive aliases are stored lower-case.
    for (const r of rows) for (const a of r.aliases) expect(a).toBe(a.toLowerCase());
  });

  it("rejects bad rows", () => {
    const header = "id,name,kind,addresses,aliases,strict_aliases,evidence";
    expect(() => parseCatalogue(`${header}\nIcon,ICON,student,330 Phillip St,,,x`)).toThrow(
      /bad id/,
    );
    expect(() => parseCatalogue(`${header}\nicon,ICON,dorm,330 Phillip St,,,x`)).toThrow(/kind/);
    expect(() => parseCatalogue(`${header}\nicon,ICON,student,,,,x`)).toThrow(/no address/);
    expect(() => parseCatalogue(`${header}\na,A,other,1 X St,,,x\na,A,other,1 X St,,,x`)).toThrow(
      /duplicate/,
    );
  });
});
