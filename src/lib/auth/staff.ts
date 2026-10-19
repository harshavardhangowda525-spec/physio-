import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { auditLogs, staffUsers, type StaffUser } from "@/db/schema";
import { withDb } from "@/lib/errors";
import type { Actor } from "@/lib/enquiries/service";
import { SESSION_COOKIE, verifySession } from "./token";

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
// Used to keep timing similar when the email is unknown.
const DUMMY_HASH = "$2b$12$FbQa6HqziE85fzsMVpZmo.glqKGlZqvpIoVd6VSLVK0xcJnLPKkFq";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export function passwordProblems(pw: string): string | null {
  if (pw.length < 12) return "Password must be at least 12 characters.";
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) return "Password needs upper- and lower-case letters and a number.";
  return null;
}

export type LoginResult = { ok: true; user: StaffUser } | { ok: false; error: string };

export async function authenticate(emailRaw: string, password: string): Promise<LoginResult> {
  const email = emailRaw.trim().toLowerCase();
  const generic = { ok: false as const, error: "Incorrect email or password." };
  return withDb(async () => {
    const db = getDb();
    const [user] = await db.select().from(staffUsers).where(eq(staffUsers.email, email));
    if (!user || !user.active) {
      await bcrypt.compare(password, DUMMY_HASH);
      await db.insert(auditLogs).values({ actor: email || "(blank)", action: "login_failed", detail: "unknown or inactive account" });
      return generic;
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return { ok: false, error: "Too many failed attempts. Please try again in a few minutes." };
    }
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      const failed = user.failedLogins + 1;
      await db
        .update(staffUsers)
        .set({ failedLogins: failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null })
        .where(eq(staffUsers.id, user.id));
      await db.insert(auditLogs).values({ actor: email, action: "login_failed", detail: `attempt ${failed}` });
      return generic;
    }
    await db.update(staffUsers).set({ failedLogins: 0, lockedUntil: null }).where(eq(staffUsers.id, user.id));
    await db.insert(auditLogs).values({ actor: email, action: "login" });
    return { ok: true, user };
  });
}

/**
 * Resolves the signed-in staff member, re-checking the database so deactivated
 * accounts lose access immediately. Returns null when not authorised.
 */
export async function currentStaff(): Promise<Actor | null> {
  const jar = await cookies();
  const claims = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!claims) return null;
  const [user] = await withDb(() => getDb().select().from(staffUsers).where(eq(staffUsers.id, claims.sub)));
  if (!user || !user.active) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

export async function requireStaff(): Promise<Actor> {
  const actor = await currentStaff();
  if (!actor) redirect("/dashboard/login");
  return actor;
}

export async function requireAdmin(): Promise<Actor> {
  const actor = await requireStaff();
  if (actor.role !== "ADMIN") redirect("/dashboard?error=forbidden");
  return actor;
}
