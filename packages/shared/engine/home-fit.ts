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
export function homeCriteria(listing: Listing, intent: SearchIntent): { name: string; hard: boolean; score: number | null; matches: boolean | null }[] {
  const result: ReturnType<typeof homeCriteria> = [];
  const add = (name: string, hard: boolean, score: number | null, matches = score === null ? null : score === 100) => result.push({ name, hard, score, matches });
  const c = intent.criteria;
  for (const name of ['bedrooms', 'bathrooms', 'sizeSqft'] as const) {
    const pref = c[name];
    if (!pref) continue;
    const value = listing[name === 'sizeSqft' ? 'sqft' : name];
    const roomExcluded = name === 'bedrooms' && (listing.unitType === 'room' || listing.rentIsPerRoom) && !c.unitTypes?.value.includes('room');
    add(name, pref.hard, roomExcluded ? 0 : value === null ? null : name === 'sizeSqft' ? sizeScore(value, pref.value) : roomsScore(value, pref.value));
  }
  if (c.unitTypes) { const match = unitTypeMatch(listing, c.unitTypes.value); add('unitTypes', c.unitTypes.hard, match === null ? null : match ? 100 : 0); }
  if (c.buildingAge) add('buildingAge', c.buildingAge.hard, listing.yearBuilt === null ? null : clamp(100 * (1 - outside(listing.yearBuilt, { min: c.buildingAge.value.builtAfter, max: c.buildingAge.value.builtBefore }) / engineConfig.ageOverrunYears)));
  if (c.airConditioning) add('airConditioning', c.airConditioning.hard, listing.airConditioning === 'unknown' ? null : listing.airConditioning === 'central' ? 100 : listing.airConditioning === 'yes' ? c.airConditioning.value === 'any' ? 100 : 60 : 0);
  if (c.petsAllowed) add('petsAllowed', c.petsAllowed.hard, listing.petsAllowed === 'unknown' ? null : listing.petsAllowed === 'yes' || c.petsAllowed.value === 'any' && listing.petsAllowed !== 'no' || listing.petsAllowed === `${c.petsAllowed.value}_only` ? 100 : 0);
  for (const name of ['furnished', 'parking', 'laundryInSuite', 'utilitiesIncluded'] as const) {
    const pref = c[name];
    if (pref) add(name, pref.hard, listing[name] === 'unknown' ? null : (listing[name] === 'yes') === pref.value ? 100 : 0);
  }
  if (c.availableBy) add('availableBy', c.availableBy.hard, listing.availableFrom === null ? null : clamp(100 * (1 - Math.max(0, Date.parse(listing.availableFrom) - Date.parse(c.availableBy.value)) / (engineConfig.availabilityOverrunDays * 86400000))));
  if (c.leaseTerm) add('leaseTerm', c.leaseTerm.hard, listing.leaseTerm === null ? null : listing.leaseTerm === c.leaseTerm.value ? 100 : 0);
  return result;
}
export function homeFit(listing: Listing, intent: SearchIntent): number | null {
  const scores = homeCriteria(listing, intent).filter(v => !v.hard && v.score !== null).map(v => v.score!);
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
}
