/** Long enough for any rental ad; B's route applies its own limits. */
export const MAX_TEXT = 10_000;

/** A full public http(s) link. The server still blocks private addresses (SPEC 13). */
export function isHttpLink(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.includes(".");
  } catch {
    return false;
  }
}
