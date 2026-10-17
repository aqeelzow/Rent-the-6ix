// Minimal XLSX reading for City files published only as Excel (the 2021 Neighbourhood Profiles).
// An .xlsx is a ZIP of XML parts; this reads the central directory, inflates the parts it needs
// with node:zlib, and turns the first worksheet into rows of cell text. No styles, formulas or
// dates: the City's statistical sheets are plain text and numbers, so that is all this handles.
import { inflateRawSync } from "node:zlib";

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;

/** One file from a ZIP archive, or null when it isn't there. Stored and deflated entries only. */
export function unzipEntry(zip: Buffer, name: string): Buffer | null {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a ZIP file (no end-of-central-directory record)");
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(offset) !== CENTRAL) throw new Error("damaged ZIP central directory");
    const method = zip.readUInt16LE(offset + 10);
    // The central directory has the real sizes; a local header may defer them to a data descriptor.
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    if (zip.toString("utf8", offset + 46, offset + 46 + nameLength) === name) {
      const start =
        localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
      const data = zip.subarray(start, start + compressedSize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      throw new Error(`unsupported ZIP compression method ${method} for ${name}`);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const point =
        code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(point) ? String.fromCodePoint(point) : whole;
    }
    return ENTITIES[code] ?? whole;
  });
}

/** The text of every <t> inside a fragment (rich-text runs are concatenated). */
function textOf(fragment: string): string {
  let text = "";
  for (const match of fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) text += match[1];
  return decodeXml(text);
}

/** "A" → 0, "Z" → 25, "AA" → 26. */
function columnIndex(letters: string): number {
  let index = 0;
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

function part(xlsx: Buffer, name: string): string | null {
  return unzipEntry(xlsx, name)?.toString("utf8") ?? null;
}

/** The first worksheet's path, from the workbook and its relationships. */
function firstSheetPath(xlsx: Buffer): string {
  const workbook = part(xlsx, "xl/workbook.xml");
  const rels = part(xlsx, "xl/_rels/workbook.xml.rels");
  const relId = workbook && /<sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook)?.[1];
  const target =
    relId &&
    rels &&
    new RegExp(`<Relationship\\b[^>]*Id="${relId}"[^>]*Target="([^"]+)"`).exec(rels)?.[1];
  if (!target) return "xl/worksheets/sheet1.xml";
  return target.startsWith("/") ? target.slice(1) : `xl/${target}`;
}

/**
 * The first worksheet as rows of cell text, in sheet order: shared strings resolved, inline strings
 * read, numbers as written, missing cells as "". Row arrays are as long as their last filled cell.
 */
export function readFirstSheet(xlsx: Buffer): string[][] {
  const shared = [
    ...(part(xlsx, "xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g),
  ].map((match) => textOf(match[1]));
  const sheet = part(xlsx, firstSheetPath(xlsx));
  if (!sheet) throw new Error("the workbook has no worksheet");
  const rows: string[][] = [];
  for (const row of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1];
      const body = cell[2] ?? "";
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = "";
      if (type === "s" && raw !== undefined) value = shared[Number(raw)] ?? "";
      else if (type === "inlineStr") value = textOf(body);
      else if (raw !== undefined) value = decodeXml(raw);
      const index = ref ? columnIndex(ref) : cells.length;
      while (cells.length < index) cells.push("");
      cells[index] = value;
    }
    rows.push(cells);
  }
  return rows;
}
