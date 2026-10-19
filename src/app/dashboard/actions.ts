"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ENQUIRY_STATUSES, type EnquiryStatus } from "@/db/schema";
import { authenticate } from "@/lib/auth/staff";
import { currentStaff } from "@/lib/auth/staff";
import { SESSION_COOKIE, SESSION_MAX_AGE_SEC, signSession } from "@/lib/auth/token";
import { addNote, audit, deleteEnquiry, updateStatus } from "@/lib/enquiries/service";
import { retryNotification } from "@/lib/notify/service";
import { DatabaseUnavailableError } from "@/lib/errors";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export type LoginState = { error?: string };

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const ip = clientIp(await headers());
  const limit = rateLimit(`login:${ip}`, 10, 15 * 60_000);
  if (!limit.allowed) return { error: "Too many sign-in attempts. Please wait a few minutes." };

  const email = String(form.get("email") ?? "").slice(0, 200);
  const password = String(form.get("password") ?? "").slice(0, 200);
  if (!email || !password) return { error: "Please enter your email and password." };
  let result;
  try {
    result = await authenticate(email, password);
  } catch (err) {
    if (err instanceof DatabaseUnavailableError) return { error: "The database is unavailable. Please try again shortly." };
    throw err;
  }
  if (!result.ok) return { error: result.error };
  const token = await signSession({ sub: result.user.id, role: result.user.role, name: result.user.name, email: result.user.email });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  });
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  const actor = await currentStaff().catch(() => null);
  if (actor) await audit(actor.email, "logout").catch(() => undefined);
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/dashboard/login");
}

async function staffOrRedirect() {
  const actor = await currentStaff();
  if (!actor) redirect("/dashboard/login");
  return actor;
}

export async function updateStatusAction(form: FormData): Promise<void> {
  const actor = await staffOrRedirect();
  const id = String(form.get("id") ?? "");
  const status = String(form.get("status") ?? "") as EnquiryStatus;
  if (!ENQUIRY_STATUSES.includes(status)) redirect(`/dashboard/enquiries/${id}?error=status`);
  await updateStatus(actor, id, status);
  revalidatePath(`/dashboard/enquiries/${id}`);
  redirect(`/dashboard/enquiries/${id}?saved=status`);
}

export async function addNoteAction(form: FormData): Promise<void> {
  const actor = await staffOrRedirect();
  const id = String(form.get("id") ?? "");
  const body = String(form.get("body") ?? "");
  if (!body.trim()) redirect(`/dashboard/enquiries/${id}?error=note`);
  await addNote(actor, id, body);
  revalidatePath(`/dashboard/enquiries/${id}`);
  redirect(`/dashboard/enquiries/${id}?saved=note`);
}

export async function retryNotificationAction(form: FormData): Promise<void> {
  const actor = await staffOrRedirect();
  const id = String(form.get("id") ?? "");
  const back = String(form.get("back") ?? "/dashboard/notifications");
  const r = await retryNotification(id);
  await audit(actor.email, "notification_retry", id, r.status);
  revalidatePath(back);
  redirect(`${back.startsWith("/dashboard") ? back : "/dashboard/notifications"}?retried=${r.status}`);
}

export async function deleteEnquiryAction(form: FormData): Promise<void> {
  const actor = await staffOrRedirect();
  if (actor.role !== "ADMIN") redirect("/dashboard?error=forbidden");
  const id = String(form.get("id") ?? "");
  if (String(form.get("confirm") ?? "") !== "DELETE") redirect(`/dashboard/enquiries/${id}?error=confirm`);
  await deleteEnquiry(actor, id);
  redirect("/dashboard?deleted=1");
}
