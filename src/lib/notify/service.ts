import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { getDb } from "@/db/client";
import { enquiries, notificationLogs, type NotificationLog } from "@/db/schema";
import { staffRecipients } from "@/lib/env";
import { withDb } from "@/lib/errors";
import { emailTransport } from "./email";
import { buildStaffNotification, type NotificationEvent } from "./messages";

export const MAX_AUTO_ATTEMPTS = 5;

async function deliver(log: NotificationLog): Promise<NotificationLog> {
  const db = getDb();
  if (!log.enquiryId) throw new Error("Notification has no enquiry");
  const [enquiry] = await db.select().from(enquiries).where(eq(enquiries.id, log.enquiryId));
  if (!enquiry) throw new Error("Enquiry not found for notification");

  const recipients = staffRecipients();
  const { subject, text } = buildStaffNotification(enquiry, log.event as NotificationEvent);
  let outcome;
  try {
    outcome = await emailTransport().send({ to: recipients, subject, text });
  } catch (err) {
    outcome = { status: "FAILED" as const, error: err instanceof Error ? err.message : String(err) };
  }

  const patch = {
    attempts: log.attempts + 1,
    recipient: recipients.join(", ") || null,
    status: outcome.status,
    lastError:
      outcome.status === "FAILED" ? outcome.error.slice(0, 1000) : outcome.status === "SENT" ? null : outcome.note,
    providerMessageId: outcome.status === "SENT" ? outcome.providerMessageId : null,
    updatedAt: new Date(),
  };
  if (outcome.status === "FAILED") console.error(`[notify] ${log.event} for ${enquiry.reference} failed: ${patch.lastError}`);
  const [updated] = await db.update(notificationLogs).set(patch).where(eq(notificationLogs.id, log.id)).returning();
  return updated;
}

/**
 * Records and sends a staff notification. Never throws for delivery problems:
 * the enquiry is already saved, and failures are logged for retry from the dashboard.
 */
export async function notifyStaff(enquiryId: string, event: NotificationEvent): Promise<NotificationLog | null> {
  try {
    return await withDb(async () => {
      const [log] = await getDb()
        .insert(notificationLogs)
        .values({ enquiryId, channel: "email", event, status: "PENDING" })
        .returning();
      return deliver(log);
    });
  } catch (err) {
    console.error("[notify] could not record/send notification:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function retryNotification(logId: string): Promise<NotificationLog> {
  return withDb(async () => {
    const [log] = await getDb().select().from(notificationLogs).where(eq(notificationLogs.id, logId));
    if (!log) throw new Error("Notification not found");
    if (log.status === "SENT") return log;
    return deliver(log);
  });
}

/** Retries failed/pending notifications below the attempt cap. Suitable for a cron job. */
export async function retryFailedNotifications(): Promise<{ retried: number; sent: number }> {
  return withDb(async () => {
    const pending = await getDb()
      .select()
      .from(notificationLogs)
      .where(and(inArray(notificationLogs.status, ["FAILED", "PENDING"]), lt(notificationLogs.attempts, MAX_AUTO_ATTEMPTS)))
      .orderBy(desc(notificationLogs.createdAt))
      .limit(50);
    let sent = 0;
    for (const log of pending) {
      const r = await deliver(log);
      if (r.status === "SENT" || r.status === "TEST_MODE") sent++;
    }
    return { retried: pending.length, sent };
  });
}
