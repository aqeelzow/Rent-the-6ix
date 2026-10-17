import en from "../../../messages/en.json";

// Dot-path keys of every string in en.json, e.g. "landing.title".
type Leaves<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type MessageKey = Leaves<typeof en>;

/**
 * Looks up a user-facing string (SPEC 17). `{name}` placeholders are filled from `params`.
 * Works in server and client components. Format numbers with Intl (en-CA) before passing them in.
 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const value = key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
      en,
    );
  if (typeof value !== "string") return key;
  return params ? interpolate(value, params) : value;
}

/** Replaces `{name}` with `params.name`; unknown placeholders are left as they are. */
export function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
