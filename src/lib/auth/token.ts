import { SignJWT, jwtVerify } from "jose";

/** Edge-safe session token helpers (used by middleware and server code). */
export const SESSION_COOKIE = "pth_staff_session";
export const SESSION_MAX_AGE_SEC = 8 * 60 * 60;

export type SessionClaims = { sub: string; role: "ADMIN" | "STAFF"; name: string; email: string };

function key(): Uint8Array {
  const secret = process.env.SESSION_SECRET ?? "";
  if (secret.length < 32) throw new Error("SESSION_SECRET must be set (32+ characters)");
  return new TextEncoder().encode(secret);
}

export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({ role: claims.role, name: claims.name, email: claims.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer("physio-home-enquiry")
    .setAudience("staff-dashboard")
    .setExpirationTime(`${SESSION_MAX_AGE_SEC}s`)
    .sign(key());
}

export async function verifySession(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { issuer: "physio-home-enquiry", audience: "staff-dashboard", algorithms: ["HS256"] });
    const role = payload.role;
    if (typeof payload.sub !== "string" || (role !== "ADMIN" && role !== "STAFF")) return null;
    return { sub: payload.sub, role, name: String(payload.name ?? ""), email: String(payload.email ?? "") };
  } catch {
    return null;
  }
}
