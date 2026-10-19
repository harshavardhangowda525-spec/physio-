import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { staffUsers } from "@/db/schema";
import { middleware } from "@/middleware";
import { SESSION_COOKIE, signSession } from "@/lib/auth/token";
import { authenticate, hashPassword } from "@/lib/auth/staff";

const cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (cookieStore.has(k) ? { value: cookieStore.get(k) } : undefined) }),
  headers: async () => new Headers(),
}));

async function makeUser(role: "ADMIN" | "STAFF", active = true) {
  const [u] = await getDb()
    .insert(staffUsers)
    .values({ email: `${role.toLowerCase()}@example.test`, name: `${role} user`, role, active, passwordHash: await hashPassword("Correct-horse-42") })
    .returning();
  return u;
}

describe("10. unauthorised dashboard access", () => {
  it("redirects anonymous visitors from dashboard pages to login", async () => {
    for (const path of ["/dashboard", "/dashboard/enquiries/abc", "/dashboard/settings"]) {
      const res = await middleware(new NextRequest(`http://localhost${path}`));
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe("http://localhost/dashboard/login");
    }
  });

  it("returns 401 for staff APIs without a session", async () => {
    const res = await middleware(new NextRequest("http://localhost/api/staff/export"));
    expect(res.status).toBe(401);
  });

  it("rejects forged and tampered tokens", async () => {
    const good = await signSession({ sub: "x", role: "STAFF", name: "n", email: "e" });
    const [h, p, s] = good.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ sub: "x", role: "ADMIN" })).toString("base64url");
    for (const bad of [`${h}.${forgedPayload}.${s}`, "not-a-jwt", `${h}.${p}.${s.slice(0, -2)}AA`]) {
      const req = new NextRequest("http://localhost/dashboard", { headers: { cookie: `${SESSION_COOKIE}=${bad}` } });
      expect((await middleware(req)).status).toBe(307);
    }
  });

  it("allows a valid session through and sets no-store + noindex headers", async () => {
    const tok = await signSession({ sub: "x", role: "STAFF", name: "n", email: "e" });
    const res = await middleware(new NextRequest("http://localhost/dashboard", { headers: { cookie: `${SESSION_COOKIE}=${tok}` } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("only the embed page may be framed, and only by allowed origins", async () => {
    process.env.ALLOWED_EMBED_ORIGINS = "https://physiotherapytreatmentathome.com, javascript:alert(1)";
    const res = await middleware(new NextRequest("http://localhost/embed"));
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toContain("frame-ancestors 'self' https://physiotherapytreatmentathome.com");
    expect(csp).not.toContain("javascript");
    expect(res.headers.get("x-frame-options")).toBeNull();
    delete process.env.ALLOWED_EMBED_ORIGINS;
  });

  it("CSV export: 401 without login, 403 for non-admin staff, 200 for admin", async () => {
    const { GET } = await import("@/app/api/staff/export/route");
    cookieStore.clear();
    expect((await GET(new Request("http://localhost/api/staff/export"))).status).toBe(401);

    const staff = await makeUser("STAFF");
    cookieStore.set(SESSION_COOKIE, await signSession({ sub: staff.id, role: "STAFF", name: staff.name, email: staff.email }));
    expect((await GET(new Request("http://localhost/api/staff/export"))).status).toBe(403);

    const admin = await makeUser("ADMIN");
    cookieStore.set(SESSION_COOKIE, await signSession({ sub: admin.id, role: "ADMIN", name: admin.name, email: admin.email }));
    const ok = await GET(new Request("http://localhost/api/staff/export"));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("text/csv");
  });

  it("a deactivated account loses access even with an unexpired token", async () => {
    const { currentStaff } = await import("@/lib/auth/staff");
    const u = await makeUser("ADMIN", false);
    cookieStore.set(SESSION_COOKIE, await signSession({ sub: u.id, role: "ADMIN", name: u.name, email: u.email }));
    expect(await currentStaff()).toBeNull();
  });

  it("locks an account after repeated wrong passwords", async () => {
    await makeUser("STAFF");
    for (let i = 0; i < 5; i++) expect((await authenticate("staff@example.test", "wrong-password")).ok).toBe(false);
    const r = await authenticate("staff@example.test", "Correct-horse-42");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Too many failed attempts/);
  });

  it("gives the same error for unknown emails and wrong passwords", async () => {
    await makeUser("STAFF");
    const a = await authenticate("nobody@example.test", "x");
    const b = await authenticate("staff@example.test", "x");
    expect(a).toEqual(b);
  });
});
