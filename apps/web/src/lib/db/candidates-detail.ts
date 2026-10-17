import { getClient } from '../db';
import { AreaSchema, AreaIndicatorSchema, BuildingSchema, ListingSchema } from '../../../../../packages/shared/schemas/index';
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
      const [areaRows, indicatorRows, buildingRows, duplicateRows] = await Promise.all([
        sql.unsafe(`SELECT id, 'neighbourhood' AS kind, name, number, is_nia, ST_AsGeoJSON(geometry)::json AS geometry FROM neighbourhoods WHERE id = $1
          UNION ALL SELECT id, 'ward' AS kind, name, number, NULL AS is_nia, ST_AsGeoJSON(geometry)::json AS geometry FROM wards WHERE id = $2`, [listing.neighbourhoodId, listing.wardId]),
        // Crime indicators obey the same explicit opt-in as the owner safety result.
        sql.unsafe(`SELECT area_id, indicator_id, value, unit, period, source_id, sample_size, note FROM area_indicators
          WHERE ((area_kind = 'neighbourhood' AND area_id = $1) OR (area_kind = 'ward' AND area_id = $2))
          AND source_id IS NOT NULL AND unit IS NOT NULL AND ($3 OR indicator_id !~ '^crime[:_]')
          ORDER BY area_kind, indicator_id, period`, [listing.neighbourhoodId, listing.wardId, intent.safety.enabled]),
        sql.unsafe(`SELECT id, address, address_point_id, ST_X(location::geometry) AS lng, ST_Y(location::geometry) AS lat,
          year_built, storeys, units, property_type, latest_score, score_date::text, sign_colour, previous_scores, source_id
          FROM buildings WHERE id = $1`, [listing.buildingId]),
        sql.unsafe(`SELECT ${candidateColumns} FROM listings WHERE duplicate_of = $1 ORDER BY last_seen_at DESC, id`, [listing.id]),
      ]);
      return {
        areas: rows(areaRows).map(row => AreaSchema.parse({ id: row.id, kind: row.kind, name: row.name, ...(row.number == null ? {} : { number: row.number }), ...(row.is_nia == null ? {} : { isNIA: row.is_nia }), geometry: row.geometry })),
        indicators: rows(indicatorRows).map(row => AreaIndicatorSchema.parse({ areaId: row.area_id, indicatorId: row.indicator_id, value: row.value, unit: row.unit, period: row.period, sourceId: row.source_id, ...(row.sample_size == null ? {} : { sampleSize: row.sample_size }), ...(row.note == null ? {} : { note: row.note }) })),
        building: rows(buildingRows).map(row => BuildingSchema.parse({ id: row.id, address: row.address, addressPointId: row.address_point_id, location: row.lng == null || row.lat == null ? null : { lng: row.lng, lat: row.lat }, yearBuilt: row.year_built, storeys: row.storeys, units: row.units, propertyType: row.property_type, latestScore: row.latest_score == null ? null : Number(row.latest_score), scoreDate: row.score_date, signColour: row.sign_colour, previousScores: typeof row.previous_scores === 'string' ? JSON.parse(row.previous_scores) : row.previous_scores, sourceId: row.source_id }))[0] ?? null,
        duplicates: rows(duplicateRows).map(listingFromRow),
      };
    } catch { throw new SearchUnavailable('Listing details are unavailable'); }
  };
}
