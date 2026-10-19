import { afterAll, beforeAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://physio:physio_local_dev@localhost:5432/physio_test";
process.env.SESSION_SECRET = "test-session-secret-0123456789-0123456789";
process.env.CHAT_TOKEN_SECRET = "test-chat-token-secret-0123456789-012345";
process.env.APP_URL = "http://localhost:3000";
process.env.EMAIL_MODE = "test";
process.env.STAFF_NOTIFICATION_EMAILS = "staff@example.test";
process.env.EMAIL_FROM = "assistant@example.test";
process.env.AI_PROVIDER = "none";
process.env.GROQ_API_KEY = "";
process.env.CLINIC_TIMEZONE = "Asia/Kolkata";

const { getDb, closeDb } = await import("@/db/client");
const { resetEnvCache } = await import("@/lib/env");
const { resetRateLimits } = await import("@/lib/ratelimit");
const { setEmailTransport } = await import("@/lib/notify/email");
const { setClassifier } = await import("@/lib/ai/classifier");

beforeAll(async () => {
  resetEnvCache();
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
});

beforeEach(async () => {
  resetEnvCache();
  resetRateLimits();
  setEmailTransport(undefined);
  setClassifier(undefined);
  await getDb().execute(
    sql`TRUNCATE enquiries, staff_notes, status_history, notification_logs, chat_sessions, audit_logs, staff_users RESTART IDENTITY CASCADE`,
  );
});

afterAll(async () => {
  await closeDb();
});
