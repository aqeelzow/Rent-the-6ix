import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readFirstSheet, unzipEntry } from "./xlsx.ts";

/** A minimal ZIP writer (no CRCs; the reader doesn't check them). `stored` entries skip deflate. */
function zip(files: Record<string, string>, stored: string[] = []): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name);
    const raw = Buffer.from(text);
    const method = stored.includes(name) ? 0 : 8;
    const data = method === 0 ? raw : deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const workbook = zip(
  {
    "xl/workbook.xml":
      '<workbook><sheets><sheet name="profile" sheetId="1" r:id="rId7"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":
      '<Relationships><Relationship Id="rId7" Type="worksheet" Target="worksheets/data.xml"/></Relationships>',
    "xl/sharedStrings.xml":
      '<sst><si><t>Neighbourhood Number</t></si><si><t xml:space="preserve">  Renter</t></si><si><r><t>Rent </t></r><r><t>&amp; income</t></r></si></sst>',
    "xl/worksheets/data.xml": [
      "<worksheet><sheetData>",
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>1</v></c><c r="D1"><v>83</v></c></row>',
      '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>3705</v></c><c r="C2"/><c r="D2" t="inlineStr"><is><t>n/a &#x2014;</t></is></c></row>',
      '<row r="3"><c r="A3" t="s"><v>2</v></c><c r="B3"><v>34.1</v></c></row>',
      "</sheetData></worksheet>",
    ].join(""),
  },
  ["xl/workbook.xml"],
);

describe("unzipEntry", () => {
  it("reads deflated and stored entries, and is null for a missing one", () => {
    expect(unzipEntry(workbook, "xl/workbook.xml")!.toString()).toContain('r:id="rId7"');
    expect(unzipEntry(workbook, "xl/sharedStrings.xml")!.toString()).toContain(
      "Neighbourhood Number",
    );
    expect(unzipEntry(workbook, "xl/nope.xml")).toBeNull();
  });

  it("refuses something that isn't a ZIP", () => {
    expect(() => unzipEntry(Buffer.from("not a zip file at all, just text"), "x")).toThrow(
      /not a ZIP/,
    );
  });
});

describe("readFirstSheet", () => {
  it("follows the workbook to its first sheet and resolves every kind of cell", () => {
    expect(readFirstSheet(workbook)).toEqual([
      ["Neighbourhood Number", "1", "", "83"],
      ["  Renter", "3705", "", "n/a —"],
      ["Rent & income", "34.1"],
    ]);
  });
});
