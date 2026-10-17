// Small CSV reader for the City's open-data exports. These files quote any field containing a
// comma (site addresses do: "181-183  GERRARD ST E", "OCT 18, 2021"), so splitting on commas is
// not enough; a dependency is not worth it for four files.
import { lines } from "./zip.ts";

/** One CSV line, honouring double-quoted fields and "" escapes. */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      fields.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

/**
 * Header row plus a generator of rows, by name. Values are trimmed; an empty string stays "",
 * because "not published" and "published as empty" are the same thing in these exports.
 */
export function csvTable(text: string): { rows: Generator<Row>; header: string[] } {
  const iterator = lines(text);
  const first = iterator.next();
  if (first.done) throw new Error("empty CSV");
  const header = parseCsvLine(first.value).map((name) => name.trim());
  function* rows(): Generator<Row> {
    for (const line of iterator) {
      if (line.length === 0) continue;
      const values = parseCsvLine(line);
      const record: Row = {};
      for (let i = 0; i < header.length; i++) record[header[i]] = (values[i] ?? "").trim();
      yield record;
    }
  }
  return { rows: rows(), header };
}

export type Row = Record<string, string>;

/** First non-empty value among the given column names, or null. */
export function pick(row: Row, ...names: string[]): string | null {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined && value !== "") return value;
  }
  return null;
}

/** Integer or null; commas and stray units are dropped. */
export function toInt(value: string | null): number | null {
  if (value === null) return null;
  const digits = value.replace(/[^\d-]/g, "");
  if (digits === "" || digits === "-") return null;
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Float or null. */
export function toFloat(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}
