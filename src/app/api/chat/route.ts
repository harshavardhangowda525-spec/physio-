import { NextResponse } from "next/server";
import { handleChat } from "@/lib/chat/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return NextResponse.json({ error: "unsupported_media_type" }, { status: 415 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const r = await handleChat(body, req.headers);
  return NextResponse.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store", ...(r.headers ?? {}) } });
}
