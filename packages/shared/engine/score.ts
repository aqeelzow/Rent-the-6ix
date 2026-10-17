import type { Listing, SearchIntent, Valuation, TravelTimeRow, Safety, MatchScore, Caveat, NumericExtreme } from '../schemas/index';
import { CAVEATS, engineConfig } from './config';
import { filterListing } from './filters';
import { homeFit, homeCriteria } from './home-fit';
import { clamp, travelScore, targetModes, defaultMinutes } from './travel';
// D computes the optional score; this is a composition input, not D's exported Safety shape.
export type ScoreContext = { valuation: Valuation; travel: TravelTimeRow[]; safety: Safety | null; safetyScore?: number | null; caveats?: Caveat[] };
export function scoreListing(listing: Listing, intent: SearchIntent, context: ScoreContext): MatchScore {
  if (context.safetyScore != null && (!Number.isFinite(context.safetyScore) || context.safetyScore < 0 || context.safetyScore > 100)) throw new Error('Owner safety score must be between 0 and 100');
  const weights = { ...engineConfig.weights, ...(intent.criteria.priceFairness && !intent.criteria.priceFairness.hard ? { value: engineConfig.fairnessWeight } : {}), ...(intent.safety.enabled ? { safety: engineConfig.safetyWeight } : {}), ...intent.weights };
  if (!intent.safety.enabled) weights.safety = 0;
  const rent = intent.criteria.rent;
  const max = rent?.value.max;
  const scores = {
    // C's rent_far_below guard: an unusually low asking rent needs verification, not a maximum value score.
    value: context.valuation.status === 'ok' && context.valuation.differencePct !== undefined && context.valuation.differencePct <= CAVEATS.farBelowPct ? clamp(50 + context.valuation.differencePct * 2.5) : null,
    price: rent && !rent.hard ? max === undefined || listing.monthlyRentCad <= max ? 100 : clamp(100 * (1 - (listing.monthlyRentCad - max) / (max * engineConfig.priceOverrun))) : null,
    travel: travelScore(intent.travelTargets, context.travel), home: homeFit(listing, intent),
    safety: intent.safety.enabled && context.safety?.relativeRate != null ? context.safetyScore ?? null : null,
  };
  const sum = (Object.keys(scores) as (keyof typeof scores)[]).reduce((n, key) => n + (scores[key] === null ? 0 : weights[key]), 0);
  const evidence: Record<keyof typeof scores, string[]> = {
    value: [`Comparable asking rents: ${Math.abs(context.valuation.differencePct ?? 0)}% ${(context.valuation.differencePct ?? 0) < 0 ? 'above' : 'below'} estimate; ${context.valuation.comparableCount} comparables; ${context.valuation.confidence} confidence`],
    price: [`Rent CAD/month ${listing.monthlyRentCad}; preferred range ${rent?.value.min ?? 'unbounded'}–${rent?.value.max ?? 'unbounded'}`],
    home: homeCriteria(listing, intent).filter(c => !c.hard && c.score !== null).map(c => `${c.name}: listing ${JSON.stringify(c.name === 'buildingAge' ? listing.yearBuilt : c.name === 'sizeSqft' ? listing.sqft : c.name === 'availableBy' ? listing.availableFrom : c.name === 'unitTypes' ? { unitType: listing.unitType, bedrooms: listing.bedrooms, rentIsPerRoom: listing.rentIsPerRoom } : listing[c.name as keyof Listing])}; preferred ${JSON.stringify(intent.criteria[c.name as keyof SearchIntent['criteria']]?.value)}; score ${c.score}`),
    travel: intent.travelTargets.flatMap(t => context.travel.filter(r => r.targetId === t.id && targetModes(t).includes(r.mode)).map(r => `${t.label}: ${r.mode === 'drive' ? 'driving, no traffic' : r.mode}; ${r.method === 'otp' ? `${r.minutes} minutes (OTP)` : `${Math.round(r.distanceM)} m straight-line distance, travel time not available`}; target ${t.maxMinutes ?? defaultMinutes(t, r.mode)} minutes`)),
    safety: context.safety ? [`Neighbourhood police-reported rate: ${context.safety.relativeRate}× city rate; years ${context.safety.years.join(', ')}; owner-supplied score`] : [],
  };
  const parts = (Object.keys(scores) as (keyof typeof scores)[]).map(id => ({ id, score: scores[id], weight: weights[id], effectiveWeight: scores[id] === null || !sum ? 0 : weights[id] / sum, evidence: scores[id] === null ? [] : evidence[id] }));
  return { total: Math.round(parts.reduce((n, part) => n + (part.score ?? 0) * part.effectiveWeight, 0)), parts, hardFilterNotes: filterListing(listing, intent, context).notes, caveats: [...context.caveats ?? [], ...intent.safety.enabled ? context.safety?.caveats ?? [] : []] };
}
export function tieBreak(a: Listing, b: Listing) { return Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt) || a.monthlyRentCad - b.monthlyRentCad; }
export function selectPercentile(listings: readonly Listing[], selector: NumericExtreme, referenceYear: number, travelMinutes: (listing: Listing) => number | null = () => null): Listing[] {
  if (!Number.isInteger(referenceYear)) throw new Error('A reference year is required for building ages');
  const known = listings.flatMap(listing => {
    const value = selector.field === 'rent' ? listing.monthlyRentCad : selector.field === 'sizeSqft' ? listing.sqft : selector.field === 'buildingAge' ? listing.yearBuilt === null ? null : referenceYear - listing.yearBuilt : selector.field === 'travel' ? travelMinutes(listing) : listing[selector.field];
    return value === null || !Number.isFinite(value) ? [] : [{ listing, value }];
  }).sort((a, b) => (selector.direction === 'min' ? a.value - b.value : b.value - a.value) || tieBreak(a.listing, b.listing));
  return known.slice(0, Math.min(known.length, Math.max(selector.minimumCount ?? 10, Math.ceil(known.length * selector.percentage / 100)))).map(row => row.listing);
}
