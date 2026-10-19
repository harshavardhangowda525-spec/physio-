import { randomInt } from "crypto";
import { and, count, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  auditLogs,
  enquiries,
  ENQUIRY_STATUSES,
  notificationLogs,
  staffNotes,
  statusHistory,
  type Enquiry,
  type EnquiryStatus,
} from "@/db/schema";
import { CONSENT_TEXT } from "@/lib/business";
import { env } from "@/lib/env";
import { withDb } from "@/lib/errors";
import { notifyStaff } from "@/lib/notify/service";
import { enquirySubmissionSchema, todayInTz, validatePhone, clean } from "@/lib/validation";

export const STATUS_LABEL: Record<EnquiryStatus, string> = {
  NEW_ENQUIRY: "New Enquiry",
  AWAITING_CLINIC_REVIEW: "Awaiting Clinic Review",
  AWAITING_PATIENT_RESPONSE: "Awaiting Patient Response",
  CONFIRMED: "Confirmed",
  RESCHEDULE_REQUESTED: "Reschedule Requested",
  CANCELLED: "Cancelled",
  COMPLETED: "Completed",
};

/** What patients see. Only CONFIRMED (set by staff) is ever described as confirmed. */
export const PATIENT_STATUS_TEXT: Record<EnquiryStatus, string> = {
  NEW_ENQUIRY: "Received — awaiting clinic review. This is not yet a confirmed appointment.",
  AWAITING_CLINIC_REVIEW: "Awaiting clinic review. The clinic team will contact you to check availability. Not yet confirmed.",
  AWAITING_PATIENT_RESPONSE: "The clinic has tried to reach you and is waiting for your reply. Please call the clinic. Not yet confirmed.",
  CONFIRMED: "Confirmed by the clinic team. Please contact the clinic if anything changes.",
  RESCHEDULE_REQUESTED: "A change has been requested. The clinic team will contact you to arrange a new time. Not yet confirmed.",
  CANCELLED: "Cancelled.",
  COMPLETED: "Completed.",
};

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateReference(today: string): string {
  const ymd = today.replace(/-/g, "").slice(2);
  let suffix = "";
  for (let i = 0; i < 4; i++) suffix += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
  return `PTH-${ymd}-${suffix}`;
}

export type SubmitInput = {
  patientName: string;
  contactNumber: string;
  preferredDate: string;
  preferredTime: string;
  locality: string;
  serviceRequirement: string;
  therapistPreference: "NO_PREFERENCE" | "FEMALE" | "MALE";
  consent: boolean;
  consentAt: Date;
  idempotencyKey?: string;
};

export type SubmitResult =
  | { ok: true; enquiry: Enquiry; duplicate: boolean; notificationStatus: string | null }
  | { ok: false; errors: Record<string, string> };

/**
 * Validates, persists, generates a reference and notifies staff.
 * The enquiry is committed before notification, so a notification failure never loses it.
 */
export async function submitEnquiry(input: SubmitInput): Promise<SubmitResult> {
  const e = env();
  const parsed = enquirySubmissionSchema(todayInTz(e.CLINIC_TIMEZONE), e.MAX_ADVANCE_BOOKING_DAYS).safeParse(input);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[String(issue.path[0] ?? "form")] ??= issue.message;
    return { ok: false, errors };
  }
  const data = parsed.data;
  const db = getDb();

  return withDb(async () => {
    if (input.idempotencyKey) {
      const [existing] = await db.select().from(enquiries).where(eq(enquiries.idempotencyKey, input.idempotencyKey));
      if (existing) return { ok: true, enquiry: existing, duplicate: true, notificationStatus: null };
    }

    let created: Enquiry | undefined;
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      try {
        created = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(enquiries)
            .values({
              reference: generateReference(todayInTz(e.CLINIC_TIMEZONE)),
              patientName: data.patientName,
              contactNumber: data.contactNumber,
              preferredDate: data.preferredDate,
              preferredTime: data.preferredTime,
              locality: data.locality,
              serviceRequirement: data.serviceRequirement,
              therapistPreference: data.therapistPreference,
              consentAt: data.consentAt,
              consentText: CONSENT_TEXT,
              source: "WEBSITE_CHAT",
              status: "NEW_ENQUIRY",
              idempotencyKey: input.idempotencyKey ?? null,
            })
            .returning();
          await tx.insert(statusHistory).values({ enquiryId: row.id, fromStatus: null, toStatus: "NEW_ENQUIRY", changedBy: "patient (website chat)" });
          return row;
        });
      } catch (err) {
        const cause = (err as { cause?: { code?: string; constraint?: string } }).cause ?? (err as { code?: string; constraint?: string });
        if (cause?.code === "23505" && cause.constraint === "enquiries_idempotency_uq" && input.idempotencyKey) {
          const [existing] = await db.select().from(enquiries).where(eq(enquiries.idempotencyKey, input.idempotencyKey));
          if (existing) return { ok: true, enquiry: existing, duplicate: true, notificationStatus: null };
        }
        if (cause?.code === "23505" && cause.constraint === "enquiries_reference_uq") continue;
        throw err;
      }
    }
    if (!created) throw new Error("Could not allocate a unique reference");

    const log = await notifyStaff(created.id, "NEW_ENQUIRY");
    return { ok: true, enquiry: created, duplicate: false, notificationStatus: log?.status ?? "FAILED" };
  });
}

/** Looks up an enquiry only when BOTH the reference and phone number match. */
export async function findEnquiryForPatient(reference: string, phone: string): Promise<Enquiry | null> {
  const p = validatePhone(phone);
  if (!p.ok) return null;
  return withDb(async () => {
    const [row] = await getDb()
      .select()
      .from(enquiries)
      .where(and(eq(enquiries.reference, reference), eq(enquiries.contactNumber, p.value)));
    return row ?? null;
  });
}

export type PatientChangeKind = "CANCEL" | "RESCHEDULE";

export async function requestPatientChange(
  reference: string,
  phone: string,
  kind: PatientChangeKind,
  message: string,
): Promise<{ ok: true; enquiry: Enquiry } | { ok: false; reason: "not_found" | "closed" }> {
  const found = await findEnquiryForPatient(reference, phone);
  if (!found) return { ok: false, reason: "not_found" };
  if (found.status === "CANCELLED" || found.status === "COMPLETED") return { ok: false, reason: "closed" };
  const toStatus: EnquiryStatus = kind === "CANCEL" ? "CANCELLED" : "RESCHEDULE_REQUESTED";
  const note = clean(message, 400) || (kind === "CANCEL" ? "Patient asked to cancel." : "Patient asked to reschedule.");
  const updated = await withDb(() =>
    getDb().transaction(async (tx) => {
      const [row] = await tx
        .update(enquiries)
        .set({ status: toStatus, patientChangeRequest: `${kind === "CANCEL" ? "Cancel" : "Reschedule"}: ${note}`, updatedAt: new Date() })
        .where(eq(enquiries.id, found.id))
        .returning();
      await tx.insert(statusHistory).values({ enquiryId: found.id, fromStatus: found.status, toStatus, changedBy: "patient (website chat)" });
      return row;
    }),
  );
  await notifyStaff(updated.id, kind === "CANCEL" ? "PATIENT_CANCEL_REQUEST" : "PATIENT_RESCHEDULE_REQUEST");
  return { ok: true, enquiry: updated };
}

// ---------- Staff operations ----------

export type Actor = { id: string; name: string; email: string; role: "ADMIN" | "STAFF" };

export async function audit(actor: string, action: string, target?: string, detail?: string): Promise<void> {
  await withDb(() => getDb().insert(auditLogs).values({ actor, action, target: target ?? null, detail: detail ?? null }));
}

export async function updateStatus(actor: Actor, enquiryId: string, status: EnquiryStatus): Promise<Enquiry> {
  if (!ENQUIRY_STATUSES.includes(status)) throw new Error("Invalid status");
  return withDb(() =>
    getDb().transaction(async (tx) => {
      const [current] = await tx.select().from(enquiries).where(eq(enquiries.id, enquiryId)).for("update");
      if (!current) throw new Error("Enquiry not found");
      if (current.status === status) return current;
      const [row] = await tx.update(enquiries).set({ status, updatedAt: new Date() }).where(eq(enquiries.id, enquiryId)).returning();
      await tx.insert(statusHistory).values({ enquiryId, fromStatus: current.status, toStatus: status, changedBy: actor.name });
      await tx.insert(auditLogs).values({ actor: actor.email, action: "status_change", target: current.reference, detail: `${current.status} -> ${status}` });
      return row;
    }),
  );
}

export async function addNote(actor: Actor, enquiryId: string, body: string): Promise<void> {
  const text = body.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, 2000);
  if (!text) throw new Error("Note is empty");
  await withDb(() => getDb().insert(staffNotes).values({ enquiryId, authorId: actor.id, authorName: actor.name, body: text }));
}

export async function deleteEnquiry(actor: Actor, enquiryId: string): Promise<void> {
  if (actor.role !== "ADMIN") throw new Error("Only admins can delete records");
  await withDb(async () => {
    const [row] = await getDb().delete(enquiries).where(eq(enquiries.id, enquiryId)).returning({ reference: enquiries.reference });
    if (row) await audit(actor.email, "delete_enquiry", row.reference, "Patient record permanently deleted");
  });
}

export type EnquiryFilters = { q?: string; status?: string; from?: string; to?: string; page?: number };
export const PAGE_SIZE = 25;

function filterWhere(f: EnquiryFilters): SQL | undefined {
  const parts: SQL[] = [];
  const q = f.q?.trim();
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    const digits = q.replace(/\D/g, "");
    const conds = [ilike(enquiries.patientName, like), ilike(enquiries.reference, like), ilike(enquiries.locality, like)];
    if (digits.length >= 4) conds.push(ilike(enquiries.contactNumber, `%${digits.slice(-10)}%`));
    parts.push(or(...conds)!);
  }
  if (f.status && (ENQUIRY_STATUSES as readonly string[]).includes(f.status)) parts.push(eq(enquiries.status, f.status as EnquiryStatus));
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) parts.push(gte(enquiries.preferredDate, f.from));
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) parts.push(lte(enquiries.preferredDate, f.to));
  return parts.length ? and(...parts) : undefined;
}

export async function listEnquiries(f: EnquiryFilters): Promise<{ rows: Enquiry[]; total: number }> {
  const page = Math.max(1, f.page ?? 1);
  const where = filterWhere(f);
  return withDb(async () => {
    const db = getDb();
    const rows = await db.select().from(enquiries).where(where).orderBy(desc(enquiries.createdAt)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE);
    const [{ value }] = await db.select({ value: count() }).from(enquiries).where(where);
    return { rows, total: Number(value) };
  });
}

export async function exportEnquiries(f: EnquiryFilters): Promise<Enquiry[]> {
  return withDb(() => getDb().select().from(enquiries).where(filterWhere(f)).orderBy(desc(enquiries.createdAt)).limit(10000));
}

export async function getEnquiryDetail(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return withDb(async () => {
    const db = getDb();
    const [enquiry] = await db.select().from(enquiries).where(eq(enquiries.id, id));
    if (!enquiry) return null;
    const notes = await db.select().from(staffNotes).where(eq(staffNotes.enquiryId, id)).orderBy(desc(staffNotes.createdAt));
    const history = await db.select().from(statusHistory).where(eq(statusHistory.enquiryId, id)).orderBy(desc(statusHistory.createdAt));
    const notifications = await db.select().from(notificationLogs).where(eq(notificationLogs.enquiryId, id)).orderBy(desc(notificationLogs.createdAt));
    return { enquiry, notes, history, notifications };
  });
}

export async function enquiryMetrics() {
  return withDb(async () => {
    const db = getDb();
    const byStatus = await db.select({ status: enquiries.status, n: count() }).from(enquiries).groupBy(enquiries.status);
    const [{ last7 }] = await db
      .select({ last7: count() })
      .from(enquiries)
      .where(gte(enquiries.createdAt, sql`now() - interval '7 days'`));
    const map = Object.fromEntries(ENQUIRY_STATUSES.map((s) => [s, 0])) as Record<EnquiryStatus, number>;
    for (const r of byStatus) map[r.status] = Number(r.n);
    const total = Object.values(map).reduce((a, b) => a + b, 0);
    return { byStatus: map, total, last7Days: Number(last7) };
  });
}
