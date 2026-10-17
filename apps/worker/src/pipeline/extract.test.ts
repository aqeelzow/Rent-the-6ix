import { describe, expect, it, vi } from "vitest";
import { emptyRawListing } from "../sources/types.ts";
import {
  accept,
  extractFields,
  geminiExtractorFromEnv,
  needsExtraction,
  sqftFromPhrase,
  type AiCache,
  type Extractor,
} from "./extract.ts";
import { normalize } from "./normalize.ts";

const TODAY = "2026-10-17";
const TEXT =
  "Bright 1 bed near Yonge. A/C units in every room, hydro extra. Small pets welcome! " +
  "Roughly 650 square feet. Building built in 1972. Move in Nov 1st, 1 year lease.";

const listing = normalize(
  {
    ...emptyRawListing,
    source: "kijiji",
    sourceListingId: "7",
    sourceUrl: "https://www.kijiji.ca/v-x/7",
    title: "Bright 1 bed",
    description: "Near Yonge.",
    monthlyRentCad: 2100,
    bedrooms: 1,
    lat: 43.7,
    lng: -79.4,
  },
  new Date(`${TODAY}T12:00:00Z`),
)!;

describe("accept", () => {
  it("keeps a valid value whose phrase is in the text", () => {
    expect(accept("airConditioning", { value: "yes", phrase: "A/C units" }, TEXT, TODAY)).toBe(
      "yes",
    );
    expect(accept("utilitiesIncluded", { value: "no", phrase: "hydro extra" }, TEXT, TODAY)).toBe(
      "no",
    );
  });

  it("drops a phrase that isn't in the text, a bad value, or unknown", () => {
    expect(accept("parking", { value: "yes", phrase: "parking included" }, TEXT, TODAY)).toBeNull();
    expect(accept("parking", { value: "maybe", phrase: "hydro extra" }, TEXT, TODAY)).toBeNull();
    expect(accept("furnished", { value: "unknown", phrase: "" }, TEXT, TODAY)).toBeNull();
    // Part of a word isn't a match.
    expect(accept("petsAllowed", { value: "yes", phrase: "ets welc" }, TEXT, TODAY)).toBeNull();
  });

  it("reads size and year from the phrase, never the model's number", () => {
    expect(accept("sqft", { value: "9999", phrase: "Roughly 650 square feet" }, TEXT, TODAY)).toBe(
      650,
    );
    expect(accept("yearBuilt", { value: "stated", phrase: "built in 1972" }, TEXT, TODAY)).toBe(
      1972,
    );
    expect(accept("yearBuilt", { value: "1972", phrase: "Building built in" }, TEXT, TODAY)).toBe(
      null,
    );
    expect(sqftFromPhrase("about 70 m²")).toBe(753);
    expect(sqftFromPhrase("650 sq ft or 700 sq ft")).toBeNull();
  });

  it("drops phrases that don't support the field", () => {
    const text = "Lots of parking and guest parking. Long-term or short-term. Renovated 2025.";
    expect(accept("parking", { value: "yes", phrase: "guest parking" }, text, TODAY)).toBeNull();
    expect(accept("parking", { value: "yes", phrase: "Lots of parking" }, text, TODAY)).toBeNull();
    expect(accept("parking", { value: "yes", phrase: "parking" }, text, TODAY)).toBeNull();
    expect(
      accept("parking", { value: "yes", phrase: "with parking" }, "Unit with parking.", TODAY),
    ).toBe("yes");
    expect(
      accept("leaseTerm", { value: "short-term", phrase: "Long-term or short-term" }, text, TODAY),
    ).toBeNull();
    expect(
      accept("yearBuilt", { value: "stated", phrase: "Renovated 2025" }, text, TODAY),
    ).toBeNull();
  });

  it("needs all utilities for a yes, and reads the lease from the phrase", () => {
    const text =
      "Includes 1 parking space and heat. Internet included! 2 year lease. Move-in ready.";
    expect(
      accept("utilitiesIncluded", { value: "yes", phrase: "Internet included" }, text, TODAY),
    ).toBeNull();
    expect(accept("leaseTerm", { value: "12 months", phrase: "2 year lease" }, text, TODAY)).toBe(
      "24 months",
    );
    expect(
      accept("availableFrom", { value: TODAY, phrase: "Move-in ready" }, text, TODAY),
    ).toBeNull();
    const more = "Unfurnished. Available from Oct/Nov. Pets restricted.";
    expect(accept("furnished", { value: "yes", phrase: "Unfurnished" }, more, TODAY)).toBeNull();
    expect(
      accept("availableFrom", { value: TODAY, phrase: "from Oct/Nov" }, more, TODAY),
    ).toBeNull();
    expect(
      accept("petsAllowed", { value: "no", phrase: "Pets restricted" }, more, TODAY),
    ).toBeNull();
  });

  it("takes a dated move-in only when the phrase shows the day", () => {
    expect(
      accept("availableFrom", { value: "2026-11-01", phrase: "Move in Nov 1st" }, TEXT, TODAY),
    ).toBe("2026-11-01");
    expect(
      accept("availableFrom", { value: "2026-11-15", phrase: "Move in Nov 1st" }, TEXT, TODAY),
    ).toBeNull();
    expect(
      accept("availableFrom", { value: "2028-01-01", phrase: "Move in Nov 1st" }, TEXT, TODAY),
    ).toBeNull();
  });
});

describe("extractFields", () => {
  const answer = {
    airConditioning: { value: "yes", phrase: "A/C units in every room" },
    utilitiesIncluded: { value: "no", phrase: "hydro extra" },
    parking: { value: "yes", phrase: "free parking" },
    petsAllowed: { value: "yes", phrase: "Small pets welcome" },
    sqft: { value: "stated", phrase: "650 square feet" },
    leaseTerm: { value: "stated", phrase: "1 year lease" },
  };

  it("fills unknown fields, marks them ai_extracted, and caches by text", async () => {
    expect(needsExtraction(listing)).toBe(true);
    const extractor = vi.fn<Extractor>(async (items) =>
      Object.fromEntries(items.map((i) => [i.id, answer])),
    );
    const cache: AiCache = {};
    const { targets, stats } = await extractFields([listing], () => TEXT, {
      extractor,
      cache,
      max: 10,
      today: TODAY,
    });
    expect(targets[0]).toMatchObject({
      airConditioning: "yes",
      utilitiesIncluded: "no",
      parking: "unknown", // "free parking" isn't in the text
      petsAllowed: "yes",
      sqft: 650,
      leaseTerm: "12 months",
    });
    expect(targets[0].fieldEvidence).toMatchObject({
      sqft: "ai_extracted",
      petsAllowed: "ai_extracted",
    });
    expect(stats).toMatchObject({ candidates: 1, sent: 1, filled: 1 });

    await extractFields([listing], () => TEXT, { extractor, cache, max: 10, today: TODAY });
    expect(extractor).toHaveBeenCalledTimes(1);
  });

  it("never replaces a known value", async () => {
    const known = { ...listing, airConditioning: "no" as const };
    const extractor: Extractor = async (items) =>
      Object.fromEntries(items.map((i) => [i.id, answer]));
    const { targets } = await extractFields([known], () => TEXT, {
      extractor,
      cache: {},
      max: 10,
      today: TODAY,
    });
    expect(targets[0].airConditioning).toBe("no");
  });

  it("stops on a rate limit and keeps the rows as they were", async () => {
    const extractor: Extractor = async () => {
      throw new Error("Gemini busy (429)");
    };
    const { targets, stats } = await extractFields([listing], () => TEXT, {
      extractor,
      cache: {},
      max: 10,
      today: TODAY,
    });
    expect(targets[0]).toEqual(listing);
    expect(stats.stopped).toContain("429");
  });

  it("sends at most `max` listings", async () => {
    const extractor = vi.fn<Extractor>(async () => ({}));
    const many = Array.from({ length: 25 }, () => listing);
    const { stats } = await extractFields(many, (i) => `${TEXT} ${i}`, {
      extractor,
      cache: {},
      max: 12,
      today: TODAY,
    });
    expect(stats.sent).toBe(12);
    expect(extractor).toHaveBeenCalledTimes(2);
  });
});

describe("geminiExtractorFromEnv", () => {
  it("is off without a provider, key or model", () => {
    expect(geminiExtractorFromEnv({})).toBeNull();
    expect(geminiExtractorFromEnv({ AI_PROVIDER: "gemini", GEMINI_API_KEY: "k" })).toBeNull();
  });

  it("posts the batch and parses the answers by id", async () => {
    const body = { listings: [{ id: "0", ...answer() }] };
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }],
          }),
        ),
    );
    const extract = geminiExtractorFromEnv(
      { AI_PROVIDER: "gemini", GEMINI_API_KEY: "k", GEMINI_MODEL_FAST: "m" },
      fetchFn as unknown as typeof fetch,
    )!;
    const out = await extract([{ id: "0", text: TEXT }], TODAY);
    expect(out["0"].airConditioning).toEqual({ value: "yes", phrase: "A/C" });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/models/m:generateContent");
    expect(String(init.body)).toContain("Today is 2026-10-17");
  });

  it("throws a busy error on 429", async () => {
    const extract = geminiExtractorFromEnv(
      { AI_PROVIDER: "gemini", GEMINI_API_KEY: "k", GEMINI_MODEL_FAST: "m" },
      (async () => new Response("", { status: 429 })) as unknown as typeof fetch,
    )!;
    await expect(extract([{ id: "0", text: TEXT }], TODAY)).rejects.toThrow("busy");
  });
});

function answer() {
  const none = { value: "unknown", phrase: "" };
  return {
    airConditioning: { value: "yes", phrase: "A/C" },
    utilitiesIncluded: none,
    parking: none,
    petsAllowed: none,
    furnished: none,
    laundryInSuite: none,
    sqft: none,
    yearBuilt: none,
    availableFrom: none,
    leaseTerm: none,
  };
}
