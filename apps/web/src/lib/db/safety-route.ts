import { SafetySchema } from "@rentthe6ix/shared/schemas";
import { z } from "zod";
import { ApiError, jsonRoute } from "../api/json-route";
import { crimeTableSource, safetyForListing, type CrimeTable } from "./safety";

// GET /api/areas/[kind]/[id]/safety (SPEC 13, 7.6). Owner: D. One neighbourhood's police-reported
// crime rates against the city, by offence, with the years and every caveat. TPS publishes rates
// for the 158 neighbourhoods only, so a ward has no figure (they don't nest in neighbourhoods).

const Params = z.strictObject({
  kind: z.enum(["neighbourhood", "ward"]),
  // City codes are zero-padded ("083"); "83" is accepted and padded.
  id: z.string().regex(/^\d{1,3}$/),
});

type Context = { params: Promise<{ kind: string; id: string }> };

export function createSafetyRoute(source: () => Promise<CrimeTable | null> = crimeTableSource()) {
  return jsonRoute<undefined, Context>(
    { name: "areas.safety" },
    async (_input, _request, context) => {
      const { kind, id } = Params.parse(await context.params);
      if (kind === "ward") {
        throw new ApiError(
          404,
          "safety_not_available",
          "Crime rates are published for neighbourhoods, not wards",
        );
      }
      const table = await source();
      if (!table)
        throw new ApiError(503, "service_unavailable", "Area data temporarily unavailable");
      const { safety } = safetyForListing(table, id.padStart(3, "0"));
      if (!safety)
        throw new ApiError(404, "area_not_found", "No crime rates for this neighbourhood");
      return SafetySchema.parse(safety);
    },
  );
}
