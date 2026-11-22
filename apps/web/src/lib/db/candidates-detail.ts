import { getClient } from '../db';
import { AreaSchema, AreaIndicatorSchema, ListingSchema } from '../../../../../packages/shared/schemas/index';
import { SearchUnavailable, type SearchDependencies } from './candidates';
import { candidateColumns, listingFromRow } from './candidates-sql';

type Client = { unsafe: (statement: string, parameters: (string | number | boolean | null)[]) => PromiseLike<unknown> };
const rows = (input: unknown): Record<string, unknown>[] => {
  if (!Array.isArray(input) || input.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw Error('Invalid detail rows');
  return input;
};
export function sqlDetailLoader(client: () => Client | null = getClient): NonNullable<SearchDependencies['loadDetail']> {
  return async (input, intent) => {
    try {
      const listing = ListingSchema.parse(input), sql = client();
      if (!sql) throw Error('Database unavailable');
      const [areaRows, indicatorRows, duplicateRows] = await Promise.all([
        sql.unsafe(`SELECT id, 'neighbourhood' AS kind, name, number, ST_AsGeoJSON(geometry)::json AS geometry FROM neighbourhoods WHERE id = $1`, [listing.neighbourhoodId]),
        // Crime indicators obey the same explicit opt-in as the owner safety result.
        sql.unsafe(`SELECT area_id, indicator_id, value, unit, period, source_id, sample_size, note FROM area_indicators
          WHERE area_kind = 'neighbourhood' AND area_id = $1
          AND source_id IS NOT NULL AND unit IS NOT NULL AND ($2 OR indicator_id !~ '^crime[:_]')
          ORDER BY indicator_id, period`, [listing.neighbourhoodId, intent.safety.enabled]),
        sql.unsafe(`SELECT ${candidateColumns} FROM listings WHERE duplicate_of = $1 ORDER BY last_seen_at DESC, id`, [listing.id]),
      ]);
      return {
        areas: rows(areaRows).map(row => AreaSchema.parse({ id: row.id, kind: row.kind, name: row.name, ...(row.number == null ? {} : { number: row.number }), geometry: row.geometry })),
        indicators: rows(indicatorRows).map(row => AreaIndicatorSchema.parse({ areaId: row.area_id, indicatorId: row.indicator_id, value: row.value, unit: row.unit, period: row.period, sourceId: row.source_id, ...(row.sample_size == null ? {} : { sampleSize: row.sample_size }), ...(row.note == null ? {} : { note: row.note }) })),
        duplicates: rows(duplicateRows).map(listingFromRow),
      };
    } catch { throw new SearchUnavailable('Listing details are unavailable'); }
  };
}
