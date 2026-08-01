import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok, ValidationError } from "@/lib/errors";
import { getSupplierService } from "@/modules/inventory/services/supplier-service";
import { supplierListFilters } from "@/modules/inventory/schemas/material";

// GET /api/inventory/suppliers?q=&includeInactive= — supplier list.
export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = supplierListFilters.safeParse(params);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid filters."
      );
    }
    const rows = await getSupplierService().list(actor, parsed.data);
    return NextResponse.json(ok(rows));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
