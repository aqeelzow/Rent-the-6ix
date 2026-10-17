import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(js.configs.recommended, tseslint.configs.recommended, {
  // The engine is pure TypeScript: no React, no network, no database, no randomness (CLAUDE.md).
  files: ["engine/**/*.ts"],
  rules: {
    "@typescript-eslint/no-explicit-any": "error",
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: [
              "react",
              "react-*",
              "next",
              "next/*",
              "postgres",
              "drizzle-orm",
              "drizzle-orm/*",
              "pg",
              "undici",
              "@google/genai",
            ],
            message: "The engine is pure: no React, network, database or AI SDK.",
          },
        ],
      },
    ],
    "no-restricted-globals": [
      "error",
      { name: "fetch", message: "The engine never does network calls." },
      { name: "window", message: "The engine runs on server and client; no browser globals." },
      { name: "localStorage", message: "The engine never touches storage." },
    ],
    "no-restricted-properties": [
      "error",
      { object: "Math", property: "random", message: "The engine is deterministic." },
    ],
  },
});
