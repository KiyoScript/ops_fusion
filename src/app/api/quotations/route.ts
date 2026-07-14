import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok, ValidationError } from "@/lib/errors";
import { getQuotationService } from "@/modules/quotations/services";
import { quotationListFilters } from "@/modules/quotations/schemas/quotation";

// GET /api/quotations?q=&status=&cursor=&take= — paginated list for the table.
export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = quotationListFilters.safeParse(params);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid filters."
      );
    }
    const page = await getQuotationService().list(actor, parsed.data);
    return NextResponse.json(ok(page));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
