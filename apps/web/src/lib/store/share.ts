import { SearchIntentSchema } from "@rentthe6ix/shared/schemas";
import { z } from "zod";
import type { SearchIntent } from "./types";

// Share a search as a link (SPEC 15): the edited filters travel in the query string, so nothing is
// stored on the server. `q` keeps the renter's words readable; `s` holds the intent as base64url
// JSON. The prompt isn't repeated inside `s`, so the link stays as short as it can.

/** Longer values are ignored rather than decoded (a link someone else made is untrusted). */
const MAX_ENCODED = 16_000;

const SharedSchema = z.object({
  v: z.literal(1),
  intent: z.unknown(),
  hideUnconfirmed: z.boolean().optional(),
});

export type SharedSearch = { intent: SearchIntent; hideUnconfirmed: boolean };

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(encoded: string): string {
  const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

export function encodeSharedSearch({ intent, hideUnconfirmed }: SharedSearch): string {
  // The prompt travels as `q`; JSON leaves out the undefined field.
  const withoutPrompt = { ...intent, rawPrompt: undefined };
  return toBase64Url(JSON.stringify({ v: 1, intent: withoutPrompt, hideUnconfirmed }));
}

/** The search in a shared link, or null if it's missing, damaged or doesn't match the schema. */
export function decodeSharedSearch(encoded: string, prompt: string): SharedSearch | null {
  if (!encoded || encoded.length > MAX_ENCODED || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  try {
    const shared = SharedSchema.safeParse(JSON.parse(fromBase64Url(encoded)));
    if (!shared.success || typeof shared.data.intent !== "object" || !shared.data.intent) {
      return null;
    }
    const intent = SearchIntentSchema.safeParse({ ...shared.data.intent, rawPrompt: prompt });
    return intent.success
      ? { intent: intent.data, hideUnconfirmed: shared.data.hideUnconfirmed ?? false }
      : null;
  } catch {
    return null;
  }
}

/** The path of a link that opens this search with its edited filters. */
export function sharedSearchPath(search: SharedSearch): string {
  const params = new URLSearchParams({
    q: search.intent.rawPrompt,
    s: encodeSharedSearch(search),
  });
  return `/search?${params}`;
}
