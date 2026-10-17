// The `manual` source (SPEC 8.4, P3.33): hand-checked rows in db/seed/manual.csv, the demo backup
// if adapters break. A row loads only with a `checked_on` date: someone opened the source page that
// day and confirmed the fields. Excerpts stay out of the file (scraped text isn't published, SPEC 8.5).
import { createHash } from "node:crypto";
import { emptyRawListing, type RawListing, type TriState } from "./types.ts";

export const MANUAL_COLUMNS = [
  "checked_on",
  "source_url",
  "original_source",
  "title",
  "monthly_rent_cad",
  "bedrooms",
  "bathrooms",
  "unit_type",
  "sqft",
  "year_built",
  "air_conditioning",
  "utilities_included",
  "parking",
  "pets_allowed",
  "furnished",
  "laundry_in_suite",
  "available_from",
  "address_text",
  "lat",
  "lng",
  "notes",
] as const;

type Row = Record<(typeof MANUAL_COLUMNS)[number], string>;

/** RFC 4180-ish: commas, quoted fields with "" escapes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") endField();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else field += ch;
  }
  if (field || row.length) endRow();
  return rows.filter((r) => r.some((f) => f.trim()));
}

export function csvField(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const num = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? null : Number(v));
const tri = (v: string): TriState => (v === "yes" ? true : v === "no" ? false : null);

export interface ManualParse {
  listings: RawListing[];
  /** Rows without checked_on, or missing a URL, title or rent. */
  skipped: number;
}

export function parseManual(text: string): ManualParse {
  const [header, ...lines] = parseCsv(text);
  if (!header || MANUAL_COLUMNS.some((c, i) => header[i]?.trim() !== c))
    throw new Error(`manual.csv: header must be ${MANUAL_COLUMNS.join(",")}`);
  const listings: RawListing[] = [];
  let skipped = 0;
  for (const cells of lines) {
    const r = Object.fromEntries(MANUAL_COLUMNS.map((c, i) => [c, (cells[i] ?? "").trim()])) as Row;
    const rent = num(r.monthly_rent_cad);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.checked_on) || !r.source_url || !r.title || !rent) {
      skipped++;
      continue;
    }
    // "cats only" / "dogs only" go through normalize's text rule; yes/no are structured.
    const pets = r.pets_allowed.replace("_", " ");
    listings.push({
      ...emptyRawListing,
      source: "manual",
      sourceListingId: `m-${createHash("sha1").update(r.source_url).digest("hex").slice(0, 12)}`,
      sourceUrl: r.source_url,
      title: r.title,
      description: [r.notes, pets.endsWith("only") ? pets : ""].filter(Boolean).join(". ") || null,
      monthlyRentCad: rent,
      bedrooms: num(r.bedrooms),
      bathrooms: num(r.bathrooms),
      unitType: r.unit_type || null,
      sqft: num(r.sqft),
      yearBuilt: num(r.year_built),
      airConditioning: r.air_conditioning === "central" ? "central" : tri(r.air_conditioning),
      utilitiesIncluded: tri(r.utilities_included),
      parking: tri(r.parking),
      petsAllowed: tri(r.pets_allowed),
      furnished: tri(r.furnished),
      laundryInSuite: tri(r.laundry_in_suite),
      availableFrom: r.available_from || null,
      address: r.address_text || null,
      lat: num(r.lat),
      lng: num(r.lng),
      postedAt: `${r.checked_on}T00:00:00.000Z`,
    });
  }
  return { listings, skipped };
}
