import { describe, expect, it } from "vitest";
import { mappedApplications } from "./dev-applications.ts";

describe("mappedApplications", () => {
  it("keeps mapped sites and preserves status and structured unit counts", () => {
    const application = {
      type: "Feature" as const,
      geometry: { type: "Point", coordinates: [-80.5251, 43.4800] },
      properties: {
        OBJECTID: 1029,
        LOCATION: "324–330 King St N",
        Typology: "Mixed-Use",
        APPSTATUS: "Under Review",
        PROPOSED_UNITS: 226,
      },
    };
    expect(mappedApplications([application, { ...application, geometry: null }])).toEqual([
      expect.objectContaining({
        id: "waterloo:1029",
        location: "SRID=4326;POINT(-80.5251 43.48)",
        status: "Under Review",
        proposed_units: 226,
      }),
    ]);
  });
});
