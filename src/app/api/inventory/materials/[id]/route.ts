import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok } from "@/lib/errors";
import { getMaterialService } from "@/modules/inventory/services/material-service";

// GET /api/inventory/materials/:id — item detail + on-hand + movement history.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const material = await getMaterialService().get(actor, id);
    return NextResponse.json(ok(material));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
