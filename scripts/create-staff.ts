/**
 * Create or reset a staff account.
 *   npm run staff:create -- --email staff@clinic.example --name "Asha" --role ADMIN
 * The password is read from STAFF_PASSWORD or prompted (never passed as an argument).
 */
import "dotenv/config";
import { createInterface } from "readline";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "../src/db/client";
import { staffUsers, auditLogs } from "../src/db/schema";
import { hashPassword, passwordProblems } from "../src/lib/auth/staff";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function ask(q: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(q, (a) => (rl.close(), res(a))));
}

async function main() {
  const email = (arg("email") ?? "").trim().toLowerCase();
  const name = arg("name") ?? "";
  const role = (arg("role") ?? "STAFF").toUpperCase();
  if (!email || !name || !["ADMIN", "STAFF"].includes(role)) {
    console.error('Usage: npm run staff:create -- --email you@clinic.example --name "Your Name" [--role ADMIN|STAFF]');
    process.exit(1);
  }
  const password = process.env.STAFF_PASSWORD ?? (await ask("Password (12+ chars, mixed case + number): "));
  const problem = passwordProblems(password);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
  const db = getDb();
  const passwordHash = await hashPassword(password);
  const [existing] = await db.select().from(staffUsers).where(eq(staffUsers.email, email));
  if (existing) {
    await db.update(staffUsers).set({ name, role: role as "ADMIN" | "STAFF", passwordHash, active: true, failedLogins: 0, lockedUntil: null }).where(eq(staffUsers.id, existing.id));
    console.log(`Updated ${email} (${role}).`);
  } else {
    await db.insert(staffUsers).values({ email, name, role: role as "ADMIN" | "STAFF", passwordHash });
    console.log(`Created ${email} (${role}).`);
  }
  await db.insert(auditLogs).values({ actor: "cli", action: existing ? "staff_updated" : "staff_created", target: email });
  await closeDb();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
