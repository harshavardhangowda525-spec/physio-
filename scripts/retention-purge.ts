/**
 * Deletes closed enquiries older than RETENTION_DAYS and expired chat drafts.
 * Run daily (cron / scheduled job):  npm run retention:purge
 * Add --dry-run to see what would be deleted.
 */
import "dotenv/config";
import { and, inArray, lt } from "drizzle-orm";
import { closeDb, getDb } from "../src/db/client";
import { auditLogs, enquiries } from "../src/db/schema";
import { env } from "../src/lib/env";
import { purgeExpiredChatSessions } from "../src/lib/chat/session";

async function main() {
  const dry = process.argv.includes("--dry-run");
  const cutoff = new Date(Date.now() - env().RETENTION_DAYS * 86_400_000);
  const where = and(lt(enquiries.updatedAt, cutoff), inArray(enquiries.status, ["COMPLETED", "CANCELLED", "CONFIRMED", "AWAITING_PATIENT_RESPONSE"]));
  const db = getDb();
  if (dry) {
    const rows = await db.select({ ref: enquiries.reference }).from(enquiries).where(where);
    console.log(`[dry-run] would delete ${rows.length} enquiries last updated before ${cutoff.toISOString()}`);
  } else {
    const rows = await db.delete(enquiries).where(where).returning({ ref: enquiries.reference });
    const chats = await purgeExpiredChatSessions();
    await db.insert(auditLogs).values({ actor: "retention-job", action: "retention_purge", detail: `${rows.length} enquiries, ${chats} chat drafts` });
    console.log(`Deleted ${rows.length} enquiries and ${chats} expired chat drafts.`);
  }
  await closeDb();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
