import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok, ValidationError } from "@/lib/errors";
import { getWithholdingService } from "@/modules/sales-audit/services";
import {
  linkAllocationsInput,
  unlinkAllocationsInput,
} from "@/modules/sales-audit/schemas/withholding";

// GET /api/withholding-certificates/:id/allocations — what this form could
// still cover: the same customer's unclaimed withholdings of the same tax.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const rows = await getWithholdingService().listLinkable(actor, id);
    return NextResponse.json(ok(rows));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}

// POST /api/withholding-certificates/:id/allocations — claim withholdings
// under this certificate.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const parsed = linkAllocationsInput.safeParse({
      ...(await request.json()),
      certificateId: id,
    });
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Choose which collections it covers."
      );
    }
    const linked = await getWithholdingService().link(actor, parsed.data);
    return NextResponse.json(ok(linked));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}

// DELETE /api/withholding-certificates/:id/allocations — release them back
// onto the chase list without voiding the certificate itself.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const parsed = unlinkAllocationsInput.safeParse({
      ...(await request.json()),
      certificateId: id,
    });
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Choose which ones to release."
      );
    }
    const unlinked = await getWithholdingService().unlink(actor, parsed.data);
    return NextResponse.json(ok(unlinked));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
