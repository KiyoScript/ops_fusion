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
    isPO: false, customerName: "Verify DR Customer",
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
  check("partial DR flagged Partial (stickers + rest of tarp remain)", dr1Detail.isFullDelivery === false, dr1Detail.isFullDelivery);

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
  const dr2Detail = await drs.get(actor, dr2.id);
  check("final DR flagged Full (nothing left after it)", dr2Detail.isFullDelivery === true, dr2Detail.isFullDelivery);

  console.log("Cancel returns quantities");
  await drs.cancel(actor, dr2.id);
  const afterCancel = await drs.listDeliverable(actor, { jobOrderId: created.id });
  const backItems = afterCancel[0]?.items ?? [];
  check("cancel restores deliverable quantities", backItems.some((i) => i.id === tarp.id && i.remaining === 4) && backItems.some((i) => i.id === sticker.id && i.remaining === 4), backItems.map((i) => [i.id === tarp.id ? "tarp" : "stk", i.remaining]));
  const dr2After = await drs.get(actor, dr2.id);
  check("cancelled DR marked CANCELLED", dr2After.status === "CANCELLED");

  console.log("Edit which JO line items the DR delivers (Full/Partial derived)");
  // dr1 is still ISSUED: it delivers the tarp only (6 pcs) → Partial. sticker
  // is not on it; tarp remaining 4, sticker remaining 4.
  const opts = await drs.getEditOptions(actor, dr1.id);
  const optTarp = opts.items.find((i) => i.jobOrderItemId === tarp.id)!;
  const optStk = opts.items.find((i) => i.jobOrderItemId === sticker.id)!;
  check("edit options list every JO line item", opts.items.length === 2, opts.items.length);
  check("edit options flag the DR's current item", optTarp.inThisDr === true && optStk.inThisDr === false, [optTarp.inThisDr, optStk.inThisDr]);
  check("edit options flag both items deliverable (done)", optTarp.deliverable && optStk.deliverable);

  // A) add the sticker → DR now covers ALL items → Full.
  await drs.edit(actor, { id: dr1.id, jobOrderItemIds: [tarp.id, sticker.id] });
  const eA = await drs.get(actor, dr1.id);
  check("selecting all items → Full delivery", eA.isFullDelivery === true, eA.isFullDelivery);
  check("added item became a DR line", eA.lines.length === 2, eA.lines.length);
  check("added item delivers its full remaining (4)", eA.lines.some((l) => l.qty === 4) && eA.lines.some((l) => l.qty === 6), eA.lines.map((l) => l.qty));
  check("added item amount folded in (3000 + 800 = 3800)", eA.amount === "3800.00", eA.amount);
  const afterA = await drs.listDeliverable(actor, { jobOrderId: created.id });
  const stkGoneA = !(afterA[0]?.items ?? []).some((i) => i.id === sticker.id);
  check("added item now fully delivered (dropped from deliverable)", stkGoneA, afterA[0]?.items.map((i) => i.id));

  // B) drop the sticker back off → subset again → Partial, qty returned.
  await drs.edit(actor, { id: dr1.id, jobOrderItemIds: [tarp.id], notes: "balance to follow" });
  const eB = await drs.get(actor, dr1.id);
  check("selecting a subset → Partial delivery", eB.isFullDelivery === false, eB.isFullDelivery);
  check("dropped item removed from the DR", eB.lines.length === 1 && eB.lines[0]!.qty === 6, eB.lines.map((l) => l.qty));
  check("edit updates the notes", eB.notes === "balance to follow", eB.notes);
  const afterB = await drs.listDeliverable(actor, { jobOrderId: created.id });
  const stkBack = (afterB[0]?.items ?? []).find((i) => i.id === sticker.id);
  check("dropped item returned to deliverable (remaining 4)", stkBack?.remaining === 4, stkBack?.remaining);

  // C) selecting nothing is rejected (cancel instead).
  let emptyEdit = "";
  try { await drs.edit(actor, { id: dr1.id, jobOrderItemIds: [] }); }
  catch (e) { emptyEdit = (e as Error).constructor.name; }
  check("selecting zero items rejected", emptyEdit === "ValidationError", emptyEdit);

  // D) selecting an item that isn't on this JO is rejected.
  let badEdit = "";
  try { await drs.edit(actor, { id: dr1.id, jobOrderItemIds: ["not-a-real-item"] }); }
  catch (e) { badEdit = (e as Error).constructor.name; }
  check("selecting a foreign item rejected", badEdit === "ValidationError", badEdit);

  // E) a cancelled DR cannot be edited.
  let cancEdit = "";
  try { await drs.edit(actor, { id: dr2.id, jobOrderItemIds: [tarp.id] }); }
  catch (e) { cancEdit = (e as Error).constructor.name; }
  check("cancelled DR cannot be edited", cancEdit === "ValidationError", cancEdit);

  // F) RBAC — VIEWER cannot edit.
  let forbEdit = "";
  try { await drs.edit(viewer, { id: dr1.id, jobOrderItemIds: [tarp.id] }); }
  catch (e) { forbEdit = (e as Error).constructor.name; }
  check("VIEWER cannot edit DR (ForbiddenError)", forbEdit === "ForbiddenError", forbEdit);

  console.log("Undone items can't be delivered / can't make a DR Full");
  const jo2 = await jos.create(actor, {
    joNumber: "VDR-JO-2", isPO: false, customerName: "Verify DR Customer",
    items: [
      { description: "Flyers", qty: "50", amount: "2500", deadline: dateStr(1), isLFP: false, isRush: false },
      { description: "Calendars", qty: "30", amount: "3000", deadline: dateStr(1), isLFP: false, isRush: false },
    ],
  });
  const jo2Detail = await jos.get(actor, jo2.id);
  const flyers = jo2Detail.items.find((i) => i.description === "Flyers")!;
  const calendars = jo2Detail.items.find((i) => i.description === "Calendars")!;
  // mark only the flyers done — calendars stay in production
  await jos.updateItem(actor, {
    id: flyers.id, jobOrderId: jo2.id, description: flyers.description,
    qty: String(flyers.qty), amount: flyers.lineTotal, productionStatus: "Done - Completed",
    isLFP: false, isRush: false,
  });
  const dr3 = await drs.issue(actor, { jobOrderId: jo2.id, lines: [{ jobOrderItemId: flyers.id, qty: "50" }] });
  const dr3Detail = await drs.get(actor, dr3.id);
  check("DR with the only done item is still Partial (a JO item remains undone)", dr3Detail.isFullDelivery === false, dr3Detail.isFullDelivery);
  const opts3 = await drs.getEditOptions(actor, dr3.id);
  const optCal = opts3.items.find((i) => i.jobOrderItemId === calendars.id)!;
  check("undone item shows as not deliverable in edit options", optCal.deliverable === false, optCal.deliverable);
  let undoneEdit = "";
  try { await drs.edit(actor, { id: dr3.id, jobOrderItemIds: [flyers.id, calendars.id] }); }
  catch (e) { undoneEdit = (e as Error).constructor.name; }
  check("selecting an undone item is rejected", undoneEdit === "ValidationError", undoneEdit);

  console.log("DR list + RBAC");
  const list = await drs.list(actor, { q: "VDR-JO-1", take: 25 });
  check("DR list shows issued DRs", list.rows.length >= 2);
  check(
    "DR list rows include full item descriptions",
    list.rows.every((r) => Array.isArray(r.items)) &&
      list.rows.some((r) => r.items.some((d) => d.includes("Tarpaulin"))),
    list.rows.map((r) => r.items)
  );
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
