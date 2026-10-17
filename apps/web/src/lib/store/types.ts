// Placeholder shapes until B's zod schemas merge (P0.5, `packages/shared/schemas`).
// The store only relies on `id` and `rawPrompt`, so the swap is one line:
//   export type { SearchIntent, SearchResultItem, Listing } from "@rentthe6ix/shared/schemas";
// and `ApiError` from B's `apps/web/src/lib/api` (TEAM.md section 3.9).

export type SearchIntent = { rawPrompt: string } & Record<string, unknown>;

export type SearchResultItem = { id: string } & Record<string, unknown>;

export type Listing = { id: string } & Record<string, unknown>;

export type ApiError = {
  code: string;
  message: string;
  issues?: unknown[];
  retryAfterSeconds?: number;
};
