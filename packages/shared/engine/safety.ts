import type { Caveat, Safety } from "../schemas/index";
import { SAFETY } from "./config";

// Opt-in safety preference (SPEC 7.6). Owner: D. Pure: the rates come from TPS Neighbourhood
// Crime Rates loaded into `area_indicators` (`crime:<type>`, three-year average per 100,000);
// the database lookup lives in apps/web/src/lib/db/safety.ts. The caveat text lives only here,
// so the filters panel, cards, detail page and explanations all show the same words.

export type MajorCrimeType = (typeof SAFETY.majorTypes)[number];

/** One neighbourhood's police-reported rates per 100,000 residents, averaged over `years`. */
export type CrimeRates = {
  areaId: string;
  years: number[];
  byType: Partial<Record<MajorCrimeType, number | null>>;
  /** Residents, when known; used only to weight the city rate. */
  population?: number | null;
};

/** The city-wide comparison point for every neighbourhood. */
export type CityRates = {
  combined: number;
  byType: Record<MajorCrimeType, number>;
  years: number[];
  /** How `combined` was computed; the caveat says which (SPEC 2.2: every figure traceable). */
  method: "population_weighted" | "neighbourhood_mean";
};

const caveat = (code: string, title: string, explanation: string): Caveat => ({
  severity: "info",
  code,
  title,
  explanation,
});

/** Shown wherever a safety figure appears (SPEC 7.6). */
export const SAFETY_CAVEATS: Caveat[] = [
  caveat(
    "safety_reported_only",
    "Reported crimes only",
    "These are crimes reported to Toronto Police. Many crimes are never reported, and reporting rates differ between places.",
  ),
  caveat(
    "safety_per_resident",
    "Rates are per resident",
    "Rates divide crimes by the people who live in a neighbourhood. Areas with many visitors and workers (downtown, malls, nightlife) show higher rates than residents experience.",
  ),
  caveat(
    "safety_offset_locations",
    "Locations are offset",
    "Toronto Police move each incident to a nearby intersection to protect privacy, so counts near a neighbourhood boundary can land on the wrong side.",
  ),
  caveat(
    "safety_area_average",
    "A whole-neighbourhood average",
    "A neighbourhood average says nothing about a specific street or building.",
  ),
  caveat(
    "safety_places_not_people",
    "Describes places, not people",
    "These figures describe places. They say nothing about the people who live there.",
  ),
];

const CITY_METHOD_CAVEATS: Record<CityRates["method"], Caveat> = {
  population_weighted: caveat(
    "safety_city_rate",
    "How the city rate is worked out",
    "The city rate is all reported major crimes in Toronto per 100,000 residents.",
  ),
  neighbourhood_mean: caveat(
    "safety_city_rate",
    "How the city rate is worked out",
    "The city figure is the average of Toronto's 158 neighbourhood rates, each neighbourhood counted equally, because neighbourhood populations aren't loaded yet.",
  ),
};

/** The caveats for a safety figure compared against `city`. */
export function safetyCaveats(city: Pick<CityRates, "method"> | null): Caveat[] {
  return city ? [...SAFETY_CAVEATS, CITY_METHOD_CAVEATS[city.method]] : SAFETY_CAVEATS;
}

const round = (n: number, places: number) => Number(n.toFixed(places));

/** The five major-indicator rates added up, or null unless all five are known. */
function combinedRate(byType: CrimeRates["byType"]): number | null {
  let total = 0;
  for (const type of SAFETY.majorTypes) {
    const rate = byType[type];
    if (rate == null || !Number.isFinite(rate) || rate < 0) return null;
    total += rate;
  }
  return total;
}

/**
 * The city-wide rates from every neighbourhood: population-weighted when every neighbourhood
 * has a population (exactly all crimes ÷ all residents), else the plain neighbourhood average.
 */
export function cityRates(neighbourhoods: CrimeRates[]): CityRates | null {
  const complete = neighbourhoods.filter((n) => combinedRate(n.byType) !== null);
  if (complete.length === 0) return null;
  const weighted = complete.every((n) => n.population != null && n.population > 0);
  const weight = (n: CrimeRates) => (weighted ? n.population! : 1);
  const totalWeight = complete.reduce((sum, n) => sum + weight(n), 0);
  const byType = Object.fromEntries(
    SAFETY.majorTypes.map((type) => [
      type,
      complete.reduce((sum, n) => sum + n.byType[type]! * weight(n), 0) / totalWeight,
    ]),
  ) as Record<MajorCrimeType, number>;
  const years = [...new Set(complete.flatMap((n) => n.years))].sort((a, b) => a - b);
  return {
    combined: SAFETY.majorTypes.reduce((sum, type) => sum + byType[type], 0),
    byType,
    years,
    method: weighted ? "population_weighted" : "neighbourhood_mean",
  };
}

/**
 * A neighbourhood's safety figure for the shared `Safety` shape: its combined rate, that rate
 * relative to the city, the rate by type and the years averaged, always with the caveats.
 * Null when there is no neighbourhood or no years; null rates when its data is incomplete.
 */
export function safetyFor(rates: CrimeRates | null, city: CityRates | null): Safety | null {
  if (!rates || rates.years.length === 0) return null;
  const rate = combinedRate(rates.byType);
  const relative = rate !== null && city && city.combined > 0 ? rate / city.combined : null;
  return {
    areaId: rates.areaId,
    rate: relative === null || rate === null ? null : round(rate, 1),
    relativeRate: relative === null ? null : round(relative, 2),
    byType: Object.fromEntries(
      SAFETY.majorTypes.map((type) => {
        const value = rates.byType[type];
        return [type, value == null ? null : round(value, 1)];
      }),
    ),
    years: [...new Set(rates.years)].sort((a, b) => a - b),
    caveats: safetyCaveats(city),
  };
}

/** 0–100 for the match score: 100 at or below 0.5× the city rate, 0 at 2× or more (SPEC 7.6). */
export function safetyScore(relativeRate: number): number {
  const { fullScoreAt, zeroScoreAt } = SAFETY;
  const score = (100 * (zeroScoreAt - relativeRate)) / (zeroScoreAt - fullScoreAt);
  return Math.max(0, Math.min(100, score));
}

/** "2023–2025" (the period the crime loader writes) → [2023, 2024, 2025]. */
export function yearsFromPeriod(period: string): number[] {
  const match = /^(\d{4})\s*[–-]\s*(\d{4})$/.exec(period.trim());
  if (!match) return /^\d{4}$/.test(period.trim()) ? [Number(period.trim())] : [];
  const [from, to] = [Number(match[1]), Number(match[2])];
  if (to < from || to - from > 20) return [];
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}
