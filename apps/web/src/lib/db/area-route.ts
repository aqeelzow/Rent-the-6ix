import { z } from "zod";
import { ApiError, jsonRoute } from "../api/json-route";
import { getClient } from "../db";
import { areaIdFor, loadAreaFacts } from "./area-facts";

// GET /api/areas/[kind]/[id] (SPEC 13, P3.10). Owner: D. Every indicator for one area with the
// city value, period and source beside it. `id` is the area's number: /api/areas/ward/10.

const Params = z.strictObject({ kind: z.enum(["neighbourhood", "ward"]), id: z.string() });
type Context = { params: Promise<{ kind: string; id: string }> };

export function createAreaRoute(client: typeof getClient = getClient) {
  return jsonRoute<undefined, Context>(
    { name: "areas.detail" },
    async (_input, _request, context) => {
      const { kind, id } = Params.parse(await context.params);
      const areaId = areaIdFor(kind, id);
      if (!areaId) throw new ApiError(404, "area_not_found", "No such area");
      const sql = client();
      if (!sql) throw new ApiError(503, "service_unavailable", "Area data temporarily unavailable");
      const facts = await loadAreaFacts(sql, kind, areaId);
      if (!facts) throw new ApiError(404, "area_not_found", "No such area");
      return facts;
    },
  );
}
