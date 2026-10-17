#!/usr/bin/env node
/**
 * Apply db/migrations/*.sql to TigerData, once each, in filename order.
 *
 *   pnpm db:migrate --dry-run     show the plan, touch nothing
 *   pnpm db:migrate               apply what is pending
 *   pnpm db:migrate --status      what has been applied
 *
 * The connection string comes from DATABASE_URL, or from .env.local / .env at the
 * repo root. It is never printed.
 *
 * Each file runs in its own transaction and is recorded in schema_migrations with
 * a checksum, so re-running is a no-op and editing an applied file is refused
 * (CLAUDE.md conventions: add a new migration instead).
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    const path = join(process.cwd(), name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!match) continue;
      const [, key, raw] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = raw.replace(/^["']|["']$/g, "").trim();
    }
  }
}

function migrationFiles() {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, path: join(MIGRATIONS_DIR, name) }));
}

/** Split a SQL script on top-level semicolons, respecting quotes and $$ bodies. */
export function splitStatements(sql) {
  const statements = [];
  let buffer = "";
  let i = 0;
  let inLineComment = false;
  let inSingleQuote = false;
  let dollarTag = null;

  while (i < sql.length) {
    const char = sql[i];
    const pair = sql.slice(i, i + 2);

    if (inLineComment) {
      buffer += char;
      if (char === "\n") inLineComment = false;
      i += 1;
      continue;
    }
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        buffer += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      buffer += char;
      i += 1;
      continue;
    }
    if (inSingleQuote) {
      buffer += char;
      if (char === "'") {
        if (sql[i + 1] === "'") {
          buffer += "'";
          i += 2;
          continue;
        }
        inSingleQuote = false;
      }
      i += 1;
      continue;
    }
    if (pair === "--") {
      inLineComment = true;
      buffer += pair;
      i += 2;
      continue;
    }
    if (char === "'") {
      inSingleQuote = true;
      buffer += char;
      i += 1;
      continue;
    }
    if (char === "$") {
      const end = sql.indexOf("$", i + 1);
      if (end !== -1) {
        const candidate = sql.slice(i, end + 1);
        const tag = candidate.slice(1, -1);
        if (/^[A-Za-z0-9_]*$/.test(tag)) {
          dollarTag = candidate;
          buffer += candidate;
          i = end + 1;
          continue;
        }
      }
    }
    if (char === ";") {
      const statement = buffer.trim();
      if (statement) statements.push(statement);
      buffer = "";
      i += 1;
      continue;
    }
    buffer += char;
    i += 1;
  }

  const trailing = buffer.trim();
  if (trailing) statements.push(trailing);
  return statements;
}

/** Drop fragments that contain only comments or whitespace. */
function executable(statements) {
  return statements.filter((statement) =>
    statement
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim(),
  );
}

function databaseUrl() {
  const url = (process.env.DATABASE_URL ?? "").trim();
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Put it in .env.local at the repo root (never commit it),\n" +
        "  then run: pnpm db:migrate",
    );
  }
  if (!url.includes("sslmode=")) {
    throw new Error("DATABASE_URL has no sslmode; TigerData requires ?sslmode=require");
  }
  return url;
}

const BOOTSTRAP = `
CREATE TABLE IF NOT EXISTS schema_migrations (
    version    text PRIMARY KEY,
    checksum   text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
)`;

async function main() {
  loadEnv();
  const files = migrationFiles();
  if (files.length === 0) throw new Error(`no .sql files in ${MIGRATIONS_DIR}`);

  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  const statusOnly = args.has("--status");

  if (dryRun) {
    let total = 0;
    for (const file of files) {
      const statements = executable(splitStatements(readFileSync(file.path, "utf8")));
      total += statements.length;
      const checksum = createHash("sha256")
        .update(readFileSync(file.path))
        .digest("hex")
        .slice(0, 12);
      console.log(
        `  ${file.name.padEnd(28)} ${String(statements.length).padStart(2)} statement(s)  sha256:${checksum}`,
      );
    }
    console.log(`${files.length} file(s), ${total} statement(s). Nothing executed (--dry-run).`);
    return;
  }

  // Validate the environment before the dependency, so the first error a person
  // sees is the one they can act on.
  const dsn = databaseUrl();

  let postgres;
  try {
    ({ default: postgres } = await import("postgres"));
  } catch {
    throw new Error("the postgres package is not installed. Run: pnpm install");
  }
  const sql = postgres(dsn, { max: 1, connect_timeout: 15, onnotice: () => {} });

  try {
    await sql.unsafe(BOOTSTRAP);
    const applied = new Map(
      (await sql.unsafe("SELECT version, checksum FROM schema_migrations")).map((row) => [
        row.version,
        row.checksum,
      ]),
    );

    if (statusOnly) {
      for (const [version, checksum] of [...applied].sort()) {
        console.log(`applied  ${version}  sha256:${String(checksum).slice(0, 12)}`);
      }
      const pending = files.filter((file) => !applied.has(file.name)).map((file) => file.name);
      console.log(`pending: ${pending.length ? pending.join(", ") : "none"}`);
      return;
    }

    for (const file of files) {
      const contents = readFileSync(file.path, "utf8");
      const checksum = createHash("sha256").update(contents).digest("hex");

      if (applied.has(file.name)) {
        if (String(applied.get(file.name)) !== checksum) {
          throw new Error(
            `${file.name} was applied but the file has changed (checksum mismatch).\n` +
              "  Add a new migration instead of editing an applied one.",
          );
        }
        console.log(`skip     ${file.name} (already applied)`);
        continue;
      }

      const statements = executable(splitStatements(contents));
      await sql.begin(async (tx) => {
        for (const statement of statements) {
          await tx.unsafe(statement);
        }
        await tx.unsafe("INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)", [
          file.name,
          checksum,
        ]);
      });
      console.log(`applied  ${file.name} (${statements.length} statement(s))`);
    }
    console.log("done");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(`cannot migrate: ${error.message}`);
  process.exit(1);
});
