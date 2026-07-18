// Next.js 16: proxy.ts replaces middleware.ts (runs on the nodejs runtime).
// The wrapper below redirects unauthenticated requests to /sign-in (JWT only,
// no DB round-trip) and, for authed requests, forwards the pathname as a
// header so the app layout can guard disabled feature modules without every
// page having to opt in.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export default auth((req) => {
  if (!req.auth) {
    const signIn = new URL("/sign-in", req.nextUrl.origin);
    signIn.searchParams.set("callbackUrl", req.nextUrl.href);
    return NextResponse.redirect(signIn);
  }
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-ops-pathname", req.nextUrl.pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
});

export const config = {
  // Protect everything except auth endpoints, the sign-in page, the public
  // customer quote-request portal, Next internals, and static assets.
  matcher: [
    "/((?!api/auth|api/public|sign-in|quote-request|_next/static|_next/image|favicon\\.ico).*)",
  ],
};
