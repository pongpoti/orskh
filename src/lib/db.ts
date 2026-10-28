import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { Pool, type PoolClient } from "pg";
import { databaseUrl, onVercel } from "./env";
import { SCHEMA_SQL } from "./schema";

let pool: Pool | null = null;
let poolUrl = "";
let schemaReady: Promise<void> | null = null;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", ""]);

/** Small pool; TLS with certificate verification for any non-local host (e.g. Neon). */
export function createPool(url: string): Pool {
  const u = new URL(url);
  const local = LOCAL_HOSTS.has(u.hostname);
  // TLS is configured explicitly below; drop libpq-style params so they cannot weaken it.
  for (const k of ["sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat", "channel_binding"]) {
    u.searchParams.delete(k);
  }
  const p = new Pool({
    connectionString: u.toString(),
    max: onVercel() ? 3 : 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl: local ? false : { rejectUnauthorized: true },
  });
  p.on("error", (e) => console.error("[db] idle client error:", e.message));
  if (onVercel()) attachDatabasePool(p);
  return p;
}

/** Applies db/schema.sql (idempotent) under an advisory lock so concurrent instances do not race. */
export async function ensureSchema(p: Pool): Promise<void> {
  await withTx(p, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext('orskh:schema'))");
    await c.query(SCHEMA_SQL);
  });
}

/** Pool for DATABASE_URL with the schema applied (memoized per instance). */
export async function db(): Promise<Pool> {
  const url = databaseUrl();
  if (!pool || poolUrl !== url) {
    pool = createPool(url);
    poolUrl = url;
    schemaReady = null;
  }
  const p = pool;
  if (!schemaReady) {
    schemaReady = ensureSchema(p).catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  await schemaReady;
  return p;
}

export async function withTx<T>(p: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await p.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
