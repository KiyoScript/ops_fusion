import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok } from "@/lib/errors";
import { getMaterialService } from "@/modules/inventory/services/material-service";

// GET /api/inventory/materials/options — prefixes + suppliers for the item form.
// GET /api/inventory/materials/options?prefix=PAP — also suggests the next code.
export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const prefix = new URL(request.url).searchParams.get("prefix");
    const svc = getMaterialService();
    const options = await svc.getFormOptions(actor);
    const suggestedCode = prefix
      ? (await svc.suggestCode(actor, prefix)).code
      : null;
    return NextResponse.json(ok({ ...options, suggestedCode }));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
