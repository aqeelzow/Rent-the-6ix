import { describe, expect, it } from "vitest";
import { queryAll } from "./arcgis.ts";

const feature = (id: number) => ({
  type: "Feature" as const,
  geometry: { type: "Point", coordinates: [-80.5, 43.5] },
  properties: { id },
});

describe("queryAll", () => {
  it("pages with resultOffset until the layer stops flagging exceededTransferLimit", async () => {
    const urls: string[] = [];
    const fetch = async <T>(url: string): Promise<T> => {
      urls.push(url);
      const offset = Number(new URL(url).searchParams.get("resultOffset"));
      const ids = offset === 0 ? [1, 2] : offset === 2 ? [3, 4] : [5];
      return {
        type: "FeatureCollection",
        features: ids.map(feature),
        properties: { exceededTransferLimit: offset < 4 },
      } as T;
    };
    const features = await queryAll(
      "https://x/FeatureServer/0",
      { orderBy: "id", pageSize: 2 },
      fetch,
    );
    expect(features.map((f) => f.properties.id)).toEqual([1, 2, 3, 4, 5]);
    expect(urls).toHaveLength(3);
    const first = new URL(urls[0]).searchParams;
    expect(first.get("outSR")).toBe("4326");
    expect(first.get("f")).toBe("geojson");
    expect(first.get("orderByFields")).toBe("id");
  });

  it("throws on an ArcGIS error body instead of returning a partial layer", async () => {
    const fetch = async <T>(): Promise<T> =>
      ({ error: { code: 400, message: "Invalid URL" } }) as T;
    await expect(queryAll("https://x/FeatureServer/0", { orderBy: "id" }, fetch)).rejects.toThrow(
      /Invalid URL/,
    );
  });
});
