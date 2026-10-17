// GET /api/listings/[id]/valuation (SPEC 13): the listing's valuation with its comparables. Owner: C.
import { z } from "zod";
import { ApiError, jsonRoute } from "../../../../../lib/api/json-route";
import { getClient } from "../../../../../lib/db";
import { listingValuation } from "../../../../../lib/db/valuation";
import { ValuationSchema } from "../../../../../../../../packages/shared/schemas/index";

export const runtime = "nodejs";

const params = z.strictObject({ id: z.uuid() });

export const GET = jsonRoute<undefined, { params: Promise<{ id: string }> }>(
  { name: "listings.valuation" },
  async (_input, _request, context) => {
    const { id } = params.parse(await context.params);
    const sql = getClient();
    if (!sql) throw new ApiError(503, "service_unavailable", "Valuations temporarily unavailable");
    const valuation = await listingValuation(sql, id);
    if (!valuation) throw new ApiError(404, "listing_not_found", "Listing not found");
    // The shared contract is checked on every response.
    return ValuationSchema.parse(valuation);
  },
);
