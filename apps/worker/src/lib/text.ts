// Plain text from the small HTML fragments sources put in descriptions ("<b>…</b><br>…").
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function htmlToText(html: string): string {
  // In HTML a raw newline is just a space; only tags break lines. Plain text keeps its newlines.
  const source = /<(br|p|div|li|h\d)\b/i.test(html) ? html.replace(/\s*\n\s*/g, " ") : html;
  return source
    .replace(/<\s*(br|\/p|\/li|\/div|\/h\d)\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
      if (code[0] === "#")
        return String.fromCodePoint(
          code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1)),
        );
      return ENTITIES[code.toLowerCase()] ?? entity;
    })
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
