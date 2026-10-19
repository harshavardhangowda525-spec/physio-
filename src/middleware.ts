import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/token";

function embedOrigins(): string {
  return (process.env.ALLOWED_EMBED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter((s) => /^https?:\/\/[a-z0-9.\-:]+$/i.test(s))
    .join(" ");
}

function securityHeaders(res: NextResponse, path: string): NextResponse {
  const isEmbed = path === "/embed";
  const frameAncestors = isEmbed ? `'self' ${embedOrigins()}`.trim() : "'none'";
  res.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      `frame-ancestors ${frameAncestors}`,
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  );
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (!isEmbed) res.headers.set("X-Frame-Options", "DENY");
  if (path.startsWith("/dashboard") || path.startsWith("/api/staff")) {
    res.headers.set("Cache-Control", "no-store");
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return res;
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const protectedPage = path.startsWith("/dashboard") && path !== "/dashboard/login";
  const protectedApi = path.startsWith("/api/staff");

  if (protectedPage || protectedApi) {
    const claims = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
    if (!claims) {
      if (protectedApi) return securityHeaders(NextResponse.json({ error: "unauthorized" }, { status: 401 }), path);
      const url = req.nextUrl.clone();
      url.pathname = "/dashboard/login";
      url.search = "";
      return securityHeaders(NextResponse.redirect(url), path);
    }
  }
  return securityHeaders(NextResponse.next(), path);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|widget.js).*)"],
};
