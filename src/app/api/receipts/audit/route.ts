import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok, ValidationError } from "@/lib/errors";
import { getReceiptService } from "@/modules/sales-audit/services";
import { auditReceiptInput } from "@/modules/sales-audit/schemas/audit";

// POST /api/receipts/audit — the auditor's sign-off (legacy verified_by).
export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    const parsed = auditReceiptInput.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid audit entry."
      );
    }
    const entry = await getReceiptService().auditReceipt(actor, parsed.data);
    return NextResponse.json(ok(entry));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
