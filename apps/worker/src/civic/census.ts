import { readFile } from "node:fs/promises";
import type { Sql } from "postgres";
import { z } from "zod";
import { upsertSource } from "./sources.ts";

const PROFILE = "statcan-waterloo-census-profile";
const BLOCKS = "statcan-waterloo-census-blocks";
const PERIOD = "2021 Census";
const count = z.number().int().nonnegative();
const suppressed = z.object({ flag: z.union([z.literal(2), z.literal(6)]) });
const observation = count.or(suppressed);
const point = { lng: z.number().min(-180).max(180), lat: z.number().min(-90).max(90) };

export const CensusSeed = z.object({
  period: z.literal(PERIOD),
  disseminationAreas: z
    .array(
      z.object({
        id: z.string().regex(/^2021S0512\d{8}$/),
        ...point,
        observations: z.object({
          "229": observation, // Median household income
          "1400": observation, // Households by tenure
          "1402": observation, // Renter households
          "1476": observation, // Tenant households in non-farm, non-reserve dwellings
          "1478": z.number().min(0).max(100).or(suppressed),
        }),
      }),
    )
    .length(155),
  disseminationBlocks: z
    .array(
      z.object({
        id: z.string().regex(/^2021S0513\d{11}$/),
        ...point,
        counts: z.tuple([count, count, count]),
      }),
    )
    .length(764),
});

type Seed = z.infer<typeof CensusSeed>;
type DA = Seed["disseminationAreas"][number];
type Block = Seed["disseminationBlocks"][number];
const known = (value: number | object) => (typeof value === "number" ? value : null);
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const percent = (numerator: number, denominator: number) =>
  Math.round((1000 * numerator) / denominator) / 10;

export function districtIndicators(area_id: string, areas: DA[], blocks: Block[]) {
  const paired = areas.flatMap(({ observations: obs }) => {
    const households = known(obs["1400"]);
    const renters = known(obs["1402"]);
    return households !== null && renters !== null ? [{ households, renters }] : [];
  });
  const households = sum(paired.map((row) => row.households));
  const renters = sum(paired.map((row) => row.renters));
  const tenureComplete = areas.length > 0 && paired.length === areas.length;
  const dominant = areas.find(
    ({ observations: obs }) => (known(obs["1400"]) ?? 0) > households / 2,
  );
  const singleArea = areas.length === 1;
  const burden = areas.map(({ observations: obs }) => ({
    weight: known(obs["1476"]),
    rate: known(obs["1478"]),
  }));
  const weight = sum(burden.map((row) => row.weight ?? 0));
  // shortcut: use the published tenant population as an approximate weight until StatCan
  // publishes the positive-income tenant denominator at DA level.
  const burdenComplete =
    weight > 0 &&
    burden.every(({ weight, rate }) => weight !== null && (weight === 0 || rate !== null));
  const burdenRate = singleArea
    ? burden[0].rate
    : burdenComplete
      ? percent(sum(burden.map(({ weight, rate }) => ((weight ?? 0) * (rate ?? 0)) / 100)), weight)
      : null;

  const row = (
    indicator_id: string,
    value: number | null,
    unit: string,
    source_id: string,
    sample_size: number | null = null,
    note: string | null = null,
  ) => ({
    area_id,
    area_kind: "neighbourhood",
    indicator_id,
    value,
    unit,
    period: PERIOD,
    source_id,
    sample_size,
    note,
  });
  return [
    row(
      "renter_households",
      paired.length ? renters : null,
      "households",
      PROFILE,
      null,
      "Sum of published DA counts. Values use random rounding and omit suppressed DAs.",
    ),
    row(
      "renter_households_pct",
      tenureComplete && households ? percent(renters, households) : null,
      "% of households",
      PROFILE,
      tenureComplete ? households : null,
      "25% census sample.",
    ),
    row(
      "renters_shelter_cost_30pct",
      burdenRate,
      "% of tenant households",
      PROFILE,
      null,
      singleArea
        ? "Published rate for the assigned census area."
        : "Approximate weighted estimate using published tenant counts. Districts with missing data are unavailable.",
    ),
    row(
      "median_household_income",
      tenureComplete && dominant ? known(dominant.observations["229"]) : null,
      "CAD",
      PROFILE,
      null,
      "2020 income for the DA with over half the district’s tenure households.",
    ),
    row("population", sum(blocks.map(({ counts }) => counts[0])), "residents", BLOCKS),
    row("private_dwellings", sum(blocks.map(({ counts }) => counts[1])), "dwellings", BLOCKS),
    row(
      "occupied_private_dwellings",
      sum(blocks.map(({ counts }) => counts[2])),
      "dwellings",
      BLOCKS,
    ),
  ];
}

export async function loadCensus(sql: Sql) {
  const file = new URL("../../../../db/seed/waterloo-census-2021.json", import.meta.url);
  const { disseminationAreas: areas, disseminationBlocks: blocks } = CensusSeed.parse(
    JSON.parse(await readFile(file, "utf8")),
  );
  const points = [...areas, ...blocks].map(({ id, lng, lat }) => ({ id, lng, lat }));
  if (new Set(points.map(({ id }) => id)).size !== points.length) {
    throw new Error("Duplicate geography in the Waterloo census seed");
  }
  return sql.begin(async (tx) => {
    const assignments = new Map(
      (
        await tx<{ id: string; district: string | null }[]>`
      select p.id, (
        select n.id from neighbourhoods n
        where n.source_id in ('waterloo-district-plans', 'waterloo-city-boundary')
          and ST_Covers(n.geometry, ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326))
        order by n.source_id = 'waterloo-city-boundary', n.id limit 1
      ) as district
      from jsonb_to_recordset(${tx.json(points)}) as p(id text, lng float8, lat float8)
    `
      ).map(({ id, district }) => [id, district]),
    );
    const missing = points.filter(({ id }) => !assignments.get(id));
    if (missing.length)
      throw new Error(`${missing.length} census geographies match no Waterloo district`);
    const districts = await tx<{ id: string }[]>`
      select id from neighbourhoods where source_id in ('waterloo-district-plans', 'waterloo-city-boundary')
    `;
    const indicators = districts.flatMap(({ id }) =>
      districtIndicators(
        id,
        areas.filter((area) => assignments.get(area.id) === id),
        blocks.filter((block) => assignments.get(block.id) === id),
      ),
    );
    for (const source of [
      {
        id: PROFILE,
        title: "Statistics Canada 2021 Census Profile",
        url: "https://www150.statcan.gc.ca/n1/en/catalogue/98-401-X2021006",
        note: "Waterloo DA centroids. Published renter counts sum to 18,130 versus the city profile’s 18,205. Suppression and random rounding affect the comparison.",
      },
      {
        id: BLOCKS,
        title: "Statistics Canada 2021 Geographic Attribute File",
        url: "https://www150.statcan.gc.ca/n1/en/catalogue/92-151-X2021001",
        note: "Counts joined to Waterloo dissemination blocks using the 2021 Dissemination Geographies Relationship File.",
      },
    ]) {
      await upsertSource(tx, {
        ...source,
        period: PERIOD,
        licence: "Statistics Canada Open Licence",
      });
    }
    await tx`delete from area_indicators where source_id in (${PROFILE}, ${BLOCKS})`;
    await tx`insert into area_indicators ${tx(indicators)}`;
    return { indicators: indicators.length, neighbourhoods: districts.length };
  });
}
