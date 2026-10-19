import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness + database check for uptime monitors. Exposes no configuration details. */
export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return NextResponse.json({ ok: true, database: "up" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, database: "down" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
