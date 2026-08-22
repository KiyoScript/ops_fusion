import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok, ValidationError } from "@/lib/errors";
import { getWithholdingService } from "@/modules/sales-audit/services";
import {
  certificateFilters,
  createCertificateInput,
} from "@/modules/sales-audit/schemas/withholding";

// GET /api/withholding-certificates?customerId=&kind=&status=&from=&to=&search=
//
// The register: certificates we hold, plus every withheld peso with no
// certificate against it. Both sides come back together because the second is
// the point — the first is only reassuring next to it.
export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = certificateFilters.safeParse(params);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid filters."
      );
    }
    const register = await getWithholdingService().getRegister(
      actor,
      parsed.data
    );
    return NextResponse.json(ok(register));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}

// POST /api/withholding-certificates — record a form that arrived, and
// optionally attach it to the collections it covers in the same act.
export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    const parsed = createCertificateInput.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid certificate."
      );
    }
    const created = await getWithholdingService().create(actor, parsed.data);
    return NextResponse.json(ok(created), { status: 201 });
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
