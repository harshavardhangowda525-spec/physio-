import { NextResponse } from "next/server";
import { currentStaff } from "@/lib/auth/staff";
import { audit, exportEnquiries, STATUS_LABEL } from "@/lib/enquiries/service";
import { PREFERENCE_LABEL } from "@/lib/notify/messages";
import { csvCell } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const actor = await currentStaff();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (actor.role !== "ADMIN") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const u = new URL(req.url);
  const rows = await exportEnquiries({
    q: u.searchParams.get("q") ?? undefined,
    status: u.searchParams.get("status") ?? undefined,
    from: u.searchParams.get("from") ?? undefined,
    to: u.searchParams.get("to") ?? undefined,
  });
  const header = ["Reference", "Patient name", "Contact number", "Preferred date", "Preferred time", "Locality", "Service requirement", "Therapist preference", "Status", "Source", "Consent at", "Created at"];
  const lines = [header.map(csvCell).join(",")];
  for (const e of rows) {
    lines.push(
      [e.reference, e.patientName, e.contactNumber, e.preferredDate, e.preferredTime, e.locality, e.serviceRequirement, PREFERENCE_LABEL[e.therapistPreference], STATUS_LABEL[e.status], e.source, e.consentAt.toISOString(), e.createdAt.toISOString()]
        .map(csvCell)
        .join(","),
    );
  }
  await audit(actor.email, "export_csv", undefined, `${rows.length} rows`);
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="enquiries-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
