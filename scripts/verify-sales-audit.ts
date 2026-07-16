// End-to-end verification for the Sales & Audit module (receipts + booklets).
// Run: npx tsx scripts/verify-sales-audit.ts
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getJobOrderService } from "../src/modules/job-orders/services";
import {
  getBookletService,
  getReceiptService,
  splitVat,
  toAmount,
  toCentavos,
} from "../src/modules/sales-audit/services";
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

const PREFIX = "VSA-";

async function cleanup() {
  const jo = { jobOrder: { joNumber: { startsWith: PREFIX } } };
  await prisma.auditEntry.deleteMany({
    where: { OR: [{ sale: jo }, { collectionReceipt: jo }] },
  });
  await prisma.sale.deleteMany({ where: jo });
  await prisma.collectionReceipt.deleteMany({ where: jo });
  await prisma.jobOrder.deleteMany({ where: { joNumber: { startsWith: PREFIX } } });
  await prisma.customer.deleteMany({ where: { name: "Verify SA Customer" } });
  // Booklets used by this run — identified by their label.
  await prisma.booklet.deleteMany({ where: { label: { startsWith: PREFIX } } });
}

async function main() {
  const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  const auditorUser = await prisma.user.findFirstOrThrow({ where: { role: "AUDITOR" } });
  const actor: Actor = { id: admin.id, role: admin.role };
  const cashier: Actor = { id: admin.id, role: "ENCODER" };
  const auditor: Actor = { id: auditorUser.id, role: "AUDITOR" };
  const viewer: Actor = { id: admin.id, role: "VIEWER" };

  const jos = getJobOrderService();
  const booklets = getBookletService();
  const receipts = getReceiptService();
  await cleanup();

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nVAT arithmetic (pure — the rule from SalesLogService.js)");
  // ₱1,120.00 VAT-inclusive → ₱1,000.00 net + ₱120.00 VAT
  const v = splitVat(toCentavos("1120.00"), "SI_VAT");
  check("1,120.00 → vatable 1,000.00", toAmount(v.vatableSales) === "1000.00", toAmount(v.vatableSales));
  check("1,120.00 → VAT 120.00", toAmount(v.vatAmount) === "120.00", toAmount(v.vatAmount));
  check("net + VAT === gross", v.vatableSales + v.vatAmount === v.amount);

  // The rounding case that breaks naive float maths: 1000.00 / 1.12 = 892.857…
  const odd = splitVat(toCentavos("1000.00"), "SI_VAT");
  check("1,000.00 → vatable 892.86", toAmount(odd.vatableSales) === "892.86", toAmount(odd.vatableSales));
  check("1,000.00 → VAT 107.14", toAmount(odd.vatAmount) === "107.14", toAmount(odd.vatAmount));
  check("receipt still foots exactly", odd.vatableSales + odd.vatAmount === odd.amount);

  const nv = splitVat(toCentavos("1000.00"), "SI_NON_VAT");
  check("Non-VAT carries zero VAT", nv.vatAmount === 0 && nv.vatableSales === nv.amount);
  const js = splitVat(toCentavos("500.00"), "JO_SLIP");
  check("JO receipt carries zero VAT", js.vatAmount === 0);

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nAbility matrix");
  check("ENCODER (cashier) can receive payment", defineAbilityFor({ role: "ENCODER" }).can("create", "Sale"));
  check("ENCODER cannot approve a booklet", defineAbilityFor({ role: "ENCODER" }).cannot("approve", "Booklet"));
  check("ADMIN can approve a booklet", defineAbilityFor({ role: "ADMIN" }).can("approve", "Booklet"));
  check("AUDITOR can audit", defineAbilityFor({ role: "AUDITOR" }).can("audit", "Sale"));
  check("AUDITOR cannot issue receipts (separation of duties)", defineAbilityFor({ role: "AUDITOR" }).cannot("create", "Sale"));
  check("VIEWER cannot receive payment", defineAbilityFor({ role: "VIEWER" }).cannot("create", "Sale"));

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nBooklets: register → approve → issue");
  const suggestion = await booklets.suggestRange(actor, "SI_VAT");
  check("suggests a range for a new booklet", suggestion.suggestedEnd > suggestion.suggestedStart, suggestion);
  check("suggested prefix for SI_VAT is IN", suggestion.prefix === "IN");

  const siBk = await booklets.create(cashier, {
    type: "SI_VAT", seriesStart: 9000, seriesEnd: 9004,
    label: `${PREFIX}SI booklet`, gapExempt: false,
  });
  const joBk = await booklets.create(cashier, {
    type: "JO_SLIP", seriesStart: 500, seriesEnd: 599,
    label: `${PREFIX}JO booklet`, gapExempt: false,
  });
  const crBk = await booklets.create(cashier, {
    type: "CR", seriesStart: 300, seriesEnd: 399,
    label: `${PREFIX}CR booklet`, gapExempt: false,
  });

  const pending = await booklets.list(actor, { status: "PENDING_APPROVAL" });
  check("a new booklet awaits approval (not usable yet)", pending.some((b) => b.id === siBk.id));

  // A booklet size other than 50 is accepted — ranges are editable.
  const sized = (await booklets.list(actor, {})).find((b) => b.id === joBk.id)!;
  check("booklet size is editable (100 leaves, not a fixed 50)", sized.capacity === 100, sized.capacity);

  let denied = "";
  try {
    await booklets.approve(cashier, siBk.id);
  } catch (e) { denied = (e as Error).constructor.name; }
  check("cashier cannot approve their own booklet (ForbiddenError)", denied === "ForbiddenError", denied);

  for (const b of [siBk, joBk, crBk]) await booklets.approve(actor, b.id);
  const active = await booklets.list(actor, { type: "SI_VAT", status: "ACTIVE" });
  check("approved booklet is ACTIVE and shows its next number", active[0]?.nextDocumentNo === "IN-9000", active[0]?.nextDocumentNo);

  // The DB's partial unique index must refuse a second live SI_VAT booklet.
  const rival = await booklets.create(cashier, {
    type: "SI_VAT", seriesStart: 9100, seriesEnd: 9199,
    label: `${PREFIX}rival`, gapExempt: false,
  });
  let conflict = "";
  try {
    await booklets.approve(actor, rival.id);
  } catch (e) { conflict = (e as Error).constructor.name; }
  check("a SECOND active booklet of one type is refused (ConflictError)", conflict === "ConflictError", conflict);

  // Overlapping ranges must be impossible — the DB exclusion constraint.
  let overlap = false;
  try {
    await booklets.create(cashier, {
      type: "JO_SLIP", seriesStart: 550, seriesEnd: 650,
      label: `${PREFIX}overlap`, gapExempt: false,
    });
  } catch { overlap = true; }
  check("overlapping number ranges are rejected by the database", overlap);

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nReceive Payment on a Job Order");
  const jo = await jos.create(actor, {
    joNumber: `${PREFIX}JO-1`,
    isPO: false, isNonJo: true, customerName: "Verify SA Customer",
    items: [{ description: "Tarpaulin 3x5", qty: "2", amount: "1120", deadline: dateStr(1), isLFP: false, isRush: false }],
  });
  await prisma.customer.updateMany({
    where: { name: "Verify SA Customer" },
    data: { address: "Real St, Ormoc City", tin: "123-456-789-000" },
  });

  const opts = await receipts.getPaymentOptions(cashier, jo.id);
  check("dialog pre-fills customer name from the JO", opts.customer.name === "Verify SA Customer");
  check("dialog pre-fills address from the JO", opts.customer.address === "Real St, Ormoc City", opts.customer.address);
  check("dialog pre-fills TIN from the JO", opts.customer.tin === "123-456-789-000", opts.customer.tin);
  check("dialog shows the next SI number", opts.nextNumbers.SI_VAT === "IN-9000", opts.nextNumbers.SI_VAT);
  check("dialog shows the next JO-receipt number", opts.nextNumbers.JO_RECEIPT === "JO-0500", opts.nextNumbers.JO_RECEIPT);
  check("nothing received yet", opts.totalReceived === "0.00", opts.totalReceived);

  // 1. Downpayment on the JO — customer hands over ₱1,000 for a ₱500 slip.
  const dp = await receipts.receivePayment(cashier, {
    jobOrderId: jo.id, kind: "JO_RECEIPT",
    amount: "500.00", cashTendered: "1000.00",
    method: "CASH", methodDetail: undefined, notes: undefined,
  });
  check("JO receipt takes the next number (JO-0500)", dp.documentNo === "JO-0500", dp.documentNo);
  check("change computed: 1,000 − 500 = 500.00", dp.changeGiven === "500.00", dp.changeGiven);

  // 2. Sales Invoice on the SAME JO — the case the old @unique blocked.
  const si = await receipts.receivePayment(cashier, {
    jobOrderId: jo.id, kind: "SI_VAT",
    amount: "1120.00", cashTendered: "1120.00",
    method: "CASH", methodDetail: undefined, notes: undefined,
  });
  check("SAME JO can also take a Sales Invoice", si.documentNo === "IN-9000", si.documentNo);
  check("exact cash → no change", si.changeGiven === "0.00", si.changeGiven);

  const siRow = await prisma.sale.findUniqueOrThrow({ where: { documentNo: "IN-9000" } });
  check("SI stored vatable 1,000.00", siRow.vatableSales.toString() === "1000", siRow.vatableSales.toString());
  check("SI stored VAT 120.00", siRow.vatAmount.toString() === "120", siRow.vatAmount.toString());
  check("SI snapshots the TIN at issue", siRow.billedToTin === "123-456-789-000", siRow.billedToTin);

  // The snapshot must survive the customer later editing their details.
  await prisma.customer.updateMany({
    where: { name: "Verify SA Customer" },
    data: { tin: "999-999-999-999" },
  });
  const reread = await prisma.sale.findUniqueOrThrow({ where: { documentNo: "IN-9000" } });
  check("editing the customer does NOT rewrite an issued receipt", reread.billedToTin === "123-456-789-000", reread.billedToTin);

  // 3. Collection Receipt.
  const cr = await receipts.receivePayment(cashier, {
    jobOrderId: jo.id, kind: "COLLECTION",
    amount: "200.00", cashTendered: "", method: "GCASH",
    methodDetail: "GC-77421", notes: undefined,
  });
  check("Collection Receipt takes the CR series", cr.documentNo === "CR-0300", cr.documentNo);
  check("non-cash method gives no change", cr.changeGiven === "0.00", cr.changeGiven);

  // Underpayment must be refused.
  let short = "";
  try {
    await receipts.receivePayment(cashier, {
      jobOrderId: jo.id, kind: "SI_NON_VAT",
      amount: "500.00", cashTendered: "100.00", method: "CASH",
      methodDetail: undefined, notes: undefined,
    });
  } catch (e) { short = (e as Error).constructor.name; }
  check("cash short of the amount due is refused", short === "ValidationError", short);

  // No active Non-VAT booklet → a clear error, not a crash.
  let noBooklet = "";
  try {
    await receipts.receivePayment(cashier, {
      jobOrderId: jo.id, kind: "SI_NON_VAT",
      amount: "500.00", cashTendered: "500.00", method: "CASH",
      methodDetail: undefined, notes: undefined,
    });
  } catch (e) { noBooklet = (e as Error).message; }
  check("issuing with no active booklet explains itself", noBooklet.includes("No active booklet"), noBooklet);

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nSeries numbers are gapless and never reused");
  const nums: string[] = [];
  for (let i = 0; i < 4; i++) {
    const r = await receipts.receivePayment(cashier, {
      jobOrderId: jo.id, kind: "JO_RECEIPT",
      amount: "10.00", cashTendered: "10.00", method: "CASH",
      methodDetail: undefined, notes: undefined,
    });
    nums.push(r.documentNo);
  }
  check("sequential: JO-0501…JO-0504", nums.join(",") === "JO-0501,JO-0502,JO-0503,JO-0504", nums.join(","));
  check("all numbers unique", new Set(nums).size === nums.length);

  // Concurrency: 5 cashiers hitting Receive Payment at the same instant must
  // never be handed the same number. The booklet row lock is what prevents it.
  const crBurst = await Promise.all(
    Array.from({ length: 5 }, () =>
      receipts.receivePayment(cashier, {
        jobOrderId: jo.id, kind: "COLLECTION",
        amount: "10.00", cashTendered: "10.00", method: "CASH",
        methodDetail: undefined, notes: undefined,
      }).then((r) => r.documentNo)
    )
  );
  check("5 concurrent payments → 5 DISTINCT numbers (no double-issue)", new Set(crBurst).size === 5, crBurst.join(","));

  // Exhaust the SI booklet (9000-9004): 9000 is used, 4 remain.
  for (let i = 0; i < 4; i++) {
    await receipts.receivePayment(cashier, {
      jobOrderId: jo.id, kind: "SI_VAT",
      amount: "112.00", cashTendered: "112.00", method: "CASH",
      methodDetail: undefined, notes: undefined,
    });
  }
  const spent = (await booklets.list(actor, { type: "SI_VAT" })).find((b) => b.id === siBk.id)!;
  check("a used-up booklet flips to CONSUMED", spent.status === "CONSUMED", spent.status);
  check("consumed booklet reports 0 remaining", spent.remaining === 0, spent.remaining);

  let exhausted = "";
  try {
    await receipts.receivePayment(cashier, {
      jobOrderId: jo.id, kind: "SI_VAT",
      amount: "100.00", cashTendered: "100.00", method: "CASH",
      methodDetail: undefined, notes: undefined,
    });
  } catch (e) { exhausted = (e as Error).message; }
  check("issuing past the last leaf is refused", exhausted.length > 0 && !exhausted.includes("Cannot read"), exhausted);

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nDaily sales + VAT / Non-VAT report");
  const summary = await receipts.getDailySummary(actor);
  // 5 VAT invoices: 1120 + (4 × 112) = 1,568.00
  check("VAT invoices totalled", summary.vat.gross === "1568.00", summary.vat.gross);
  check("VAT report splits out the 12%", summary.vat.vatAmount === "168.00", summary.vat.vatAmount);
  check("VAT report splits out net sales", summary.vat.vatableSales === "1400.00", summary.vat.vatableSales);
  check("net + VAT === gross in the report", toCentavos(summary.vat.vatableSales) + toCentavos(summary.vat.vatAmount) === toCentavos(summary.vat.gross));
  // JO receipts: 500 + (4 × 10) = 540.00
  check("JO receipts totalled separately", summary.joReceipts.gross === "540.00", summary.joReceipts.gross);
  // Collections: 200 + (5 × 10) = 250.00
  check("collections totalled separately", summary.collections.gross === "250.00", summary.collections.gross);
  // Gross sales = VAT + Non-VAT + JO receipts — NOT collections.
  check(
    "collections are EXCLUDED from gross sales (no double-count)",
    summary.grossSales === "2108.00",
    `${summary.grossSales} (expected 2108.00 = 1568 + 0 + 540)`
  );

  const day = await receipts.listDay(actor, { take: 50 });
  check("daily log lists every receipt kind", day.rows.length >= 11, day.rows.length);
  check("daily log shows the auditor column empty until reviewed", day.rows.every((r) => r.auditStatus === null));

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nAuditor sign-off");
  check("receipts start unaudited", summary.pendingAudit > 0, summary.pendingAudit);

  let cashierAudit = "";
  try {
    await receipts.auditReceipt(cashier, { saleId: siRow.id, status: "REVIEWED" });
  } catch (e) { cashierAudit = (e as Error).constructor.name; }
  check("a cashier cannot sign off their own receipt (ForbiddenError)", cashierAudit === "ForbiddenError", cashierAudit);

  await receipts.auditReceipt(auditor, { saleId: siRow.id, status: "REVIEWED", remarks: "Tallied with cash count." });
  const crRow = await prisma.collectionReceipt.findUniqueOrThrow({ where: { crNumber: "CR-0300" } });
  await receipts.auditReceipt(auditor, {
    collectionReceiptId: crRow.id, status: "FLAGGED",
    flagType: "DISCREPANCY", remarks: "GCash ref not in the statement.",
  });

  const audited = await receipts.listDay(auditor, { take: 50 });
  const siAudited = audited.rows.find((r) => r.documentNo === "IN-9000")!;
  const crAudited = audited.rows.find((r) => r.documentNo === "CR-0300")!;
  check("auditor's REVIEWED sign-off shows on the sale", siAudited.auditStatus === "REVIEWED", siAudited.auditStatus);
  check("the auditor is named on the row", siAudited.auditorName === auditorUser.name, siAudited.auditorName);
  check("auditor can FLAG a collection receipt too", crAudited.auditStatus === "FLAGGED", crAudited.auditStatus);
  check("flag remarks are kept", crAudited.auditRemarks?.includes("GCash") ?? false, crAudited.auditRemarks);

  const after = await receipts.getDailySummary(actor);
  check("pending-audit count drops as the auditor works", after.pendingAudit === summary.pendingAudit - 2, `${after.pendingAudit} vs ${summary.pendingAudit}`);

  let viewerDenied = "";
  try {
    await receipts.receivePayment(viewer, {
      jobOrderId: jo.id, kind: "JO_RECEIPT", amount: "1.00",
      cashTendered: "1.00", method: "CASH", methodDetail: undefined, notes: undefined,
    });
  } catch (e) { viewerDenied = (e as Error).constructor.name; }
  check("VIEWER cannot receive payment (ForbiddenError)", viewerDenied === "ForbiddenError", viewerDenied);

  await cleanup();
  console.log(fails === 0 ? "\nALL SALES-AUDIT CHECKS PASSED" : `\n${fails} FAILED`);
  process.exitCode = fails ? 1 : 0;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
