// End-to-end verification for the DR module. Run: npx tsx scripts/verify-dr.ts
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getJobOrderService } from "../src/modules/job-orders/services";
import { getDeliveryReceiptService } from "../src/modules/delivery-receipts/services";
import { defineAbilityFor } from "../src/lib/ability";
import type { Actor } from "../src/lib/authz";

const dateStr = (o: number) =>
  new Date(Date.now() + o * 86_400_000).toISOString().slice(0, 10);

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("  ✓ " + n);
  else {
    fails++;
    console.error("  ✗ " + n, x ?? "");
  }
};

async function cleanup() {
  await prisma.deliveryReceipt.deleteMany({ where: { jobOrder: { joNumber: { startsWith: "VDR-" } } } });
  await prisma.jobOrder.deleteMany({ where: { joNumber: { startsWith: "VDR-" } } });
  await prisma.customer.deleteMany({ where: { name: "Verify DR Customer" } });
}

async function main() {
  const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  const actor: Actor = { id: admin.id, role: admin.role };
  const viewer: Actor = { id: admin.id, role: "VIEWER" };
  const jos = getJobOrderService();
  const drs = getDeliveryReceiptService();
  await cleanup();

  console.log("Ability matrix (DR)");
  check("ADMIN can issue DR", defineAbilityFor({ role: "ADMIN" }).can("issue", "DeliveryReceipt"));
  check("ENCODER can issue DR", defineAbilityFor({ role: "ENCODER" }).can("issue", "DeliveryReceipt"));
  check("VIEWER cannot issue DR", defineAbilityFor({ role: "VIEWER" }).cannot("issue", "DeliveryReceipt"));

  console.log("Setup: create a JO with 2 items, mark both done");
  const created = await jos.create(actor, {
    joNumber: "VDR-JO-1",
    isPO: false, isNonJo: true, customerName: "Verify DR Customer",
    items: [
      { description: "Tarpaulin 3x5", qty: "10", amount: "5000", deadline: dateStr(1), isLFP: false, isRush: false },
      { description: "Stickers", qty: "4", amount: "800", deadline: dateStr(1), isLFP: false, isRush: false },
    ],
  });
  const detail = await jos.get(actor, created.id);
  const tarp = detail.items.find((i) => i.description.startsWith("Tarpaulin"))!;
  const sticker = detail.items.find((i) => i.description === "Stickers")!;
  // mark both done (auto-archive)
  for (const it of [tarp, sticker]) {
    await jos.updateItem(actor, {
      id: it.id, jobOrderId: created.id, description: it.description,
      qty: String(it.qty), amount: it.lineTotal, productionStatus: "Done - Completed",
      isLFP: false, isRush: false,
    });
  }

  console.log("Deliverable list");
  const deliverable = await drs.listDeliverable(actor, { jobOrderId: created.id });
  check("JO appears as deliverable", deliverable.length === 1 && deliverable[0]!.joNumber === "VDR-JO-1");
  const dItems = deliverable[0]!.items;
  check("both done items deliverable, remaining = ordered", dItems.length === 2 && dItems.every((i) => i.remaining === i.qty));

  console.log("Partial issuance");
  let over = "";
  try {
    await drs.issue(actor, { jobOrderId: created.id, lines: [{ jobOrderItemId: tarp.id, qty: "999" }] });
  } catch (e) { over = (e as Error).constructor.name; }
  check("delivering more than remaining rejected", over === "ValidationError", over);

  const dr1 = await drs.issue(actor, {
    jobOrderId: created.id,
    lines: [{ jobOrderItemId: tarp.id, qty: "6" }, { jobOrderItemId: sticker.id, qty: "0" }],
  });
  const dr1Detail = await drs.get(actor, dr1.id);
  check("DR number auto-generated (DR-yyyy-####)", /^DR-\d{4}-\d{4}$/.test(dr1Detail.drNumber), dr1Detail.drNumber);
  check("DR has 1 line (zero-qty line skipped)", dr1Detail.lines.length === 1 && dr1Detail.lines[0]!.qty === 6);
  check("DR amount = 6 x unit price (3000)", dr1Detail.amount === "3000.00", dr1Detail.amount);

  const afterFirst = await drs.listDeliverable(actor, { jobOrderId: created.id });
  const tarpRemain = afterFirst[0]!.items.find((i) => i.id === tarp.id)!;
  check("tarp remaining now 4 (10-6)", tarpRemain.remaining === 4, tarpRemain.remaining);

  console.log("Second (final) issuance drains the item");
  const dr2 = await drs.issue(actor, {
    jobOrderId: created.id,
    lines: [{ jobOrderItemId: tarp.id, qty: "4" }, { jobOrderItemId: sticker.id, qty: "4" }],
  });
  const afterSecond = await drs.listDeliverable(actor, { jobOrderId: created.id });
  check("tarp fully delivered → dropped; only stickers left? no, stickers delivered too", afterSecond.length === 0, afterSecond.map((g) => g.items.length));

  console.log("Cancel returns quantities");
  await drs.cancel(actor, dr2.id);
  const afterCancel = await drs.listDeliverable(actor, { jobOrderId: created.id });
  const backItems = afterCancel[0]?.items ?? [];
  check("cancel restores deliverable quantities", backItems.some((i) => i.id === tarp.id && i.remaining === 4) && backItems.some((i) => i.id === sticker.id && i.remaining === 4), backItems.map((i) => [i.id === tarp.id ? "tarp" : "stk", i.remaining]));
  const dr2After = await drs.get(actor, dr2.id);
  check("cancelled DR marked CANCELLED", dr2After.status === "CANCELLED");

  console.log("DR list + RBAC");
  const list = await drs.list(actor, { q: "VDR-JO-1", take: 25 });
  check("DR list shows issued DRs", list.rows.length >= 2);
  let forb = "";
  try {
    await drs.issue(viewer, { jobOrderId: created.id, lines: [{ jobOrderItemId: tarp.id, qty: "1" }] });
  } catch (e) { forb = (e as Error).constructor.name; }
  check("VIEWER cannot issue (ForbiddenError)", forb === "ForbiddenError", forb);

  console.log("DR PDF printable");
  const { renderDrPdf } = await import("../src/modules/delivery-receipts/services/dr-pdf");
  const { PDFDocument } = await import("pdf-lib");
  const bytes = await renderDrPdf(dr1Detail);
  check("DR PDF has %PDF header", Buffer.from(bytes.slice(0, 5)).toString() === "%PDF-");
  check("DR PDF parses (>=1 page)", (await PDFDocument.load(bytes)).getPageCount() >= 1);

  await cleanup();
  console.log(fails === 0 ? "\nALL DR CHECKS PASSED" : `\n${fails} FAILED`);
  process.exitCode = fails ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
