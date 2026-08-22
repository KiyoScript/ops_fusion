import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok, ValidationError } from "@/lib/errors";
import { getChequeService } from "@/modules/sales-audit/services";
import { bounceChequeInput } from "@/modules/sales-audit/schemas/cheque";

// POST /api/cheques/bounce — the bank returned it; the debt reopens.
export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    const parsed = bounceChequeInput.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid bounce."
      );
    }
    return NextResponse.json(
      ok(await getChequeService().bounce(actor, parsed.data))
    );
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
