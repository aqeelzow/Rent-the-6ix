import type { Listing, SearchIntent, Safety, TravelTimeRow, Valuation, AreaFilter } from '../schemas/index';
import { homeCriteria } from './home-fit';
import { distanceM, evaluateTarget } from './travel';
import { SAFETY } from './config';
export type FilterContext = { valuation?: Valuation; travel?: TravelTimeRow[]; safety?: Safety | null };
function areaMatches(listing: Listing, area: AreaFilter): boolean | null {
  if (area.kind === 'neighbourhood') return listing.neighbourhoodId === null ? null : listing.neighbourhoodId === area.id;
  if (area.kind === 'ward') return listing.wardId === null ? null : listing.wardId === area.id;
  if (area.kind === 'near') return distanceM(listing.location, area.point) <= area.radiusM;
  const [west, south, east, north] = area.bounds;
  return listing.location.lng >= west && listing.location.lng <= east && listing.location.lat >= south && listing.location.lat <= north;
}
export function filterListing(listing: Listing, intent: SearchIntent, context: FilterContext = {}, hideUnconfirmed = false, cheapOnly = false) {
  const notes: string[] = [];
  let passes = listing.status === 'active' && listing.duplicateOf === null;
  const check = (name: string, matches: boolean | null) => { if (matches === null) notes.push(`${name}: not confirmed`); else if (!matches) passes = false; };
  if (intent.areas.length) {
    const matches = intent.areas.map(area => areaMatches(listing, area));
    check('area', matches.includes(true) ? true : matches.includes(null) ? null : false);
  }
  const rent = intent.criteria.rent;
  if (rent?.hard) check('rent', listing.monthlyRentCad >= (rent.value.min ?? 0) && listing.monthlyRentCad <= (rent.value.max ?? Infinity));
  for (const criterion of homeCriteria(listing, intent)) if (criterion.hard) check(criterion.name, criterion.matches);
  if (!cheapOnly) {
    const fairness = intent.criteria.priceFairness;
    if (fairness?.hard) check('priceFairness', !context.valuation || context.valuation.priceLabel === 'unknown' ? null : fairness.value.includes(context.valuation.priceLabel));
    // The renter's limit from the safety slider, else D's default (the city rate).
    if (intent.safety.enabled && intent.safety.hard) check('safety', context.safety?.relativeRate == null ? null : context.safety.relativeRate <= (intent.safety.maxRelativeRate ?? SAFETY.hardMaxRelativeRate));
    for (const target of intent.travelTargets) if (target.hard) {
      const state = evaluateTarget(target, context.travel ?? [], listing.location).state;
      if (state === 'unknown') notes.push(`Location for ${target.label}: unavailable`);
      else if (state === 'fail') passes = false;
    }
  }
  return { passes: passes && (!hideUnconfirmed || !notes.length), notes };
}
