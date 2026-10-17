// MapLibre 6 loads its web worker from a URL. Next doesn't bundle that worker, so we serve the
// installed version's worker (and the shared chunk it imports) from public/maplibre/.
// Runs before `next dev` and `next build`; the copies are git-ignored.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const dist = path.dirname(require.resolve("maplibre-gl/package.json"));
const out = path.join(import.meta.dirname, "..", "public", "maplibre");
mkdirSync(out, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(path.join(dist, "dist", file), path.join(out, file));
}
