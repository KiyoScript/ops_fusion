import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/generated/prisma/enums";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  // Self-hosted deployment (not Vercel): trust the Host header from our
  // own reverse proxy / local server.
  trustHost: true,
  // JWT sessions: required for the Credentials provider, and lets the
  // proxy check auth without a DB round-trip per request.
  session: { strategy: "jwt" },
  pages: { signIn: "/sign-in" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = String(credentials?.email ?? "").trim().toLowerCase();
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user?.passwordHash || !user.isActive) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role,
        };
      },
    }),
    // Safe here because Google verifies email ownership; lets a seeded
    // credentials user also sign in with their Google account.
    Google({ allowDangerousEmailAccountLinking: true }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      // Invite-only ERP: Google sign-in is allowed only for emails an
      // admin has already registered (no self-signup).
      if (account?.provider === "google") {
        const existing = await prisma.user.findUnique({
          where: { email: user.email ?? "" },
        });
        return !!existing?.isActive;
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: Role }).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
      }
      return session;
    },
    authorized({ auth }) {
      // Used by proxy.ts — unauthenticated requests get redirected to /sign-in.
      return !!auth?.user;
    },
  },
});
