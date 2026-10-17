import { z } from 'zod';
import { getClient } from '../db';
import { DestinationChoiceSchema } from '../../../../../packages/shared/schemas/index';
import type { AddressLookup } from './resolve';

const rowSchema = z.object({ id: z.string().trim().min(1), address_full: z.string().trim().min(1), lng: z.number().min(-180).max(180), lat: z.number().min(-90).max(90) });
let lookupInFlight = false;
const normalize = (query: string) => query.toLowerCase().replace(/\s+/g, ' ').trim();
type Client = { unsafe: (statement: string, parameters: string[]) => PromiseLike<unknown> };
// address_norm has no published normalization contract; match the authoritative full address exactly, ignoring case/whitespace.
export const addressPointsStatement = `
  SELECT id, address_full, ST_X(location::geometry) AS lng, ST_Y(location::geometry) AS lat
  FROM address_points
  WHERE lower(btrim(regexp_replace(address_full, '[[:space:]]+', ' ', 'g'))) = $1
  ORDER BY id
  LIMIT 21
`;
export function addressPointsLookup(client: () => Client | null = getClient): AddressLookup {
  return async (query, signal) => {
    if (signal.aborted || lookupInFlight) return undefined;
    let abort: () => void = () => {};
    try {
      const sql = client();
      if (!sql) return undefined;
      const aborted = new Promise<undefined>(resolve => { abort = () => resolve(undefined); signal.addEventListener('abort', abort, { once: true }); });
      // shortcut: ignore late read results; postgres cancellation can race with another query on the shared client. Use a dedicated bounded connection if DB load requires server cancellation.
      const operation = Promise.resolve(sql.unsafe(addressPointsStatement, [normalize(query)]));
      lookupInFlight = true;
      const rows = await Promise.race([operation.finally(() => { lookupInFlight = false; }), aborted]);
      if (signal.aborted || rows === undefined) return undefined;
      const parsed = z.array(rowSchema).max(20).parse(rows);
      if (!parsed.length || parsed.some(row => normalize(row.address_full) !== normalize(query)) || new Set(parsed.map(row => row.id)).size !== parsed.length) return undefined;
      const choices = parsed.map(row => DestinationChoiceSchema.parse({ id: row.id, label: row.address_full, resolved: { lng: row.lng, lat: row.lat, source: 'address_points' } }));
      return choices.length === 1 ? { status: 'resolved', query, destination: choices[0] } : { status: 'ambiguous', query, choices };
    } catch { return undefined; }
    finally { signal.removeEventListener('abort', abort); }
  };
}
