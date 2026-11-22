import { describe, expect, it } from "vitest";
import { addressLine } from "./address-line";

describe("addressLine", () => {
  it("puts the building name before the address", () => {
    expect(
      addressLine({ title: "Room sublet", addressText: "330 Phillip St", buildingName: "ICON" }),
    ).toBe("ICON · 330 Phillip St");
    expect(addressLine({ title: "Room sublet", addressText: null, buildingName: "ICON" })).toBe(
      "ICON",
    );
  });

  it("skips a name the title already gives, and an address that is the title", () => {
    expect(
      addressLine({
        title: "2 bed at Vogue Residences",
        addressText: "155 King St N",
        buildingName: "Vogue Residences",
      }),
    ).toBe("155 King St N");
    expect(addressLine({ title: "330 Phillip St", addressText: "330 Phillip St" })).toBeNull();
  });
});
