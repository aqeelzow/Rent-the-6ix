// Minimal ZIP reader for the TTC GTFS archive. The worker image (node:24-slim) has no `unzip`,
// and the only archive it ever reads is a City-published GTFS feed, so a full ZIP library would
// be more surface area than the task needs. Supports the two methods GTFS archives use:
// 0 (stored) and 8 (deflate).
import { inflateRawSync } from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

interface Entry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

function findEocd(view: DataView): number {
  // The end-of-central-directory record can be followed by a comment of up to 65535 bytes.
  for (let i = view.byteLength - 22; i >= Math.max(0, view.byteLength - 65_557); i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) return i;
  }
  throw new Error("not a ZIP archive: no end-of-central-directory record");
}

function readEntries(buffer: Buffer): Entry[] {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const eocd = findEocd(view);
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries: Entry[] = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw new Error("corrupt ZIP: bad central directory signature");
    }
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    entries.push({ name, method, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Extract one file from a ZIP buffer as a UTF-8 string. */
export function readZipText(buffer: Buffer, name: string): string {
  const entry = readEntries(buffer).find((e) => e.name === name);
  if (!entry) throw new Error(`ZIP does not contain ${name}`);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (view.getUint32(entry.localOffset, true) !== LOCAL_SIGNATURE) {
    throw new Error(`corrupt ZIP: bad local header for ${name}`);
  }
  const nameLength = view.getUint16(entry.localOffset + 26, true);
  const extraLength = view.getUint16(entry.localOffset + 28, true);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const data = buffer.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data.toString("utf8");
  if (entry.method === 8) return inflateRawSync(data).toString("utf8");
  throw new Error(`unsupported ZIP compression method ${entry.method} for ${name}`);
}

/** Yield the lines of a CSV/TSV text without materialising an array of every row. */
export function* lines(text: string): Generator<string> {
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      const end = i > start && text[i - 1] === "\r" ? i - 1 : i;
      yield text.slice(start, end);
      start = i + 1;
    }
  }
  if (start < text.length) yield text.slice(start);
}
