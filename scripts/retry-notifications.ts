/** Retries failed staff notifications (max 5 attempts each). Schedule every 10–15 minutes. */
import "dotenv/config";
import { closeDb } from "../src/db/client";
import { retryFailedNotifications } from "../src/lib/notify/service";

retryFailedNotifications()
  .then(async (r) => {
    console.log(`Retried ${r.retried}; delivered/logged ${r.sent}.`);
    await closeDb();
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
