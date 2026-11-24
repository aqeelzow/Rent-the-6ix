import { describe, expect, it } from "vitest";
import { createPlaceSearchHandler, placesFromPhoton } from "./place-search";

const feature = (name: string, lng: number, lat: number, street?: string) => ({
  geometry: { coordinates: [lng, lat] },
  properties: { name, housenumber: street ? "70" : undefined, street, city: "Waterloo" },
});
const near = { lat: 43.474, lng: -80.545 };

describe("placesFromPhoton", () => {
  it("sorts by distance, keeps the address, and drops repeats and unnamed places", () => {
    const places = placesFromPhoton(
      {
        features: [
          feature("Walmart Supercentre", -80.5481, 43.5082, "Farmers Market Road"),
          feature("Walmart Supercentre", -80.5161, 43.4701, "Bridgeport Road East"),
          feature("Walmart Supercentre", -80.5161, 43.4701, "Bridgeport Road East"),
          { geometry: { coordinates: [-80.5, 43.4] }, properties: {} },
        ],
      },
      near,
    );
    expect(places.map((p) => p.address)).toEqual([
      "70 Bridgeport Road East, Waterloo",
      "70 Farmers Market Road, Waterloo",
    ]);
    expect(places[0]!.distanceM).toBeGreaterThan(2000);
    expect(places[0]!.distanceM).toBeLessThan(3000);
  });

  it("is empty for an answer it doesn't recognise", () => {
    expect(placesFromPhoton({ nope: true }, near)).toEqual([]);
  });
});

describe("GET /api/places/search", () => {
  const request = (query: string) => new Request(`http://localhost/api/places/search?${query}`);

  it("asks Photon around the listing, inside the Region", async () => {
    let asked: URL | null = null;
    const handler = createPlaceSearchHandler((async (url: URL) => {
      asked = url;
      return Response.json({ features: [feature("Walmart", -80.5161, 43.4701)] });
    }) as unknown as typeof fetch);
    const response = await handler(request("q=walmart&near=43.474,-80.545"));
    expect(response.status).toBe(200);
    expect((await response.json()).places[0].name).toBe("Walmart");
    expect(asked!.searchParams.get("q")).toBe("walmart");
    expect(asked!.searchParams.get("bbox")).toBe("-80.75,43.30,-80.20,43.60");
  });

  it("rejects a missing query and reports Photon being down", async () => {
    const down = createPlaceSearchHandler((async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch);
    expect((await down(request("q=w&near=43.474,-80.545"))).status).toBe(400);
    expect((await down(request("q=walmart&near=43.474,-80.545"))).status).toBe(502);
  });
});
