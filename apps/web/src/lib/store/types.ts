// Shapes come from B's zod schemas (TEAM.md section 3.1).
import type { ErrorResponse, SearchResult } from "@rentthe6ix/shared/schemas";

export type {
  DestinationResolution,
  DetailResponse,
  Listing,
  ParseResponse,
  SearchIntent,
  SearchResponse,
} from "@rentthe6ix/shared/schemas";

/** One ranked listing in the results list; its id is `listing.id`. */
export type SearchResultItem = SearchResult;

/** The `error` payload of every API error response (TEAM.md section 3.9). */
export type ApiError = ErrorResponse["error"];
