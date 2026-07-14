// Next.js 16: proxy.ts replaces middleware.ts (runs on the nodejs runtime).
// Auth.js's `auth` acts as the proxy: the `authorized` callback in
// src/lib/auth.ts redirects unauthenticated requests to /sign-in.
export { auth as proxy } from "@/lib/auth";

export const config = {
  // Protect everything except auth endpoints, the sign-in page, the public
  // customer quote-request portal, Next internals, and static assets.
  matcher: [
    "/((?!api/auth|api/public|sign-in|quote-request|_next/static|_next/image|favicon\\.ico).*)",
  ],
};
