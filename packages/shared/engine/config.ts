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
} as const;
