import { AreaSchema, DetailResponseSchema, ListingSchema, MatchScoreSchema, SearchIntentSchema, SearchResponseSchema, ValuationSchema, type Listing, type SearchResult } from '../schemas/index';

export const fixtureTimestamp = '2026-10-16T12:00:00Z';
const areaNames = ['Synthetic Central', 'Synthetic East', 'Synthetic Ward'];
export const areas = areaNames.map((name, i) => AreaSchema.parse({
  id: i === 2 ? 'demo-ward' : `demo-neighbourhood-${i}`, kind: i === 2 ? 'ward' : 'neighbourhood', name,
  ...(i === 2 ? { number: 99 } : {}),
  // shortcut: these rectangles are synthetic, replace with D's civic boundaries for live integration.
  geometry: { type: 'MultiPolygon', coordinates: [[[[-79.45 + i * .04, 43.64], [-79.41 + i * .04, 43.64], [-79.41 + i * .04, 43.68], [-79.45 + i * .04, 43.68], [-79.45 + i * .04, 43.64]]]] },
}));

export const listings: Listing[] = Array.from({ length: 50 }, (_, i) => {
  const unknown = i % 7 === 0;
  const room = i % 6 === 5;
  return ListingSchema.parse({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, source: 'manual', sourceListingId: `synthetic-${i + 1}`,
    sourceUrl: `https://example.invalid/synthetic/${i + 1}`, title: `Synthetic demo home ${i + 1}`, excerpt: 'Synthetic test data; this home is not offered for rent.',
    monthlyRentCad: i === 1 ? 1250 : 1200 + i * 75, rentIsPerRoom: room, bedrooms: unknown ? null : i === 1 ? 0 : room ? 1 : i % 4, bathrooms: unknown ? null : 1 + i % 3 * .5,
    unitType: unknown ? null : (['apartment', 'condo', 'basement', 'house', 'townhouse', 'room'] as const)[i % 6], sqft: unknown ? null : 400 + i * 20,
    yearBuilt: unknown ? null : 1960 + i, yearBuiltSource: unknown ? null : 'listing', airConditioning: (['unknown', 'central', 'yes', 'no'] as const)[i % 4],
    location: i === 3 ? { lng: -79.25, lat: 43.75 } : { lng: -79.43 + i % 10 * .006, lat: 43.65 + Math.floor(i / 10) * .005 }, locationPrecision: (['area', 'exact', 'street'] as const)[i % 3],
    addressText: null, addressPointId: null, buildingId: null, neighbourhoodId: `demo-neighbourhood-${i % 2}`, wardId: 'demo-ward',
    utilitiesIncluded: unknown ? 'unknown' : i % 2 ? 'yes' : 'no', parking: unknown ? 'unknown' : i === 3 ? 'yes' : 'no', petsAllowed: unknown ? 'unknown' : (['yes', 'no', 'cats_only', 'dogs_only'] as const)[i % 4],
    furnished: unknown ? 'unknown' : i === 1 ? 'yes' : 'no', laundryInSuite: unknown ? 'unknown' : 'yes', availableFrom: unknown ? null : '2026-11-01', leaseTerm: unknown ? null : '12_months', imageUrl: null,
    firstSeenAt: '2026-10-01T12:00:00Z', lastSeenAt: fixtureTimestamp, updatedAt: fixtureTimestamp,
    status: 'active', duplicateOf: null, dataStatus: 'demo', fieldEvidence: unknown ? {} : { bedrooms: 'structured', yearBuilt: 'parsed_from_text' },
  });
});
export const sampleListings = listings.slice(0, 8);
export const baseIntent = SearchIntentSchema.parse({ schemaVersion: 1, rawPrompt: '', areas: [], criteria: {}, travelTargets: [], safety: { enabled: false, hard: false }, sortBy: 'best_match', fieldSources: {}, droppedRequests: [] });
export const travelIntent = SearchIntentSchema.parse({ ...baseIntent, rawPrompt: 'Synthetic: bike or walk within 10 minutes to campus', travelTargets: [{ id: 'campus', kind: 'place', label: 'Synthetic campus representative point', query: 'Synthetic campus', resolved: { lng: -79.4, lat: 43.66, source: 'known_place', representativePoint: true, label: 'Synthetic campus centre' }, mode: 'bike', alternativeModes: ['walk'], maxMinutes: 10, hard: true }] });
export const safetyIntent = SearchIntentSchema.parse({ ...baseIntent, rawPrompt: 'Synthetic: consider police-reported rates', safety: { enabled: true, hard: false } });
const caveat = { severity: 'info' as const, code: 'synthetic_data', title: 'Synthetic demonstration', explanation: 'These invented numbers demonstrate data states only.' };
const safetyCaveats = [caveat, ...[
  'Reported crimes only.', 'Per-resident rates may overstate resident exposure in places with many visitors or workers.',
  'TPS offsets locations; boundaries may be misassigned.', 'Neighbourhood averages do not describe a particular street or building.', 'These data describe places, not residents.',
].map((explanation, i) => ({ severity: 'info' as const, code: `safety_context_${i}`, title: 'Police-reported rate context', explanation }))];
const benchmark = { label: 'Synthetic asking-rent benchmark', valueCad: 2500, period: 'Synthetic 2026 Q4', sourceId: 'synthetic' };
export const valuations = (['underpriced', 'reasonable', 'overpriced', 'unknown'] as const).map((priceLabel, i) => {
  const differencePct = [15, 0, -15, 0][i];
  return ValuationSchema.parse({ status: i === 3 ? 'insufficient_data' : 'ok', ...(i === 3 ? {} : { estimatedRentCad: 2500, lowCad: 2300, highCad: 2700, differenceCad: 25 * differencePct, differencePct }),
    priceLabel, comparableCount: i === 3 ? 0 : 5, effectiveCount: i === 3 ? 0 : 5, radiusM: 1000, windowDays: 60, confidence: 'low',
    comparables: i === 3 ? [] : listings.slice(10, 15).map(l => ({ listingId: l.id, rentCad: l.monthlyRentCad, adjustedRentCad: 2500, distanceM: 500, weight: 1, lastSeenAt: fixtureTimestamp })),
    adjustments: [], benchmark, method: 'Synthetic fixture, not a valuation computation',
  });
});
function result(listing: Listing, i: number, withSafety = false): SearchResult {
  const base = valuations[i % valuations.length];
  const estimate = listing.monthlyRentCad / (1 - (base.differencePct ?? 0) / 100);
  const valuation = base.status === 'ok' ? ValuationSchema.parse({ ...base, estimatedRentCad: estimate, lowCad: estimate * .92, highCad: estimate * 1.08, differenceCad: estimate - listing.monthlyRentCad }) : base;
  const value = valuation.status === 'ok' ? Math.max(0, Math.min(100, 50 + valuation.differencePct! * 2.5)) : null;
  const parts = [
    { id: 'value' as const, score: value, weight: 30 }, { id: 'price' as const, score: null, weight: 15 },
    { id: 'travel' as const, score: 100, weight: 30 }, { id: 'home' as const, score: null, weight: 25 }, { id: 'safety' as const, score: withSafety ? 80 : null, weight: withSafety ? 15 : 0 },
  ];
  const sum = parts.reduce((n, p) => n + (p.score === null ? 0 : p.weight), 0);
  const weighted = parts.map(p => ({ ...p, effectiveWeight: p.score === null ? 0 : p.weight / sum, evidence: p.score === null ? [] : ['Synthetic illustrative evidence'] }));
  return { listing, valuation, travel: [{ listingId: listing.id, targetId: 'campus', mode: 'bike', distanceM: 600, poiId: null, computedAt: fixtureTimestamp, method: i % 2 ? 'otp' : 'straight_line', minutes: i % 2 ? 8 : null }],
    safety: withSafety && listing.neighbourhoodId ? { areaId: listing.neighbourhoodId, rate: 700, relativeRate: .8, byType: { assault: 700 }, years: [2023, 2024, 2025], caveats: safetyCaveats } : null,
    matchScore: MatchScoreSchema.parse({ total: Math.round(weighted.reduce((n, p) => n + (p.score ?? 0) * p.effectiveWeight, 0)), parts: weighted, hardFilterNotes: i % 2 ? [] : ['Travel time: not confirmed'], caveats: [caveat] }),
  };
}
export const searchFixture = SearchResponseSchema.parse({ status: 'completed', results: sampleListings.map((l, i) => result(l, i)), eligibleCount: 50, notices: ['Synthetic fixture; not live listings'] });
export const safetySearchFixture = SearchResponseSchema.parse({ status: 'completed', results: [result(listings[1], 1, true)], eligibleCount: 1, notices: ['Synthetic safety-enabled demonstration'] });
export const detailFixture = DetailResponseSchema.parse({ ...result(listings[1], 1), areas: [areas[1], areas[2]], indicators: [{ areaId: areas[1].id, indicatorId: 'listing_count_30d', value: 25, unit: 'listings', period: 'Synthetic 2026-10', sourceId: 'synthetic', sampleSize: 25 }], duplicates: [] });
