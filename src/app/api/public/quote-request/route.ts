import { NextResponse } from "next/server";
import { AppError, fail, ok, ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { sendMail, staffNotifyAddress } from "@/lib/mailer";
import { getInquiryService } from "@/modules/quotations/services";
import { portalRequestInput } from "@/modules/quotations/schemas/inquiry";

// POST /api/public/quote-request — the ONLY unauthenticated write in the
// app (successor of the legacy Customer.html portal). Protections are
// deliberately simple: a honeypot field plus a per-IP sliding window.
// Records land as PORTAL inquiries owned by the seeded system user.

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

export async function POST(request: Request) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    if (rateLimited(ip)) {
      throw new ValidationError("Too many requests — please try again later.");
    }

    const parsed = portalRequestInput.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid request."
      );
    }
    const input = parsed.data;
    // Honeypot tripped: pretend success, store nothing.
    if (input.website) return NextResponse.json(ok({ received: true }));
    if (!input.contactNumber?.trim() && !input.email?.trim()) {
      throw new ValidationError("Leave a contact number or an email so we can reach you.");
    }

    const portalUser = await prisma.user.findUnique({
      where: { email: "portal@ops.local" },
      select: { id: true },
    });
    if (!portalUser) {
      throw new AppError("Portal is not provisioned — run the database seed.");
    }

    const created = await getInquiryService().createFromPortal(
      portalUser.id,
      input
    );

    // Best-effort staff heads-up (no-op without SMTP config).
    const to = staffNotifyAddress();
    if (to) {
      await sendMail({
        to,
        subject: `New quote request — ${input.customerName}`,
        text: [
          `A new quote request arrived through the portal.`,
          ``,
          `Customer: ${input.customerName}`,
          `Contact:  ${input.contactNumber || "—"}`,
          `Email:    ${input.email || "—"}`,
          `Request:  ${input.servicesRequested}`,
          input.notes ? `Notes:    ${input.notes}` : ``,
          ``,
          `Open the Inquiries page to create a quotation from it.`,
        ]
          .filter(Boolean)
          .join("\n"),
      });
    }

    return NextResponse.json(ok({ received: true, id: created.id }));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
