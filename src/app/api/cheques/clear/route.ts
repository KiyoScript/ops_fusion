import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok, ValidationError } from "@/lib/errors";
import { getChequeService } from "@/modules/sales-audit/services";
import { clearChequesInput } from "@/modules/sales-audit/schemas/cheque";

// POST /api/cheques/clear — the funds landed. This is when it becomes money.
export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    const parsed = clearChequesInput.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid clearing."
      );
    }
    return NextResponse.json(
      ok(await getChequeService().clear(actor, parsed.data))
    );
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
