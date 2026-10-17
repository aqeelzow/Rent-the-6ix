import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components stay off: pages and GET route handlers render at request time,
  // so DB-backed routes never get prerendered at build (SPEC change log, P0.1).
  cacheComponents: false,
  reactCompiler: true,
  // packages/shared is plain TypeScript source with no build step.
  transpilePackages: ["@rentthe6ix/shared"],
  // Self-contained server bundle for the Docker image on Vultr.
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
