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
  const ciBk = await booklets.create(cashier, {
    type: "SI_CHARGE", seriesStart: 700, seriesEnd: 799,
    label: `${PREFIX}CI booklet`, gapExempt: false,
  });

  // The three SI labels are ONE pre-printed IN series (docs/sales.txt §3.1),
  // so whichever label you register next, it carries on from the same place —
  // it never restarts a line of its own.
  const [vatNext, nonVatNext, chargeNext] = await Promise.all([
    booklets.suggestRange(actor, "SI_VAT"),
    booklets.suggestRange(actor, "SI_NON_VAT"),
    booklets.suggestRange(actor, "SI_CHARGE"),
  ]);
  check("all three SI labels continue ONE number line",
    nonVatNext.suggestedStart === vatNext.suggestedStart && chargeNext.suggestedStart === vatNext.suggestedStart,
    [vatNext.suggestedStart, nonVatNext.suggestedStart, chargeNext.suggestedStart]);
  check("that line runs past the SI booklet just registered", vatNext.suggestedStart > 9004, vatNext.suggestedStart);
  check("a Charge Invoice prints the same IN prefix", chargeNext.prefix === "IN", chargeNext.prefix);

  // …and because it is one line, a DIFFERENT label may not claim numbers a
  // VAT booklet already holds. The old guard keyed on type and let this pass.
  let crossLabel = "";
  try {
    await booklets.create(cashier, {
      type: "SI_NON_VAT", seriesStart: 9002, seriesEnd: 9010,
      label: `${PREFIX}cross-label`, gapExempt: false,
    });
  } catch (e) { crossLabel = (e as Error).constructor.name; }
  check("a Non-VAT range colliding with a VAT booklet is refused (ConflictError)", crossLabel === "ConflictError", crossLabel);

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

  for (const b of [siBk, joBk, crBk, ciBk]) await booklets.approve(actor, b.id);
  check("a Charge Invoice draws the shared IN series", (await booklets.list(actor, { type: "SI_CHARGE", status: "ACTIVE" }))[0]?.nextDocumentNo === "IN-0700");
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

  // Overlapping ranges must be impossible — the service refuses them, and the
  // DB exclusion constraint backstops it for anything writing around it.
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
  //    The payment LINE is the money received; the receipt is for 500.
  const dp = await receipts.receivePayment(cashier, {
    jobOrderId: jo.id, kind: "JO_RECEIPT",
    amount: "500.00", cashTendered: "",
    payments: [{ method: "CASH", amount: "1000.00", reference: undefined }],
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
  check("exact cash → nothing left on credit", si.balanceDue === "0.00", si.balanceDue);

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

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nSplit tender — one receipt, several methods");

  // ₱1,500 cash + ₱1,200 GCash against a ₱2,200 JO receipt: ₱2,700 came in,
  // so ₱500 goes back — out of the CASH part, which is the only part that can
  // come back over the counter.
  const split = await receipts.receivePayment(cashier, {
    jobOrderId: jo.id, kind: "JO_RECEIPT",
    amount: "2200.00", cashTendered: "",
    payments: [
      { method: "CASH", amount: "1500.00", reference: undefined },
      { method: "GCASH", amount: "1200.00", reference: "GC-88123" },
    ],
    method: "CASH", methodDetail: undefined, notes: undefined,
  });
  check("split tender issues one receipt", split.documentNo === "JO-0501", split.documentNo);
  check("over-tender gives change: 2,700 − 2,200 = 500.00", split.changeGiven === "500.00", split.changeGiven);
  check("only the amount due is applied, not the whole 2,700", split.amountPaid === "2200.00", split.amountPaid);

  const splitRow = await prisma.sale.findUniqueOrThrow({
    where: { documentNo: "JO-0501" },
    include: { payments: { orderBy: { seq: "asc" } } },
  });
  check("both tender lines stored", splitRow.payments.length === 2, splitRow.payments.length);
  check("lines keep entry order", splitRow.payments.map((p) => p.method).join(",") === "CASH,GCASH", splitRow.payments.map((p) => p.method).join(","));
  check("per-line reference kept", splitRow.payments[1].reference === "GC-88123", splitRow.payments[1].reference);
  check("header shows the DOMINANT tender (Cash 1,500)", splitRow.paymentMethod === "CASH", splitRow.paymentMethod);
  check("a fully-settled receipt is PAID", splitRow.paymentStatus === "PAID", splitRow.paymentStatus);

  // A single-method payment is still one line — no special case in the data.
  const oneLine = await prisma.sale.findUniqueOrThrow({
    where: { documentNo: "IN-9000" },
    include: { payments: true },
  });
  check("a normal payment stores exactly one line", oneLine.payments.length === 1, oneLine.payments.length);
  check("that line carries the full amount", oneLine.payments[0].amount.toString() === "1120", oneLine.payments[0].amount.toString());

  // Over-tendering on a NON-cash method is refused: nobody hands ₱500 back out
  // of a GCash transfer — that is a refund, and a different document.
  let overNonCash = "";
  try {
    await receipts.receivePayment(cashier, {
      jobOrderId: jo.id, kind: "JO_RECEIPT",
      amount: "2200.00", cashTendered: "",
      payments: [{ method: "GCASH", amount: "2700.00", reference: undefined }],
      method: "GCASH", methodDetail: undefined, notes: undefined,
    });
  } catch (e) { overNonCash = (e as Error).message; }
  check("over-tender with no cash to give back is refused", overNonCash.includes("Only cash can be over-tendered"), overNonCash);

  // ₱300 all on GCash + cheque tenders no cash at all — change must stay 0.
  const noCash = await receipts.receivePayment(cashier, {
    jobOrderId: jo.id, kind: "JO_RECEIPT",
    amount: "300.00", cashTendered: "",
    payments: [
      { method: "GCASH", amount: "200.00", reference: "GC-1" },
      { method: "CHECK", amount: "100.00", reference: "CHQ-2" },
    ],
    method: "GCASH", methodDetail: undefined, notes: undefined,
  });
  check("a split with no cash line gives no change", noCash.changeGiven === "0.00", noCash.changeGiven);

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nPartial payment → balance / utang / A/R");

  // ₱1,000 handed over against a ₱2,200 receipt. The invoice books the FULL
  // amount (and its VAT); ₱1,200 stays owed.
  const partial = await receipts.receivePayment(cashier, {
    jobOrderId: jo.id, kind: "JO_RECEIPT",
    amount: "2200.00", cashTendered: "",
    payments: [{ method: "CASH", amount: "1000.00", reference: undefined }],
    method: "CASH", methodDetail: undefined, notes: undefined,
  });
  check("a short payment is ACCEPTED, not refused", partial.documentNo.startsWith("JO-"), partial.documentNo);
  check("only what came in is applied", partial.amountPaid === "1000.00", partial.amountPaid);
  check("the rest becomes a balance: 2,200 − 1,000 = 1,200.00", partial.balanceDue === "1200.00", partial.balanceDue);
  check("short payment gives no change", partial.changeGiven === "0.00", partial.changeGiven);

  const partialRow = await prisma.sale.findUniqueOrThrow({
    where: { documentNo: partial.documentNo },
  });
  check("the receipt is still issued for the FULL amount", partialRow.amount.toString() === "2200", partialRow.amount.toString());
  check("marked PARTIAL", partialRow.paymentStatus === "PARTIAL", partialRow.paymentStatus);

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nCharge Invoice — the sale on credit (docs/sales.txt §3.1.3)");

  const charge = await receipts.receivePayment(cashier, {
    jobOrderId: jo.id, kind: "SI_CHARGE",
    amount: "1120.00", cashTendered: "",
    payments: [], // nothing received — that is what "on credit" means
    method: "CASH", methodDetail: undefined, notes: undefined,
  });
  check("Charge Invoice takes the shared IN series", charge.documentNo === "IN-0700", charge.documentNo);
  check("nothing received", charge.amountPaid === "0.00", charge.amountPaid);
  check("the whole amount is owed", charge.balanceDue === "1120.00", charge.balanceDue);

  const chargeRow = await prisma.sale.findUniqueOrThrow({
    where: { documentNo: "IN-0700" },
    include: { payments: true },
  });
  check("marked UNPAID", chargeRow.paymentStatus === "UNPAID", chargeRow.paymentStatus);
  check("no payment method on a credit sale", chargeRow.paymentMethod === null, chargeRow.paymentMethod);
  check("no tender lines at all", chargeRow.payments.length === 0, chargeRow.payments.length);
  // Selling on credit does not defer the tax: VAT is booked at point of sale.
  check("a Charge Invoice carries VAT (÷ 1.12)", chargeRow.vatableSales.toString() === "1000", chargeRow.vatableSales.toString());
  check("VAT booked at issue, not at collection", chargeRow.vatAmount.toString() === "120", chargeRow.vatAmount.toString());

  // Every other kind is handed over in exchange for money.
  let emptyPay = "";
  try {
    await receipts.receivePayment(cashier, {
      jobOrderId: jo.id, kind: "JO_RECEIPT",
      amount: "100.00", cashTendered: "", payments: [],
      method: "CASH", methodDetail: undefined, notes: undefined,
    });
  } catch (e) { emptyPay = (e as Error).message; }
  check("only a Charge Invoice may be issued with nothing received", emptyPay.includes("Charge Invoice"), emptyPay);

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nGuards");

  // A zero or negative tender line is meaningless — catch the typo.
  let zeroLine = "";
  try {
    await receipts.receivePayment(cashier, {
      jobOrderId: jo.id, kind: "JO_RECEIPT",
      amount: "500.00", cashTendered: "",
      payments: [{ method: "CASH", amount: "0.00", reference: undefined }],
      method: "CASH", methodDetail: undefined, notes: undefined,
    });
  } catch (e) { zeroLine = (e as Error).message; }
  check("a zero payment line is refused", zeroLine.includes("greater than zero"), zeroLine);

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
  // 0500 downpayment, 0501–0502 split tender, 0503 the partial payment.
  check("sequential: JO-0504…JO-0507", nums.join(",") === "JO-0504,JO-0505,JO-0506,JO-0507", nums.join(","));
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
  // Charge invoice: 1,120.00 on credit — revenue AT POINT OF SALE.
  check("charge invoices totalled separately", summary.charge.gross === "1120.00", summary.charge.gross);
  check("charge invoice VAT is reported like any other", summary.charge.vatAmount === "120.00", summary.charge.vatAmount);
  // JO receipts: 500 + 2200 (split) + 300 (no cash) + 2200 (partial) + (4 × 10)
  check("JO receipts totalled separately", summary.joReceipts.gross === "5240.00", summary.joReceipts.gross);
  // A split tender books its GROSS once — the lines are how it was paid, not
  // extra revenue. This is the check that catches double-counting a split.
  check("a split tender is counted ONCE, at its gross", summary.joReceipts.count === 8, summary.joReceipts.count);
  // Collections: 200 + (5 × 10) = 250.00
  check("collections totalled separately", summary.collections.gross === "250.00", summary.collections.gross);
  // Gross sales = VAT + Non-VAT + Charge + JO receipts — NOT collections. A
  // credit sale is revenue the day it is invoiced; the Collection Receipt that
  // settles it later would be the second count, so that one is excluded.
  check(
    "collections are EXCLUDED from gross sales (no double-count)",
    summary.grossSales === "7928.00",
    `${summary.grossSales} (expected 7928.00 = 1568 + 0 + 1120 + 5240)`
  );
  // A/R: the partial JO receipt (2,200 − 1,000) + the whole charge invoice.
  check("receivables sum what is still owed", summary.receivables.amount === "2320.00", summary.receivables.amount);
  check("receivables count only the unsettled receipts", summary.receivables.count === 2, summary.receivables.count);

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

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nCancel / void a receipt (docs/sales.txt §5)");

  const beforeVoid = await receipts.getDailySummary(actor);
  const optsBefore = await receipts.getPaymentOptions(actor, jo.id);

  const doomed = await receipts.receivePayment(cashier, {
    jobOrderId: jo.id, kind: "JO_RECEIPT",
    amount: "400.00", cashTendered: "400.00", method: "CASH",
    methodDetail: undefined, notes: undefined,
  });
  const optsPaid = await receipts.getPaymentOptions(actor, jo.id);
  check(
    "a fresh receipt raises what the JO has received",
    toCentavos(optsPaid.totalReceived) === toCentavos(optsBefore.totalReceived) + 40000,
    `${optsBefore.totalReceived} → ${optsPaid.totalReceived}`
  );

  // §5.1 step 6: the cashier who issued it cannot also sign off the cancellation.
  let cashierVoid = "";
  try {
    await receipts.voidReceipt(cashier, {
      receiptId: doomed.id, kind: "JO_RECEIPT",
      type: "CANCELLED", reason: "Customer changed their mind.",
    });
  } catch (e) { cashierVoid = (e as Error).constructor.name; }
  check("a cashier cannot void a receipt (needs a supervisor)", cashierVoid === "ForbiddenError", cashierVoid);

  await receipts.voidReceipt(actor, {
    receiptId: doomed.id, kind: "JO_RECEIPT",
    type: "CANCELLED", reason: "Customer changed their mind.",
  });

  const voided = await prisma.sale.findUniqueOrThrow({
    where: { documentNo: doomed.documentNo },
    include: { voidedBy: { select: { name: true } } },
  });
  check("the voided receipt is NOT deleted", voided.id === doomed.id);
  check("it keeps its serial number", voided.documentNo === doomed.documentNo, voided.documentNo);
  check("marked CANCELLED", voided.voidType === "CANCELLED", voided.voidType);
  check("the reason is kept (written on its face)", voided.voidReason === "Customer changed their mind.", voided.voidReason);
  check("the approver is named on it", voided.voidedBy?.name === admin.name, voided.voidedBy?.name);

  const optsVoided = await receipts.getPaymentOptions(actor, jo.id);
  check(
    "a voided receipt stops counting as money received",
    optsVoided.totalReceived === optsBefore.totalReceived,
    `${optsPaid.totalReceived} → ${optsVoided.totalReceived}`
  );
  check(
    "so the JO's balance REOPENS and can be paid again",
    optsVoided.balance === optsBefore.balance,
    optsVoided.balance
  );
  check(
    "the cancelled receipt is still LISTED on the JO (all 50 leaves accounted for)",
    optsVoided.issued.some((r) => r.documentNo === doomed.documentNo && r.voidType === "CANCELLED")
  );

  const afterVoid = await receipts.getDailySummary(actor);
  check(
    "a voided receipt is excluded from gross sales",
    afterVoid.grossSales === beforeVoid.grossSales,
    `${afterVoid.grossSales} vs ${beforeVoid.grossSales}`
  );
  const voidDay = await receipts.listDay(actor, { take: 100 });
  check(
    "but it still shows in the day log, marked",
    voidDay.rows.some((r) => r.documentNo === doomed.documentNo && r.voidType === "CANCELLED")
  );

  let twice = "";
  try {
    await receipts.voidReceipt(actor, {
      receiptId: doomed.id, kind: "JO_RECEIPT", type: "VOID", reason: "Again.",
    });
  } catch (e) { twice = (e as Error).message; }
  check("cancelling the same receipt twice is refused", twice.includes("already been cancelled"), twice);

  // The number it burned is NOT handed out again.
  const afterVoidNext = await receipts.getPaymentOptions(actor, jo.id);
  check(
    "a cancelled number is never reissued",
    afterVoidNext.nextNumbers.JO_RECEIPT !== doomed.documentNo,
    `${doomed.documentNo} → next ${afterVoidNext.nextNumbers.JO_RECEIPT}`
  );

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nReplace a receipt — void + reissue in one transaction");

  const wrong = await receipts.receivePayment(cashier, {
    jobOrderId: jo.id, kind: "JO_RECEIPT",
    amount: "250.00", cashTendered: "250.00", method: "CASH",
    methodDetail: undefined, notes: undefined,
  });

  const replaced = await receipts.replaceReceipt(actor, {
    receiptId: wrong.id, kind: "JO_RECEIPT",
    reason: "Wrong amount encoded — should be 260.00.",
    replacement: {
      jobOrderId: jo.id, kind: "JO_RECEIPT",
      amount: "260.00", cashTendered: "",
      payments: [{ method: "CASH", amount: "300.00", reference: undefined }],
      method: "CASH", methodDetail: undefined, notes: undefined,
    },
  });
  check("replacing reports both serials", replaced.replacedDocumentNo === wrong.documentNo, replaced.replacedDocumentNo);
  check("the replacement takes the NEXT number", replaced.documentNo !== wrong.documentNo, replaced.documentNo);
  check("the replacement's own change is computed: 300 − 260 = 40.00", replaced.changeGiven === "40.00", replaced.changeGiven);

  const oldRow = await prisma.sale.findUniqueOrThrow({
    where: { documentNo: wrong.documentNo },
    include: { replacedBy: { select: { documentNo: true } } },
  });
  const newRow = await prisma.sale.findUniqueOrThrow({
    where: { documentNo: replaced.documentNo },
    include: { replaces: { select: { documentNo: true } } },
  });
  check("the spoiled receipt is marked REPLACED", oldRow.voidType === "REPLACED", oldRow.voidType);
  check("the reason is kept", oldRow.voidReason?.includes("Wrong amount") ?? false, oldRow.voidReason);
  // §5.1 step 3: each one carries the other's number.
  check("the old points at the new", oldRow.replacedBy?.documentNo === replaced.documentNo, oldRow.replacedBy?.documentNo);
  check("the new points back at the old", newRow.replaces?.documentNo === wrong.documentNo, newRow.replaces?.documentNo);

  const afterReplace = await receipts.getDailySummary(actor);
  check(
    "only the REPLACEMENT counts as revenue (260, not 250 + 260)",
    toCentavos(afterReplace.grossSales) === toCentavos(afterVoid.grossSales) + 26000,
    `${afterVoid.grossSales} → ${afterReplace.grossSales}`
  );

  // A replacement must draw from the same series as the receipt it supersedes.
  const stray = await receipts.receivePayment(cashier, {
    jobOrderId: jo.id, kind: "JO_RECEIPT",
    amount: "15.00", cashTendered: "15.00", method: "CASH",
    methodDetail: undefined, notes: undefined,
  });
  let crossKind = "";
  try {
    await receipts.replaceReceipt(actor, {
      receiptId: stray.id, kind: "JO_RECEIPT", reason: "Trying to cross series.",
      replacement: {
        jobOrderId: jo.id, kind: "COLLECTION",
        amount: "15.00", cashTendered: "15.00", method: "CASH",
        methodDetail: undefined, notes: undefined,
      },
    });
  } catch (e) { crossKind = (e as Error).message; }
  check("a replacement cannot switch receipt type", crossKind.includes("same receipt type"), crossKind);
  const strayStill = await prisma.sale.findUniqueOrThrow({ where: { documentNo: stray.documentNo } });
  check("a refused replacement leaves the original untouched", strayStill.voidType === null, strayStill.voidType);

  await cleanup();
  console.log(fails === 0 ? "\nALL SALES-AUDIT CHECKS PASSED" : `\n${fails} FAILED`);
  process.exitCode = fails ? 1 : 0;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
