import { getClient } from '../db';
import { z } from 'zod';
import { ListingSchema, SearchRequestSchema, type Listing, type SearchRequest } from '../../../../../packages/shared/schemas/index';
import { filterListing } from '../../../../../packages/shared/engine/filters';
import { SearchUnavailable, type SearchDependencies } from './candidates';

type Client = { unsafe: (statement: string, parameters: (string | number | boolean)[]) => PromiseLike<unknown> };
const columns = ['id', 'source', 'sourceListingId', 'sourceUrl', 'title', 'excerpt', 'monthlyRentCad', 'rentIsPerRoom', 'bedrooms', 'bathrooms', 'unitType', 'sqft', 'yearBuilt', 'yearBuiltSource', 'airConditioning', 'locationPrecision', 'addressText', 'addressPointId', 'buildingId', 'neighbourhoodId', 'wardId', 'utilitiesIncluded', 'parking', 'petsAllowed', 'furnished', 'laundryInSuite', 'availableFrom', 'leaseTerm', 'imageUrl', 'firstSeenAt', 'lastSeenAt', 'updatedAt', 'status', 'duplicateOf', 'dataStatus', 'fieldEvidence'] as const;
// shortcut: retain at most eight unfinished reads after caller cancellation; use cancellable connections for higher production load.
let candidateReadsInFlight = 0;
const snake = (value: string) => value.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
export const candidateColumns = `${columns.map(snake).join(', ')}, ST_X(location::geometry) AS lng, ST_Y(location::geometry) AS lat`;
const numeric = (value: unknown) => typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : value;
export function listingFromRow(input: unknown): Listing {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('Invalid listing row');
  const row = input as Record<string, unknown>;
  const listing: Record<string, unknown> = Object.fromEntries(columns.map(key => [key, row[snake(key)]]));
  listing.excerpt ??= '';
  for (const key of ['utilitiesIncluded', 'parking', 'petsAllowed', 'furnished', 'laundryInSuite']) listing[key] ??= 'unknown';
  for (const key of ['monthlyRentCad', 'bedrooms', 'bathrooms', 'sqft', 'yearBuilt']) listing[key] = numeric(listing[key]);
  for (const key of ['firstSeenAt', 'lastSeenAt', 'updatedAt', 'availableFrom']) if (listing[key] instanceof Date) listing[key] = key === 'availableFrom' ? listing[key].toISOString().slice(0, 10) : listing[key].toISOString();
  listing.location = { lng: numeric(row.lng), lat: numeric(row.lat) };
  return ListingSchema.parse(listing);
}

// Only fixed column names enter SQL; every request value is a separate postgres parameter.
export function candidateQuery(input: SearchRequest) {
  const request = SearchRequestSchema.parse(input), { criteria: c, areas } = request.intent;
  const parameters: (string | number | boolean)[] = [];
  const bind = (value: string | number | boolean) => { parameters.push(value); return `$${parameters.length}`; };
  const gates = ["status = 'active'", 'duplicate_of IS NULL'];
  const known = (column: string, matches: string, tri = false) => gates.push(request.hideUnconfirmed ? `(${column} IS NOT NULL${tri ? ` AND ${column} <> 'unknown'` : ''} AND (${matches}))` : `(${column} IS NULL${tri ? ` OR ${column} = 'unknown'` : ''} OR (${matches}))`);
  const range = (column: string, value: { min?: number; max?: number }) => [value.min === undefined ? '' : `${column} >= ${bind(value.min)}`, value.max === undefined ? '' : `${column} <= ${bind(value.max)}`].filter(Boolean).join(' AND ');
  if (c.rent?.hard) gates.push(`(${range('monthly_rent_cad', c.rent.value)})`);
  for (const [name, column] of [['bedrooms', 'bedrooms'], ['bathrooms', 'bathrooms'], ['sizeSqft', 'sqft']] as const) if (c[name]?.hard) {
    if (name === 'bedrooms' && !c.unitTypes?.value.includes('room')) gates.push("unit_type IS DISTINCT FROM 'room' AND rent_is_per_room = false");
    known(column, range(column, c[name].value));
  }
  if (c.unitTypes?.hard) {
    const types = c.unitTypes.value;
    const direct = types.filter(type => type !== 'studio').map(type => `unit_type = ${bind(type)}`);
    if (types.includes('studio')) direct.push("(unit_type IS NOT NULL AND unit_type <> 'room' AND rent_is_per_room = false AND bedrooms = 0)");
    const unknown = [types.includes('room') ? 'unit_type IS NULL' : '(unit_type IS NULL AND rent_is_per_room = false)'];
    if (types.includes('studio')) unknown.push("(unit_type IS NOT NULL AND unit_type <> 'room' AND rent_is_per_room = false AND bedrooms IS NULL)");
    gates.push(`(${direct.join(' OR ') || 'false'}${request.hideUnconfirmed ? '' : ` OR ${unknown.join(' OR ')}`}${types.includes('room') ? " OR (unit_type IS NULL AND rent_is_per_room = true)" : ''})`);
  }
  if (c.buildingAge?.hard) known('year_built', range('year_built', { min: c.buildingAge.value.builtAfter, max: c.buildingAge.value.builtBefore }));
  if (c.airConditioning?.hard) known('air_conditioning', c.airConditioning.value === 'central' ? "air_conditioning = 'central'" : "air_conditioning IN ('central', 'yes')", true);
  if (c.petsAllowed?.hard) known('pets_allowed', c.petsAllowed.value === 'any' ? "pets_allowed IN ('yes', 'cats_only', 'dogs_only')" : `pets_allowed IN ('yes', ${bind(`${c.petsAllowed.value}_only`)})`, true);
  for (const name of ['furnished', 'parking', 'laundryInSuite', 'utilitiesIncluded'] as const) if (c[name]?.hard) known(snake(name), `${snake(name)} = ${bind(c[name].value ? 'yes' : 'no')}`, true);
  if (c.availableBy?.hard) known('available_from', `available_from <= ${bind(c.availableBy.value)}::date`);
  if (c.leaseTerm?.hard) known('lease_term', `lease_term = ${bind(c.leaseTerm.value)}`);
  if (areas.length) gates.push(`(${areas.map(area => {
    if (area.kind === 'neighbourhood' || area.kind === 'ward') {
      const column = area.kind === 'ward' ? 'ward_id' : 'neighbourhood_id';
      return `(${column} = ${bind(area.id)}${request.hideUnconfirmed ? '' : ` OR ${column} IS NULL`})`;
    }
    // PostGIS spheroid distance differs at the cutoff; existing haversine verification is authoritative.
    if (area.kind === 'near') return 'true';
    const [west, south, east, north] = area.bounds;
    return `(ST_X(location::geometry) BETWEEN ${bind(west)} AND ${bind(east)} AND ST_Y(location::geometry) BETWEEN ${bind(south)} AND ${bind(north)})`;
  }).join(' OR ')})`);
  return { statement: `SELECT ${candidateColumns} FROM listings WHERE ${gates.join(' AND ')} ORDER BY last_seen_at DESC, id`, parameters };
}

export function sqlCandidateLoader(client: () => Client | null = getClient): NonNullable<SearchDependencies['loadCandidates']> {
  return async (input, signal) => {
    const request = SearchRequestSchema.parse(input);
    if (signal?.aborted) throw new SearchUnavailable('Candidate loading cancelled');
    const { statement, parameters } = candidateQuery(request);
    let abort: (() => void) | undefined;
    try {
      if (candidateReadsInFlight >= 8) throw new SearchUnavailable('Candidate read already in progress');
      const sql = client();
      if (!sql) throw new SearchUnavailable('Database is unavailable');
      const cancelled = new Promise<never>((_resolve, reject) => { abort = () => reject(new SearchUnavailable('Candidate loading cancelled')); signal?.addEventListener('abort', abort, { once: true }); });
      // shortcut: ignore late shared-client reads after abort; use dedicated cancellable connections if production query load requires it.
      const operation = Promise.resolve(sql.unsafe(statement, parameters));
      candidateReadsInFlight++;
      const rows = await Promise.race([operation.finally(() => { candidateReadsInFlight--; }), cancelled]);
      if (signal?.aborted) throw new SearchUnavailable('Candidate loading cancelled');
      if (!Array.isArray(rows)) throw new Error('Invalid candidate rows');
      return rows.map(listingFromRow).filter(listing => filterListing(listing, request.intent, {}, request.hideUnconfirmed, true).passes);
    } catch { throw new SearchUnavailable('Candidate data is unavailable'); }
    finally { if (abort) signal?.removeEventListener('abort', abort); }
  };
}

export function sqlListingLoader(client: () => Client | null = getClient): NonNullable<SearchDependencies['loadListing']> {
  return async id => {
    const listingId = z.uuid().parse(id);
    try {
      const sql = client();
      if (!sql) throw new SearchUnavailable('Database is unavailable');
      const rows = await sql.unsafe(`SELECT ${candidateColumns} FROM listings WHERE id = $1`, [listingId]);
      if (!Array.isArray(rows)) throw new Error('Invalid listing rows');
      return rows.length ? listingFromRow(rows[0]) : null;
    } catch { throw new SearchUnavailable('Listing data is unavailable'); }
  };
}
