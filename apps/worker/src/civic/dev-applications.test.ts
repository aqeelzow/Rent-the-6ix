import { describe, expect, it } from "vitest";
import { groupApplications, parseProposedUnits } from "./dev-applications.ts";

describe("parseProposedUnits", () => {
  it("reads the unit counts the City's descriptions use", () => {
    expect(
      parseProposedUnits("The buildings contain a total of 1,170 dwelling units, 72,748 sq. m"),
    ).toBe(1170);
    expect(
      parseProposedUnits("Site Plan Approval for a 6-storey building with 40 residential units."),
    ).toBe(40);
    expect(parseProposedUnits("Draft Plan of Condominium - 210 Units.")).toBe(210);
    expect(
      parseProposedUnits("forms part of a larger 149-unit, three-storey townhouse development"),
    ).toBe(149);
    expect(parseProposedUnits("adding 15 new rental units to the existing building")).toBe(15);
  });

  it("is null when no unit count is stated (storeys and areas are not units)", () => {
    expect(
      parseProposedUnits(
        "Proposed four storey community centre with a gross floor area of 6,166sqm.",
      ),
    ).toBeNull();
    expect(parseProposedUnits("development of an (_)-storey mixed-use building")).toBeNull();
    expect(parseProposedUnits(null)).toBeNull();
  });
});

describe("groupApplications", () => {
  const row = (over: Record<string, string | null>) => ({
    "APPLICATION#": "13 180561 WET 06 OZ",
    APPLICATION_TYPE: "OZ",
    STREET_NUM: "11",
    STREET_NAME: "VAUDEVILLE",
    STREET_TYPE: "DR",
    STREET_DIRECTION: " ",
    STATUS: "Under Review ",
    X: "302041.168",
    Y: "4829731.483",
    DATE_SUBMITTED: "2013-06-04T00:00:00",
    DESCRIPTION: "to permit the development of 98 residential units .",
    CONTACT_NAME: "Someone",
    CONTACT_EMAIL: "someone@example.com",
    ...over,
  });

  it("keeps one row per application, at its first address, without contact details", () => {
    const apps = groupApplications([row({}), row({ STREET_NUM: "33", X: "302119.731" })]);
    expect(apps).toEqual([
      {
        id: "13 180561 WET 06 OZ",
        address: "11 VAUDEVILLE DR",
        x: 302041.168,
        y: 4829731.483,
        application_type: "OZ",
        status: "Under Review",
        proposed_units: 98,
        submitted_date: "2013-06-04",
      },
    ]);
    expect(JSON.stringify(apps)).not.toMatch(/someone/i);
  });

  it("drops rows with no application number or no coordinates", () => {
    expect(
      groupApplications([row({ "APPLICATION#": " " }), row({ X: "" }), row({ Y: "0" })]),
    ).toEqual([]);
  });
});
