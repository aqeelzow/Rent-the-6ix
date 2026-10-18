import { safetyCaveats } from "@rentthe6ix/shared/engine/safety";
import type { Caveat, Safety } from "@rentthe6ix/shared/schemas";
import { getClient } from "../db";
import { safetyForListing, type CrimeTable } from "./safety";

// Police-reported crime for a ward page (SPEC 7.6, 9.1). Owner: D. TPS publishes rates for the 158
// neighbourhoods, not for wards, and the two don't nest, so a ward gets no figure of its own: it
// lists the neighbourhoods that cover it, each with its share of the ward and its own rate vs the
// city. Slivers under MIN_SHARE (boundary noise) are left out.

export const MIN_SHARE = 0.02;

export type WardNeighbourhood = { id: string; name: string; share: number; safety: Safety | null };
export type WardCrime = { neighbourhoods: WardNeighbourhood[]; caveats: Caveat[] };

type OverlapRow = { id: string; name: string; share: number };

/** Builds the ward's list from its overlaps and the crime table; largest share first. */
export function wardCrimeFrom(overlaps: OverlapRow[], table: CrimeTable): WardCrime {
  return {
    neighbourhoods: overlaps
      .filter((row) => row.share >= MIN_SHARE)
      .sort((a, b) => b.share - a.share)
      .map((row) => ({ ...row, safety: safetyForListing(table, row.id).safety })),
    caveats: safetyCaveats(table.city),
  };
}

export async function loadWardCrime(
  sql: NonNullable<ReturnType<typeof getClient>>,
  wardId: string,
  table: CrimeTable,
): Promise<WardCrime> {
  const overlaps = await sql<OverlapRow[]>`
    SELECT n.id, n.name,
           ST_Area(ST_Intersection(n.geometry, w.geometry)::geography)
             / ST_Area(w.geometry::geography) AS share
    FROM wards w JOIN neighbourhoods n ON ST_Intersects(n.geometry, w.geometry)
    WHERE w.id = ${wardId}`;
  return wardCrimeFrom(overlaps, table);
}
