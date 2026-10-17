// B-owned scoring and ordinary-search tunables; surface on A's /data page at integration.
export const engineConfig = {
  weights: { value: 30, price: 15, travel: 30, home: 25, safety: 0 },
  fairnessWeight: 45, safetyWeight: 15, priceOverrun: .15, sizeOverrun: .25,
  ageOverrunYears: 20, availabilityOverrunDays: 30,
  candidateLimit: 500, routingLimit: 100, routingBudgetMs: 3000, percentileBudgetMs: 120000,
  distanceM: { walk: 800, bike: 3000, transit: 3000, drive: 6000 },
  minutes: {
    quick: { walk: 10, bike: 10, transit: 15, drive: 10 },
    civic: { walk: 15, bike: 10, transit: 20, drive: 10 },
    place: { walk: 20, bike: 20, transit: 30, drive: 25 },
  },
} as const;
// Engine constants (SPEC 7). Every tunable value here is listed on the /data methodology page.
// Each owner keeps their own section; edit others' sections only by agreement.

/** Valuation from comparables (SPEC 7.2). Owner: C. */
export const VALUATION = {
  /** Fewer comparables than this at the widest radius → "Not enough data". */
  minComparables: 5,
  /** Search radii in metres, tried in order until there are minComparables. */
  radiiM: [1000, 2000, 3000],
  /** Comparables must have been seen within this many days. */
  windowDays: 60,
  /** Sample monthly amounts used to put a comparable on the listing's terms. */
  adjustmentsCad: {
    utilitiesIncluded: 150,
    parking: 100,
    furnished: 150,
    laundryInSuite: 50,
  },
  /** Distance weight = 1 / (1 + d / distanceScaleM). */
  distanceScaleM: 500,
  /** Recency weight is 1 up to this age, then falls linearly to recencyFloor at windowDays. */
  recencyFullDays: 14,
  recencyFloor: 0.5,
  /** Similarity weight = 1 − perBathroom × |Δbathrooms| − sqftPenalty (if sizes differ > sqftTolerance). */
  similarity: { perBathroom: 0.15, sqftPenalty: 0.1, sqftTolerance: 0.25 },
  /**
   * Building type and age, as weight multipliers; unknown on either side → 1. A basement vs an
   * above-ground unit; year built within sameEraYears → sameEraBoost, apart by more than
   * differentEraYears → differentEra.
   */
  buildingSimilarity: {
    basementMismatch: 0.3,
    sameEraYears: 10,
    sameEraBoost: 1.5,
    differentEraYears: 30,
    differentEra: 0.5,
  },
  /** One building's floor plans count as at most this many comparables (weight and counts). */
  maxPerBuilding: 2,
  /** Bathrooms may differ by at most this much. */
  maxBathroomDifference: 1,
  /** Confidence from comparable count and spread (IQR / median). */
  confidence: {
    high: { minCount: 12, maxSpread: 0.15 },
    medium: { minCount: 8, maxSpread: 0.25 },
  },
  /** Price label band in percent, by confidence. Low confidence gets the wider band. */
  labelBandPct: { high: 10, medium: 10, low: 15 },
} as const;

/** Caveats (SPEC 7.7). Owner: C. */
export const CAVEATS = {
  /** rent_far_below: listed more than this many percent below the comparable estimate. */
  farBelowPct: 30,
  /** stale: not seen for this many days (status 'stale' starts at day 8). */
  staleDays: 8,
  /** fields_unknown: shown when at least this many of utilities, pets, laundry, parking, AC are unknown. */
  minUnknownFields: 2,
  /** rentsafeto_low: below the City's threshold for yearly evaluation. */
  rentSafeToLowScore: 66,
  /** price_dropped: the asking rent is at least this much below the first one seen. */
  priceDropMinCad: 25,
  /**
   * newer_building: built within this many years, and less than newerBuildingSameEraShare of the
   * comparables' weight is from buildings known to be of a similar age.
   */
  newerBuildingYears: 10,
  newerBuildingSameEraShare: 0.3,
} as const;

/** Safety preference (SPEC 7.6). Owner: D. */
export const SAFETY = {
  /** The five Major Crime Indicators combined into one rate, as TPS indicator ids. */
  majorTypes: ["assault", "autotheft", "breakenter", "robbery", "theftover"] as const,
  /** relativeRate at or below this scores 100. */
  fullScoreAt: 0.5,
  /** relativeRate at or above this scores 0; linear in between (the city average scores 67). */
  zeroScoreAt: 2,
  /** "Below the city rate" must-have keeps relativeRate at or below this. */
  hardMaxRelativeRate: 1,
} as const;
