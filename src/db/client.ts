import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { env } from "@/lib/env";

export type Db = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __pgPool?: Pool; __db?: Db };

function createPool(): Pool {
  return new Pool({
    connectionString: env().DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    ssl: env().DATABASE_SSL ? { rejectUnauthorized: true } : undefined,
  });
}

/** Shared Drizzle instance. Reused across hot reloads in development. */
export function getDb(): Db {
  if (!globalForDb.__db) {
    globalForDb.__pgPool = createPool();
    globalForDb.__pgPool.on("error", (err) => {
      console.error("[db] idle client error:", err.message);
    });
    globalForDb.__db = drizzle(globalForDb.__pgPool, { schema });
  }
  return globalForDb.__db;
}

export async function closeDb(): Promise<void> {
  await globalForDb.__pgPool?.end();
  globalForDb.__pgPool = undefined;
  globalForDb.__db = undefined;
}
