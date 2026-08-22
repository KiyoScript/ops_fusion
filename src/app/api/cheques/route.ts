import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok, ValidationError } from "@/lib/errors";
import { getChequeService } from "@/modules/sales-audit/services";
import { chequeFilters } from "@/modules/sales-audit/schemas/cheque";

// GET /api/cheques?status=&q=&depositableOnly= — the cheque register.
export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = chequeFilters.safeParse(params);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid filters."
      );
    }
    return NextResponse.json(
      ok(await getChequeService().list(actor, parsed.data))
    );
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
