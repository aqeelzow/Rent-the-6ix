import { describe, expect, it } from "vitest";
import { facebookMarketplace, WATERLOO_TILES } from "../sources/facebook-marketplace.ts";
import { kijiji } from "../sources/kijiji.ts";
import { DEFAULT_MAX_PAGES, ingestOptionsFromEnv, maxPagesFor } from "./run-ingest.ts";

describe("maxPagesFor", () => {
  it("reads every Facebook map circle, and a few newest pages elsewhere, by default", () => {
    const options = ingestOptionsFromEnv({ sources: "kijiji" });
    expect(maxPagesFor(facebookMarketplace, options)).toBe(WATERLOO_TILES.length);
    expect(maxPagesFor(kijiji, options)).toBe(DEFAULT_MAX_PAGES);
  });

  it("lets --pages cap every source", () => {
    const options = ingestOptionsFromEnv({ sources: "kijiji", pages: "2" });
    expect(maxPagesFor(facebookMarketplace, options)).toBe(2);
    expect(maxPagesFor(kijiji, options)).toBe(2);
  });
});
