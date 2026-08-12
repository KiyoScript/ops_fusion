import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok } from "@/lib/errors";
import { getCompanyService } from "@/modules/customers/services/company-service";
import type { VatStatus } from "@/generated/prisma/enums";

// GET /api/customers/companies/list?q=&vatStatus=&cursor= — paginated company
// directory for the Customers → Companies tab.
export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const sp = new URL(request.url).searchParams;
    const q = sp.get("q") ?? undefined;
    const cursor = sp.get("cursor") ?? undefined;
    const vatRaw = sp.get("vatStatus");
    const vatStatus = (["VAT", "NON_VAT", "NO_TIN"].includes(vatRaw ?? "")
      ? vatRaw
      : undefined) as VatStatus | undefined;
    const page = await getCompanyService().list(actor, q, cursor, 30, vatStatus);
    return NextResponse.json(ok(page));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
