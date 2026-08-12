import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok } from "@/lib/errors";
import { getCompanyService } from "@/modules/customers/services/company-service";

// GET /api/customers/companies?q= — company picker for the add-customer flow.
export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const q = new URL(request.url).searchParams.get("q") ?? "";
    const rows = await getCompanyService().searchForAdd(actor, q);
    return NextResponse.json(ok(rows));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
