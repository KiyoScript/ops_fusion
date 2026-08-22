// End-to-end verification for the Material Requests module.
// Run: npx tsx scripts/verify-material-requests.ts
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getMaterialService } from "../src/modules/inventory/services/material-service";
import { getMaterialRequestService } from "../src/modules/inventory/services/material-request-service";
import { getJobOrderService } from "../src/modules/job-orders/services";
import { materialInput } from "../src/modules/inventory/schemas/material";
import {
  mrDecisionInput,
  mrEditInput,
  mrReleaseInput,
  mrSubmitInput,
} from "../src/modules/inventory/schemas/material-request";
import { defineAbilityFor } from "../src/lib/ability";
import type { Actor } from "../src/lib/authz";

const PFX = "VMR-";
const CUST = "Verify MR Customer";
const dateStr = (o: number) => new Date(Date.now() + o * 86_400_000).toISOString().slice(0, 10);

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("  ✓ " + n);
  else { fails++; console.error("  ✗ " + n, x ?? ""); }
};
const errName = async (fn: () => Promise<unknown>): Promise<string> => {
  try { await fn(); return ""; } catch (e) { return (e as Error).constructor.name; }
};

async function cleanup() {
  const mark = { material: { code: { startsWith: PFX } } };
  await prisma.materialRequest.deleteMany({ where: { lines: { some: mark } } });
  await prisma.stockLedgerEntry.deleteMany({ where: { material: { code: { startsWith: PFX } } } });
  await prisma.material.deleteMany({ where: { code: { startsWith: PFX } } });
  await prisma.jobOrder.deleteMany({ where: { joNumber: { startsWith: "VMR-JO" } } });
  await prisma.customer.deleteMany({ where: { name: CUST } });
}

async function onHand(id: string): Promise<number> {
  const agg = await prisma.stockLedgerEntry.aggregate({ where: { materialId: id }, _sum: { qtyIn: true, qtyOut: true } });
  return (agg._sum.qtyIn ?? 0) - (agg._sum.qtyOut ?? 0);
}

async function main() {
  const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  const actor: Actor = { id: admin.id, role: "ADMIN" };
  const manager: Actor = { id: admin.id, role: "MANAGER" };
  const encoder: Actor = { id: admin.id, role: "ENCODER" };
  const viewer: Actor = { id: admin.id, role: "VIEWER" };
  const mats = getMaterialService();
  const mrs = getMaterialRequestService();
  const jos = getJobOrderService();
  await cleanup();

  console.log("Ability matrix (Material Requests)");
  check("ENCODER can create MR", defineAbilityFor({ role: "ENCODER" }).can("create", "MaterialRequest"));
  check("ENCODER cannot approve MR", defineAbilityFor({ role: "ENCODER" }).cannot("approve", "MaterialRequest"));
  check("ENCODER cannot release MR", defineAbilityFor({ role: "ENCODER" }).cannot("release", "MaterialRequest"));
  check("MANAGER can approve MR", defineAbilityFor({ role: "MANAGER" }).can("approve", "MaterialRequest"));
  check("MANAGER can release MR", defineAbilityFor({ role: "MANAGER" }).can("release", "MaterialRequest"));
  check("VIEWER can read MR", defineAbilityFor({ role: "VIEWER" }).can("read", "MaterialRequest"));

  console.log("Setup: 2 items (100 pcs each) + a JO");
  const paper = await mats.create(actor, materialInput.parse({ code: "VMR-001", name: "MR Paper", unit: "sheet", unitCost: 5, openingQty: 100 }));
  const ink = await mats.create(actor, materialInput.parse({ code: "VMR-002", name: "MR Ink", unit: "bottle", unitCost: 10, openingQty: 100 }));
  const jo = await jos.create(actor, {
    joNumber: "VMR-JO-1", isPO: false, customerName: CUST,
    items: [{ description: "Tarp", qty: "1", amount: "100", deadline: dateStr(1), isLFP: false, isRush: false }],
  });

  console.log("Submit — no auto-approve even for admin");
  const mr1 = await mrs.submit(actor, mrSubmitInput.parse({
    jobOrderId: jo.id,
    lines: [{ materialId: paper.id, qtyNeeded: 30 }, { materialId: ink.id, qtyNeeded: 10 }],
  }));
  let d = await mrs.get(actor, mr1.id);
  check("admin's submit is PENDING (not auto-approved)", d.status === "PENDING", d.status);
  check("MR number is MR-ORM-YYMM-#####", /^MR-ORM-\d{4}-\d{5}$/.test(d.number), d.number);
  check("linked to the JO", d.jobOrder?.joNumber === "VMR-JO-1", d.jobOrder);
  check("cost of materials = 30×5 + 10×10 = 250.00", d.costOfMaterials === "250.00", d.costOfMaterials);
  check("line snapshots system on-hand (100)", d.lines.every((l) => l.systemQtyAtRequest === 100));

  console.log("Can't release before approval");
  const early = await errName(() => mrs.release(manager, mrReleaseInput.parse({ id: mr1.id, note: "x", lines: [{ lineId: d.lines[0]!.id, qty: 1 }] })));
  check("release blocked while PENDING", early === "ValidationError", early);

  console.log("Approve");
  await mrs.approve(manager, mrDecisionInput.parse({ id: mr1.id }));
  d = await mrs.get(actor, mr1.id);
  check("status APPROVED", d.status === "APPROVED", d.status);
  check("nothing released yet → on-hand still 100", (await onHand(paper.id)) === 100 && (await onHand(ink.id)) === 100);
  const rejAfterApprove = await errName(() => mrs.reject(manager, mrDecisionInput.parse({ id: mr1.id })));
  check("reject blocked once approved (only PENDING)", rejAfterApprove === "ValidationError", rejAfterApprove);

  console.log("Release guards");
  const paperLine = d.lines.find((l) => l.materialId === paper.id)!;
  const inkLine = d.lines.find((l) => l.materialId === ink.id)!;
  const over = await errName(() => mrs.release(manager, mrReleaseInput.parse({ id: mr1.id, note: "n", lines: [{ lineId: paperLine.id, qty: 999 }] })));
  check("releasing more than needed rejected", over === "ValidationError", over);
  const noNote = mrReleaseInput.safeParse({ id: mr1.id, note: "", lines: [{ lineId: paperLine.id, qty: 1 }] });
  check("release note required (schema)", !noNote.success);

  console.log("Partial release → PARTIALLY_RELEASED, on-hand drops");
  await mrs.release(manager, mrReleaseInput.parse({ id: mr1.id, note: "first batch", lines: [
    { lineId: paperLine.id, qty: 20 }, { lineId: inkLine.id, qty: 0 },
  ] }));
  d = await mrs.get(actor, mr1.id);
  check("status PARTIALLY_RELEASED", d.status === "PARTIALLY_RELEASED", d.status);
  check("paper on-hand 80 (100−20)", (await onHand(paper.id)) === 80, await onHand(paper.id));
  check("ink untouched (100)", (await onHand(ink.id)) === 100);
  const pl = d.lines.find((l) => l.materialId === paper.id)!;
  check("paper line released 20, remaining 10", pl.qtyReleased === 20 && pl.remaining === 10, [pl.qtyReleased, pl.remaining]);
  const ledgerRel = await prisma.stockLedgerEntry.findFirst({ where: { materialId: paper.id, type: "RELEASE" }, select: { qtyOut: true, refType: true } });
  check("RELEASE ledger row written (qtyOut 20, ref MaterialRequest)", ledgerRel?.qtyOut === 20 && ledgerRel?.refType === "MaterialRequest", ledgerRel);

  console.log("Cancel blocked after any release");
  const cancelAfterRel = await errName(() => mrs.cancel(manager, mr1.id));
  check("cancel blocked once released", cancelAfterRel === "ValidationError", cancelAfterRel);

  console.log("Release the rest → RELEASED");
  await mrs.release(manager, mrReleaseInput.parse({ id: mr1.id, note: "final", lines: [
    { lineId: paperLine.id, qty: 10 }, { lineId: inkLine.id, qty: 10 },
  ] }));
  d = await mrs.get(actor, mr1.id);
  check("status RELEASED (all lines fully released)", d.status === "RELEASED", d.status);
  check("paper on-hand 70, ink 90", (await onHand(paper.id)) === 70 && (await onHand(ink.id)) === 90, [await onHand(paper.id), await onHand(ink.id)]);

  console.log("Stock guard: cannot release more than on-hand");
  const mr2 = await mrs.submit(encoder, mrSubmitInput.parse({ jobOrderId: jo.id, lines: [{ materialId: ink.id, qtyNeeded: 100 }] }));
  await mrs.approve(manager, mrDecisionInput.parse({ id: mr2.id }));
  const d2 = await mrs.get(actor, mr2.id);
  const short = await errName(() => mrs.release(manager, mrReleaseInput.parse({ id: mr2.id, note: "n", lines: [{ lineId: d2.lines[0]!.id, qty: 100 }] })));
  check("release beyond on-hand (need 100, have 90) blocked", short === "ValidationError", short);

  console.log("Edit only a REJECTED request; duplicate-JO hint");
  const mr3 = await mrs.submit(encoder, mrSubmitInput.parse({ jobOrderId: jo.id, lines: [{ materialId: paper.id, qtyNeeded: 5 }] }));
  await mrs.reject(manager, mrDecisionInput.parse({ id: mr3.id, note: "wrong qty" }));
  let d3 = await mrs.get(actor, mr3.id);
  check("rejected shows reason", d3.status === "REJECTED" && d3.decisionNote === "wrong qty", [d3.status, d3.decisionNote]);
  await mrs.edit(encoder, mrEditInput.parse({ id: mr3.id, jobOrderId: jo.id, lines: [{ materialId: paper.id, qtyNeeded: 8 }] }));
  d3 = await mrs.get(actor, mr3.id);
  check("edited rejected MR back to PENDING, qty updated", d3.status === "PENDING" && d3.lines[0]!.qtyNeeded === 8, [d3.status, d3.lines[0]!.qtyNeeded]);
  const hint = await mrs.duplicateHint(actor, jo.id);
  check("duplicate-JO hint lists existing MRs on the JO", hint.existing.length >= 3, hint.existing.length);

  console.log("RBAC (service-level)");
  const vSubmit = await errName(() => mrs.submit(viewer, mrSubmitInput.parse({ jobOrderId: jo.id, lines: [{ materialId: paper.id, qtyNeeded: 1 }] })));
  check("VIEWER cannot submit (ForbiddenError)", vSubmit === "ForbiddenError", vSubmit);
  const eApprove = await errName(() => mrs.approve(encoder, mrDecisionInput.parse({ id: mr3.id })));
  check("ENCODER cannot approve (ForbiddenError)", eApprove === "ForbiddenError", eApprove);
  const eRelease = await errName(() => mrs.release(encoder, mrReleaseInput.parse({ id: mr2.id, note: "n", lines: [{ lineId: d2.lines[0]!.id, qty: 1 }] })));
  check("ENCODER cannot release (ForbiddenError)", eRelease === "ForbiddenError", eRelease);

  await cleanup();
  console.log(fails === 0 ? "\nALL MATERIAL REQUEST CHECKS PASSED" : `\n${fails} FAILED`);
  process.exitCode = fails ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
