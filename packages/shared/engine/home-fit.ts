import type { Listing, SearchIntent } from '../schemas/index';
import { engineConfig } from './config';
import { clamp } from './travel';
type Range = { min?: number; max?: number };
const outside = (value: number, range: Range) => Math.max((range.min ?? value) - value, value - (range.max ?? value), 0);
export const roomsScore = (value: number, range: Range) => outside(value, range) === 0 ? 100 : outside(value, range) <= 1 ? 50 : 0;
export function sizeScore(value: number, range: Range): number {
  const boundary = value < (range.min ?? value) ? range.min! : range.max ?? value;
  return outside(value, range) ? clamp(100 * (1 - outside(value, range) / (boundary * engineConfig.sizeOverrun))) : 100;
}
export function unitTypeMatch(listing: Listing, types: NonNullable<SearchIntent['criteria']['unitTypes']>['value']): boolean | null {
  if (listing.unitType === null) return listing.rentIsPerRoom ? types.includes('room') : null;
  if (types.includes(listing.unitType)) return true;
  if (!types.includes('studio') || listing.unitType === 'room' || listing.rentIsPerRoom) return false;
  return listing.bedrooms === null ? null : listing.bedrooms === 0;
}
/** "Can't tell": between a confirmed match (100) and a confirmed miss (0). Never a must-have failure. */
const UNKNOWN_SCORE = 50;
export function homeCriteria(listing: Listing, intent: SearchIntent): { name: string; hard: boolean; score: number | null; matches: boolean | null }[] {
  const result: ReturnType<typeof homeCriteria> = [];
  const add = (name: string, hard: boolean, score: number | null, matches: boolean | null) => result.push({ name, hard, score, matches });
  // A known score confirms a must-have only at 100. Unknown stays null on matches so the filter can keep it.
  const judge = (score: number | null) => score === null ? { score: UNKNOWN_SCORE, matches: null } : { score, matches: score === 100 };
  const c = intent.criteria;
  for (const name of ['bedrooms', 'bathrooms', 'sizeSqft'] as const) {
    const pref = c[name];
    if (!pref) continue;
    const value = listing[name === 'sizeSqft' ? 'sqft' : name];
    const roomExcluded = name === 'bedrooms' && (listing.unitType === 'room' || listing.rentIsPerRoom) && !c.unitTypes?.value.includes('room');
    if (roomExcluded) add(name, pref.hard, 0, false);
    else { const judged = judge(value === null ? null : name === 'sizeSqft' ? sizeScore(value, pref.value) : roomsScore(value, pref.value)); add(name, pref.hard, judged.score, judged.matches); }
  }
  if (c.unitTypes) { const match = unitTypeMatch(listing, c.unitTypes.value); const judged = judge(match === null ? null : match ? 100 : 0); add('unitTypes', c.unitTypes.hard, judged.score, judged.matches); }
  if (c.buildingAge) { const judged = judge(listing.yearBuilt === null ? null : clamp(100 * (1 - outside(listing.yearBuilt, { min: c.buildingAge.value.builtAfter, max: c.buildingAge.value.builtBefore }) / engineConfig.ageOverrunYears))); add('buildingAge', c.buildingAge.hard, judged.score, judged.matches); }
  if (c.airConditioning) { const judged = judge(listing.airConditioning === 'unknown' ? null : listing.airConditioning === 'central' ? 100 : listing.airConditioning === 'yes' ? c.airConditioning.value === 'any' ? 100 : 60 : 0); add('airConditioning', c.airConditioning.hard, judged.score, judged.matches); }
  if (c.petsAllowed) { const judged = judge(listing.petsAllowed === 'unknown' ? null : listing.petsAllowed === 'yes' || c.petsAllowed.value === 'any' && listing.petsAllowed !== 'no' || listing.petsAllowed === `${c.petsAllowed.value}_only` ? 100 : 0); add('petsAllowed', c.petsAllowed.hard, judged.score, judged.matches); }
  for (const name of ['furnished', 'parking', 'laundryInSuite', 'utilitiesIncluded'] as const) {
    const pref = c[name];
    // Partly included utilities half-match either way, and never pass a must-have. Unknown is 50 and unconfirmed.
    if (!pref) continue;
    if (listing[name] === 'unknown') add(name, pref.hard, UNKNOWN_SCORE, null);
    else if (listing[name] === 'partial') add(name, pref.hard, 50, false);
    else add(name, pref.hard, (listing[name] === 'yes') === pref.value ? 100 : 0, (listing[name] === 'yes') === pref.value);
  }
  if (c.availableBy) { const judged = judge(listing.availableFrom === null ? null : clamp(100 * (1 - Math.max(0, Date.parse(listing.availableFrom) - Date.parse(c.availableBy.value)) / (engineConfig.availabilityOverrunDays * 86400000)))); add('availableBy', c.availableBy.hard, judged.score, judged.matches); }
  if (c.leaseTerm) { const judged = judge(listing.leaseTerm === null ? null : listing.leaseTerm === c.leaseTerm.value ? 100 : 0); add('leaseTerm', c.leaseTerm.hard, judged.score, judged.matches); }
  return result;
}
export function homeFit(listing: Listing, intent: SearchIntent): number | null {
  const scores = homeCriteria(listing, intent).filter(v => !v.hard && v.score !== null).map(v => v.score!);
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
}
