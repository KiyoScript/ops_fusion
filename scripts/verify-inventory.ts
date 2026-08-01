// End-to-end verification for the Inventory Core module.
// Run: npx tsx scripts/verify-inventory.ts
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getMaterialService } from "../src/modules/inventory/services/material-service";
import { getSupplierService } from "../src/modules/inventory/services/supplier-service";
import { getStockAdjustmentService } from "../src/modules/inventory/services/stock-adjustment-service";
import { getCycleCountService } from "../src/modules/inventory/services/cycle-count-service";
import {
  materialInput,
  supplierInput,
} from "../src/modules/inventory/schemas/material";
import {
  adjustmentInput,
  cycleCountInput,
} from "../src/modules/inventory/schemas/stock";
import { defineAbilityFor } from "../src/lib/ability";
import type { Actor } from "../src/lib/authz";

const PFX = "VINV-"; // marker for verify-run materials
const SUPPLIER = "Verify INV Supplier";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("  ✓ " + n);
  else {
    fails++;
    console.error("  ✗ " + n, x ?? "");
  }
};
const errName = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
    return "";
  } catch (e) {
    return (e as Error).constructor.name;
  }
};

async function cleanup() {
  const mark = { material: { code: { startsWith: PFX } } };
  await prisma.stockAdjustment.deleteMany({ where: { lines: { some: mark } } });
  await prisma.cycleCount.deleteMany({ where: { lines: { some: mark } } });
  await prisma.stockLedgerEntry.deleteMany({
    where: { material: { code: { startsWith: PFX } } },
  });
  await prisma.material.deleteMany({ where: { code: { startsWith: PFX } } });
  await prisma.supplier.deleteMany({ where: { name: SUPPLIER } });
}

async function onHand(mats: ReturnType<typeof getMaterialService>, actor: Actor, id: string) {
  return (await mats.get(actor, id)).onHand;
}

async function main() {
  const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  const actor: Actor = { id: admin.id, role: "ADMIN" };
  const manager: Actor = { id: admin.id, role: "MANAGER" };
  const encoder: Actor = { id: admin.id, role: "ENCODER" };
  const viewer: Actor = { id: admin.id, role: "VIEWER" };

  const mats = getMaterialService();
  const sups = getSupplierService();
  const adjs = getStockAdjustmentService();
  const counts = getCycleCountService();
  await cleanup();

  console.log("Ability matrix (Inventory)");
  check("MANAGER can maintain Material", defineAbilityFor({ role: "MANAGER" }).can("maintain", "Material"));
  check("ENCODER cannot maintain Material", defineAbilityFor({ role: "ENCODER" }).cannot("maintain", "Material"));
  check("ENCODER can create StockAdjustment", defineAbilityFor({ role: "ENCODER" }).can("create", "StockAdjustment"));
  check("ENCODER cannot approve StockAdjustment", defineAbilityFor({ role: "ENCODER" }).cannot("approve", "StockAdjustment"));
  check("MANAGER can approve StockAdjustment", defineAbilityFor({ role: "MANAGER" }).can("approve", "StockAdjustment"));
  check("VIEWER can read Material", defineAbilityFor({ role: "VIEWER" }).can("read", "Material"));
  check("VIEWER cannot create StockAdjustment", defineAbilityFor({ role: "VIEWER" }).cannot("create", "StockAdjustment"));

  console.log("Supplier + item master");
  const sup = await sups.create(actor, supplierInput.parse({ name: SUPPLIER, phone: "0999" }));
  const paper = await mats.create(
    actor,
    materialInput.parse({
      code: "VINV-001",
      name: "Sample Paper A4",
      category: "Paper",
      unit: "sheet",
      packSize: 500,
      unitCost: 2.5,
      unitPrice: 1200,
      reorderLevel: 20,
      supplierId: sup.id,
      openingQty: 100,
    })
  );
  check("material created", !!paper.id);
  check("opening stock → on-hand 100 (derived)", (await onHand(mats, actor, paper.id)) === 100, await onHand(mats, actor, paper.id));

  const detail = await mats.get(actor, paper.id);
  check("detail shows supplier", detail.supplier?.name === SUPPLIER, detail.supplier);
  check("detail has an OPENING ledger row", detail.movements.some((m) => m.type === "OPENING" && m.qtyIn === 100), detail.movements.map((m) => m.type));
  check("newest movement balance = on-hand", detail.movements[0]?.balance === 100, detail.movements[0]?.balance);
  check("stock value = 100 × 2.50 = 250.00", detail.stockValue === "250.00", detail.stockValue);
  check("not below reorder (100 ≥ 20)", detail.belowReorder === false, detail.belowReorder);

  console.log("Prefix code suggestion + uniqueness");
  const suggested = await mats.suggestCode(actor, "VINV");
  check("suggestCode('VINV') → VINV-002", suggested.code === "VINV-002", suggested.code);
  const dup = await errName(() => mats.create(actor, materialInput.parse({ code: "VINV-001", name: "dup", unitCost: 1 })));
  check("duplicate code rejected (ConflictError)", dup === "ConflictError", dup);
  const newPfx = await mats.suggestCode(actor, "gsm");
  check("brand-new prefix suggests -001", newPfx.code === "GSM-001", newPfx.code);

  console.log("Stock adjustment — NO auto-approve, even for admin");
  const adj1 = await adjs.request(actor, adjustmentInput.parse({
    reason: "Found extra stock",
    lines: [{ materialId: paper.id, qtyDelta: 50 }],
  }));
  const adj1Detail = await adjs.get(actor, adj1.id);
  check("admin's request is PENDING (not auto-approved)", adj1Detail.status === "PENDING", adj1Detail.status);
  check("adjustment number is ADJ-ORM-YYMM-#####", /^ADJ-ORM-\d{4}-\d{5}$/.test(adj1Detail.number), adj1Detail.number);
  check("PENDING adjustment posts NOTHING to ledger (on-hand still 100)", (await onHand(mats, actor, paper.id)) === 100, await onHand(mats, actor, paper.id));

  await adjs.approve(manager, { id: adj1.id });
  check("approved → on-hand 150", (await onHand(mats, actor, paper.id)) === 150, await onHand(mats, actor, paper.id));
  const reApprove = await errName(() => adjs.approve(manager, { id: adj1.id }));
  check("re-approving a decided adjustment rejected", reApprove === "ValidationError", reApprove);

  console.log("Adjustment guards");
  const adjNeg = await adjs.request(actor, adjustmentInput.parse({
    reason: "Over-issue", lines: [{ materialId: paper.id, qtyDelta: -1000 }],
  }));
  const negApprove = await errName(() => adjs.approve(manager, { id: adjNeg.id }));
  check("approval that drives on-hand negative is blocked", negApprove === "ValidationError", negApprove);
  check("blocked approval left on-hand at 150", (await onHand(mats, actor, paper.id)) === 150, await onHand(mats, actor, paper.id));

  const adjRej = await adjs.request(actor, adjustmentInput.parse({
    reason: "Mistake", lines: [{ materialId: paper.id, qtyDelta: 10 }],
  }));
  await adjs.reject(manager, { id: adjRej.id, note: "not needed" });
  const adjRejDetail = await adjs.get(actor, adjRej.id);
  check("rejected adjustment marked REJECTED", adjRejDetail.status === "REJECTED", adjRejDetail.status);
  check("rejected adjustment posts nothing (on-hand still 150)", (await onHand(mats, actor, paper.id)) === 150, await onHand(mats, actor, paper.id));

  console.log("Cycle count — physical count becomes truth");
  const cc = await counts.create(encoder, cycleCountInput.parse({
    location: "Shelf A",
    lines: [{ materialId: paper.id, countedQty: 140 }],
  }));
  const ccDraft = await counts.get(actor, cc.id);
  check("count number is CC-ORM-YYMM-#####", /^CC-ORM-\d{4}-\d{5}$/.test(ccDraft.number), ccDraft.number);
  check("count snapshots systemQty 150, variance -10", ccDraft.lines[0]?.systemQty === 150 && ccDraft.lines[0]?.variance === -10, ccDraft.lines[0]);
  check("draft count posts nothing yet (on-hand 150)", (await onHand(mats, actor, paper.id)) === 150);
  const approveBeforeSubmit = await errName(() => counts.approve(manager, { id: cc.id }));
  check("can't approve a DRAFT count (must submit first)", approveBeforeSubmit === "ValidationError", approveBeforeSubmit);

  await counts.submit(encoder, cc.id);
  await counts.approve(manager, { id: cc.id });
  check("approved count sets on-hand to the counted 140", (await onHand(mats, actor, paper.id)) === 140, await onHand(mats, actor, paper.id));
  const ccApproved = await counts.get(actor, cc.id);
  check("approved count is APPROVED", ccApproved.status === "APPROVED", ccApproved.status);

  console.log("Reorder report");
  const glue = await mats.create(actor, materialInput.parse({
    code: "VINV-002", name: "Sample Glue", category: "Adhesive",
    unitCost: 15, reorderLevel: 50, openingQty: 10,
  }));
  const reorder = await mats.reorderReport(actor);
  const glueRow = reorder.find((r) => r.id === glue.id);
  check("below-reorder item appears in reorder report", !!glueRow, reorder.map((r) => r.code));
  check("reorder shortBy = 50 − 10 = 40", glueRow?.shortBy === 40, glueRow?.shortBy);
  check("healthy item (paper 140 ≥ 20) NOT in reorder report", !reorder.some((r) => r.id === paper.id));

  console.log("RBAC (service-level)");
  const vMat = await errName(() => mats.create(viewer, materialInput.parse({ code: "VINV-099", name: "x", unitCost: 1 })));
  check("VIEWER cannot create material (ForbiddenError)", vMat === "ForbiddenError", vMat);
  const eMat = await errName(() => mats.create(encoder, materialInput.parse({ code: "VINV-098", name: "x", unitCost: 1 })));
  check("ENCODER cannot maintain material (ForbiddenError)", eMat === "ForbiddenError", eMat);
  const eApprove = await errName(() => adjs.approve(encoder, { id: adj1.id }));
  check("ENCODER cannot approve adjustment (ForbiddenError)", eApprove === "ForbiddenError", eApprove);
  const vAdj = await errName(() => adjs.request(viewer, adjustmentInput.parse({ reason: "x", lines: [{ materialId: paper.id, qtyDelta: 1 }] })));
  check("VIEWER cannot request adjustment (ForbiddenError)", vAdj === "ForbiddenError", vAdj);

  console.log("Archive guard (must zero stock first)");
  const archiveWithStock = await errName(() => mats.archive(actor, paper.id));
  check("cannot archive an item that still has stock", archiveWithStock === "ValidationError", archiveWithStock);
  const zero = await adjs.request(actor, adjustmentInput.parse({ reason: "Zero out to retire", lines: [{ materialId: paper.id, qtyDelta: -140 }] }));
  await adjs.approve(manager, { id: zero.id });
  check("zeroed out → on-hand 0", (await onHand(mats, actor, paper.id)) === 0, await onHand(mats, actor, paper.id));
  await mats.archive(actor, paper.id);
  const goneList = await mats.list(actor, { q: "VINV-001", take: 25 });
  check("archived item drops out of the list", !goneList.rows.some((r) => r.id === paper.id));

  await cleanup();
  console.log(fails === 0 ? "\nALL INVENTORY CHECKS PASSED" : `\n${fails} FAILED`);
  process.exitCode = fails ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
