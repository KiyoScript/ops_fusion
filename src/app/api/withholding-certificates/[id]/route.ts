import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok, ValidationError } from "@/lib/errors";
import { getWithholdingService } from "@/modules/sales-audit/services";
import {
  updateCertificateInput,
  voidCertificateInput,
} from "@/modules/sales-audit/schemas/withholding";

// GET /api/withholding-certificates/:id — one certificate with the
// collections it covers and the variance between the two.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const cert = await getWithholdingService().get(actor, id);
    return NextResponse.json(ok(cert));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}

// PATCH /api/withholding-certificates/:id — amend the paper's details.
//
// `kind` and `customerId` are not amendable: either would orphan every
// withholding already linked. Void it and record the right one instead.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const parsed = updateCertificateInput.safeParse({
      ...(await request.json()),
      id,
    });
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid certificate."
      );
    }
    const updated = await getWithholdingService().update(actor, parsed.data);
    return NextResponse.json(ok(updated));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}

// DELETE /api/withholding-certificates/:id — void it (R11: never a hard
// delete). Every withholding it claimed goes back on the chase list.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const parsed = voidCertificateInput.safeParse({
      ...(await request.json()),
      id,
    });
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Say why the certificate is void."
      );
    }
    const voided = await getWithholdingService().voidCertificate(
      actor,
      parsed.data
    );
    return NextResponse.json(ok(voided));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
