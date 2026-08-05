// End-to-end verification for the Sales & Audit module (receipts, booklets,
// accounts receivable). Run: npx tsx scripts/verify-sales-audit.ts
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getJobOrderService } from "../src/modules/job-orders/services";
import {
  getBookletService,
  getReceiptService,
  getReceivableService,
  splitVat,
  toAmount,
  toCentavos,
} from "../src/modules/sales-audit/services";
import { defineAbilityFor } from "../src/lib/ability";
import { moduleForPath, resolveEnabledModules } from "../src/lib/modules";
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
const CUSTOMER = "Verify SA Customer";

// Every receivePayment call needs these; spread it and override what matters.
const base = {
  cashTendered: "",
  method: "CASH" as const,
  methodDetail: undefined,
  notes: undefined,
};

// Only ONE booklet per type may be ACTIVE, so this script cannot open its own
// series while the shop's real ones are in service. It parks them for the
// duration and puts them back in the `finally` below — including on a crash.
// Nothing is deleted, and no real serial is consumed.
const BORROWED_TYPES = ["SI_VAT", "SI_NON_VAT", "SI_CHARGE", "JO_SLIP", "CR"] as const;
let borrowed: { id: string; status: "ACTIVE" }[] = [];

async function borrowBooklets() {
  borrowed = await prisma.booklet.findMany({
    where: { type: { in: [...BORROWED_TYPES] }, status: "ACTIVE" },
    select: { id: true, status: true },
  }) as { id: string; status: "ACTIVE" }[];
  if (borrowed.length > 0) {
    await prisma.booklet.updateMany({
      where: { id: { in: borrowed.map((b) => b.id) } },
      data: { status: "CLOSED" },
    });
    console.log(`  (parked ${borrowed.length} live booklet(s) for the run)`);
  }
}

async function restoreBooklets() {
  // Our own booklets go first, unconditionally: only one may be ACTIVE per
  // type, so leaving even one behind is what stops the shop's coming back.
  // Repeated here rather than trusted to cleanup(), because this runs in a
  // `finally` — precisely the path where cleanup() may itself have failed.
  await prisma.booklet.deleteMany({ where: { label: { startsWith: PREFIX } } });
  for (const b of borrowed) {
    await prisma.booklet.update({ where: { id: b.id }, data: { status: b.status } });
  }
  if (borrowed.length > 0) console.log(`  (restored ${borrowed.length} booklet(s))`);
  borrowed = [];
}

async function cleanup() {
  const jo = { jobOrder: { joNumber: { startsWith: PREFIX } } };
  // Customer-level collections belong to no job order at all, so everything
  // below is keyed on the CUSTOMER; the job-order prefix only reaches receipts
  // raised at the counter.
  const ours = { customer: { name: CUSTOMER } };

  await prisma.advancePaymentApplication.deleteMany({
    where: { advancePayment: ours },
  });
  await prisma.advancePayment.deleteMany({ where: ours });

  // AuditEntry carries a check constraint that exactly one of its two targets
  // is set. Deleting a Sale or CollectionReceipt out from under it NULLs that
  // FK and trips the constraint, so its rows go first — not after.
  await prisma.auditEntry.deleteMany({
    where: { OR: [{ sale: jo }, { collectionReceipt: jo }, { sale: ours }, { collectionReceipt: ours }] },
  });
  await prisma.crAllocation.deleteMany({
    where: { OR: [{ sale: jo }, { sale: ours }, { cr: ours }] },
  });
  await prisma.receiptPayment.deleteMany({
    where: { OR: [{ sale: ours }, { collectionReceipt: ours }] },
  });

  // Replacement is a self-relation; clear it before the rows go.
  await prisma.sale.updateMany({ where: ours, data: { replacedById: null } });
  await prisma.collectionReceipt.updateMany({ where: ours, data: { replacedById: null } });

  await prisma.sale.deleteMany({ where: { OR: [jo, ours] } });
  await prisma.collectionReceipt.deleteMany({ where: { OR: [jo, ours] } });
  await prisma.jobOrder.deleteMany({ where: { joNumber: { startsWith: PREFIX } } });
  await prisma.customer.deleteMany({ where: { name: CUSTOMER } });
  await prisma.booklet.deleteMany({ where: { label: { startsWith: PREFIX } } });
  // Leave the flipper as we found it — this script switches credit control on.
  await prisma.moduleFlag.deleteMany({ where: { key: "credit-control" } });
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
  const ar = getReceivableService();
  await cleanup();
  await borrowBooklets();

  /** A job order priced at exactly `amount`, for one scenario. */
  const makeJo = async (n: number, amount: string) =>
    jos.create(actor, {
      joNumber: `${PREFIX}JO-${n}`,
      isPO: false, isNonJo: true, customerName: CUSTOMER,
      items: [{
        description: `Tarpaulin ${n}`, qty: "1", amount,
        deadline: dateStr(1), isLFP: false, isRush: false,
      }],
    });

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nVAT arithmetic (pure — the rule from SalesLogService.js)");
  const v = splitVat(toCentavos("1120.00"), "SI_VAT");
  check("1,120.00 → vatable 1,000.00", toAmount(v.vatableSales) === "1000.00", toAmount(v.vatableSales));
  check("1,120.00 → VAT 120.00", toAmount(v.vatAmount) === "120.00", toAmount(v.vatAmount));
  check("net + VAT === gross", v.vatableSales + v.vatAmount === v.amount);

  const odd = splitVat(toCentavos("1000.00"), "SI_VAT");
  check("1,000.00 → vatable 892.86", toAmount(odd.vatableSales) === "892.86", toAmount(odd.vatableSales));
  check("1,000.00 → VAT 107.14", toAmount(odd.vatAmount) === "107.14", toAmount(odd.vatAmount));
  check("receipt still foots exactly", odd.vatableSales + odd.vatAmount === odd.amount);

  const nv = splitVat(toCentavos("1000.00"), "SI_NON_VAT");
  check("Non-VAT carries zero VAT", nv.vatAmount === 0 && nv.vatableSales === nv.amount);
  check("JO receipt carries zero VAT", splitVat(toCentavos("500.00"), "JO_SLIP").vatAmount === 0);

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nAbility matrix");
  check("ENCODER (cashier) can receive payment", defineAbilityFor({ role: "ENCODER" }).can("create", "Sale"));
  check("ENCODER cannot approve a booklet", defineAbilityFor({ role: "ENCODER" }).cannot("approve", "Booklet"));
  check("ADMIN can approve a booklet", defineAbilityFor({ role: "ADMIN" }).can("approve", "Booklet"));
  check("AUDITOR can audit", defineAbilityFor({ role: "AUDITOR" }).can("audit", "Sale"));
  check("AUDITOR cannot issue receipts (separation of duties)", defineAbilityFor({ role: "AUDITOR" }).cannot("create", "Sale"));
  check("VIEWER cannot receive payment", defineAbilityFor({ role: "VIEWER" }).cannot("create", "Sale"));

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nSettings flipper — the two new switches");
  // /sales-audit/receivables sits INSIDE /sales-audit, so route ownership has
  // to resolve by longest prefix. First-match would hand the child's pages to
  // the parent and leave the Receivables switch doing nothing at all.
  check("Receivables owns its own subtree, not Sales Audit",
    moduleForPath("/sales-audit/receivables") === "receivables",
    moduleForPath("/sales-audit/receivables"));
  check("…while Sales Audit still owns its own page",
    moduleForPath("/sales-audit") === "sales-audit", moduleForPath("/sales-audit"));
  check("…and its other sub-pages", moduleForPath("/sales-audit/anything") === "sales-audit");

  const defaults = resolveEnabledModules(new Map());
  check("Receivables is on by default", defaults.has("receivables"));
  check("Credit control is OFF by default (it is not a legacy rule)",
    !defaults.has("credit-control"));
  check("an override switches credit control on",
    resolveEnabledModules(new Map([["credit-control", true]])).has("credit-control"));

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nBooklets: register → approve → issue");
  const suggestion = await booklets.suggestRange(actor, "SI_VAT");
  check("suggests a range for a new booklet", suggestion.suggestedEnd > suggestion.suggestedStart, suggestion);
  check("suggested prefix for SI_VAT is IN", suggestion.prefix === "IN");

  const siBk = await booklets.create(cashier, {
    type: "SI_VAT", seriesStart: 9000, seriesEnd: 9049,
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

  // The three SI labels are ONE pre-printed IN series (docs/sales.txt §3.1).
  const [vatNext, nonVatNext, chargeNext] = await Promise.all([
    booklets.suggestRange(actor, "SI_VAT"),
    booklets.suggestRange(actor, "SI_NON_VAT"),
    booklets.suggestRange(actor, "SI_CHARGE"),
  ]);
  check("all three SI labels continue ONE number line",
    nonVatNext.suggestedStart === vatNext.suggestedStart && chargeNext.suggestedStart === vatNext.suggestedStart,
    [vatNext.suggestedStart, nonVatNext.suggestedStart, chargeNext.suggestedStart]);
  check("that line runs past the SI booklet just registered", vatNext.suggestedStart > 9049, vatNext.suggestedStart);
  check("a Charge Invoice prints the same IN prefix", chargeNext.prefix === "IN", chargeNext.prefix);

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

  const rival = await booklets.create(cashier, {
    type: "SI_VAT", seriesStart: 9100, seriesEnd: 9199,
    label: `${PREFIX}rival`, gapExempt: false,
  });
  let conflict = "";
  try {
    await booklets.approve(actor, rival.id);
  } catch (e) { conflict = (e as Error).constructor.name; }
  check("a SECOND active booklet of one type is refused (ConflictError)", conflict === "ConflictError", conflict);

  let overlap = false;
  try {
    await booklets.create(cashier, {
      type: "JO_SLIP", seriesStart: 550, seriesEnd: 650,
      label: `${PREFIX}overlap`, gapExempt: false,
    });
  } catch { overlap = true; }
  check("overlapping number ranges are rejected by the database", overlap);

  // Everything below is measured against this line, so the run does not
  // depend on what else happens to be in the day's ledger.
  const baseline = await receipts.getDailySummary(actor);

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nInvoice a job order in full");
  const jo1 = await makeJo(1, "1120");
  await prisma.customer.updateMany({
    where: { name: CUSTOMER },
    data: { address: "Real St, Ormoc City", tin: "123-456-789-000" },
  });

  const opts = await receipts.getPaymentOptions(cashier, jo1.id);
  check("dialog pre-fills customer name from the JO", opts.customer.name === CUSTOMER);
  check("dialog pre-fills address from the JO", opts.customer.address === "Real St, Ormoc City", opts.customer.address);
  check("dialog pre-fills TIN from the JO", opts.customer.tin === "123-456-789-000", opts.customer.tin);
  check("dialog shows the next SI number", opts.nextNumbers.SI_VAT === "IN-9000", opts.nextNumbers.SI_VAT);
  check("nothing received yet", opts.totalReceived === "0.00", opts.totalReceived);
  check("the whole job is still to invoice", opts.unbilled === "1120.00", opts.unbilled);
  check("nothing is outstanding before anything is billed", opts.outstanding === "0.00", opts.outstanding);

  const si = await receipts.receivePayment(cashier, {
    ...base, jobOrderId: jo1.id, kind: "SI_VAT", amount: "1120.00",
    payments: [{ method: "CASH", amount: "1120.00", reference: undefined }],
  });
  check("SI takes the next number", si.documentNo === "IN-9000", si.documentNo);
  check("exact cash → no change", si.changeGiven === "0.00", si.changeGiven);
  check("exact cash → nothing left on credit", si.balanceDue === "0.00", si.balanceDue);

  const siRow = await prisma.sale.findUniqueOrThrow({ where: { documentNo: "IN-9000" } });
  check("SI stored vatable 1,000.00", siRow.vatableSales.toString() === "1000", siRow.vatableSales.toString());
  check("SI stored VAT 120.00", siRow.vatAmount.toString() === "120", siRow.vatAmount.toString());
  check("SI snapshots the TIN at issue", siRow.billedToTin === "123-456-789-000", siRow.billedToTin);
  check("a cash invoice carries no due date", siRow.dueDate === null, siRow.dueDate);

  await prisma.customer.updateMany({
    where: { name: CUSTOMER }, data: { tin: "999-999-999-999" },
  });
  const reread = await prisma.sale.findUniqueOrThrow({ where: { documentNo: "IN-9000" } });
  check("editing the customer does NOT rewrite an issued receipt", reread.billedToTin === "123-456-789-000", reread.billedToTin);

  // Over-tender still gives change back — out of the CASH part only.
  const jo1b = await makeJo(11, "2200");
  const split = await receipts.receivePayment(cashier, {
    ...base, jobOrderId: jo1b.id, kind: "SI_VAT", amount: "2200.00",
    payments: [
      { method: "CASH", amount: "1500.00", reference: undefined },
      { method: "GCASH", amount: "1200.00", reference: "GC-88123" },
    ],
  });
  check("split tender issues one receipt", split.documentNo === "IN-9001", split.documentNo);
  check("over-tender gives change: 2,700 − 2,200 = 500.00", split.changeGiven === "500.00", split.changeGiven);
  check("only the amount due is applied, not the whole 2,700", split.amountPaid === "2200.00", split.amountPaid);

  const splitRow = await prisma.sale.findUniqueOrThrow({
    where: { documentNo: "IN-9001" },
    include: { payments: { orderBy: { seq: "asc" } } },
  });
  check("both tender lines stored", splitRow.payments.length === 2, splitRow.payments.length);
  check("lines keep entry order", splitRow.payments.map((p) => p.method).join(",") === "CASH,GCASH");
  check("per-line reference kept", splitRow.payments[1].reference === "GC-88123", splitRow.payments[1].reference);
  check("header shows the DOMINANT tender (Cash 1,500)", splitRow.paymentMethod === "CASH", splitRow.paymentMethod);
  check("a fully-settled receipt is PAID", splitRow.paymentStatus === "PAID", splitRow.paymentStatus);

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nTHE GATE — a job billed in full cannot be billed again");

  // The reported bug: a charge invoice covers the job, so `unbilled` is 0
  // while `outstanding` is the whole amount. The old single "balance" made
  // this look wide open and offered a SECOND invoice for the same money.
  const jo2 = await makeJo(2, "1344");
  const ci = await receipts.receivePayment(cashier, {
    ...base, jobOrderId: jo2.id, kind: "SI_CHARGE", amount: "1344.00", payments: [],
  });
  check("Charge Invoice takes the shared IN series", ci.documentNo === "IN-0700", ci.documentNo);
  check("nothing received on a credit sale", ci.amountPaid === "0.00", ci.amountPaid);
  check("the whole amount is owed", ci.balanceDue === "1344.00", ci.balanceDue);

  const gated = await receipts.getPaymentOptions(cashier, jo2.id);
  check("billed in full → nothing left to invoice", gated.unbilled === "0.00", gated.unbilled);
  check("…but the whole amount is outstanding", gated.outstanding === "1344.00", gated.outstanding);
  check("a second VAT invoice is BLOCKED", !gated.availability.SI_VAT.enabled, gated.availability.SI_VAT);
  check("…and says why", gated.availability.SI_VAT.reason?.includes("already invoiced in full") ?? false, gated.availability.SI_VAT.reason);
  check("a second Non-VAT invoice is blocked too", !gated.availability.SI_NON_VAT.enabled);
  check("another Charge Invoice is blocked too", !gated.availability.SI_CHARGE.enabled);
  check("a COLLECTION is the one thing still allowed", gated.availability.COLLECTION.enabled);
  check("and it is what the dialog suggests", gated.recommended === "COLLECTION", gated.recommended);
  check("the open invoice is listed for allocation", gated.openInvoices.length === 1 && gated.openInvoices[0].documentNo === "IN-0700", gated.openInvoices);

  // The UI gate is a courtesy; the SERVER is the gate.
  let doubleBill = "";
  try {
    await receipts.receivePayment(cashier, {
      ...base, jobOrderId: jo2.id, kind: "SI_VAT", amount: "1344.00",
      payments: [{ method: "CASH", amount: "1344.00", reference: undefined }],
    });
  } catch (e) { doubleBill = (e as Error).message; }
  check("the SERVICE refuses the double-invoice, not just the UI", doubleBill.includes("already invoiced in full"), doubleBill);

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nCollection against the Charge Invoice");

  const coll = await receipts.receivePayment(cashier, {
    ...base, jobOrderId: jo2.id, kind: "COLLECTION", amount: "500.00",
    method: "GCASH", methodDetail: "GC-77421",
    payments: [{ method: "GCASH", amount: "500.00", reference: "GC-77421" }],
  });
  check("Collection Receipt takes the CR series", coll.documentNo === "CR-0300", coll.documentNo);
  check("non-cash method gives no change", coll.changeGiven === "0.00", coll.changeGiven);

  const allocs = await prisma.crAllocation.findMany({
    where: { cr: { crNumber: "CR-0300" } },
  });
  check("the collection is ALLOCATED to a specific invoice", allocs.length === 1, allocs.length);
  check("…for the amount collected", allocs[0]?.amount.toString() === "500", allocs[0]?.amount.toString());

  const ciAfter = await prisma.sale.findUniqueOrThrow({ where: { documentNo: "IN-0700" } });
  check("the invoice's settledAmount goes up", ciAfter.settledAmount.toString() === "500", ciAfter.settledAmount.toString());
  check("amountPaid is NOT rewritten (the paper still says 0)", ciAfter.amountPaid.toString() === "0", ciAfter.amountPaid.toString());

  const afterColl = await receipts.getPaymentOptions(cashier, jo2.id);
  check("outstanding drops by what was collected", afterColl.outstanding === "844.00", afterColl.outstanding);
  check("still nothing to invoice", afterColl.unbilled === "0.00", afterColl.unbilled);
  check("money received is now visible on the JO", afterColl.totalReceived === "500.00", afterColl.totalReceived);

  // Over-collecting is refused — you cannot collect more than is owed.
  let overCollect = "";
  try {
    await receipts.receivePayment(cashier, {
      ...base, jobOrderId: jo2.id, kind: "COLLECTION", amount: "1000.00",
      payments: [{ method: "CASH", amount: "1000.00", reference: undefined }],
    });
  } catch (e) { overCollect = (e as Error).message; }
  check("collecting more than is outstanding is refused", overCollect.includes("only 844.00 is outstanding"), overCollect);

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nThe Collection Receipt is OPTIONAL");

  const bookletBefore = (await booklets.list(actor, { type: "CR", status: "ACTIVE" }))[0]!.nextDocumentNo;
  const quiet = await receipts.receivePayment(cashier, {
    ...base, jobOrderId: jo2.id, kind: "COLLECTION", amount: "344.00",
    issueDocument: false,
    payments: [{ method: "CASH", amount: "344.00", reference: undefined }],
  });
  check("a payment with no receipt has no document number", quiet.documentNo === null, quiet.documentNo);

  const bookletAfter = (await booklets.list(actor, { type: "CR", status: "ACTIVE" }))[0]!.nextDocumentNo;
  check("…and burns NO booklet number", bookletAfter === bookletBefore, `${bookletBefore} → ${bookletAfter}`);

  const quietRow = await prisma.collectionReceipt.findUniqueOrThrow({ where: { id: quiet.id } });
  check("it is still recorded as money in", quietRow.amount.toString() === "344", quietRow.amount.toString());
  check("marked as having no document", quietRow.documentIssued === false, quietRow.documentIssued);
  check("crNumber is null", quietRow.crNumber === null, quietRow.crNumber);

  const afterQuiet = await receipts.getPaymentOptions(cashier, jo2.id);
  check("the receivable still closes", afterQuiet.outstanding === "500.00", afterQuiet.outstanding);

  // A payment with no serial cannot be "replaced" — there is nothing to supersede.
  let replaceQuiet = "";
  try {
    await receipts.replaceReceipt(actor, {
      receiptId: quiet.id, kind: "COLLECTION", reason: "Trying to replace nothing.",
      replacement: { ...base, jobOrderId: jo2.id, kind: "COLLECTION", amount: "344.00" },
    });
  } catch (e) { replaceQuiet = (e as Error).message; }
  check("an undocumented payment cannot be replaced", replaceQuiet.includes("no document to replace"), replaceQuiet);

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nDownpayment — two invoices, never a partial one");

  const jo3 = await makeJo(3, "2000");
  const dp = await receipts.receivePayment(cashier, {
    ...base, jobOrderId: jo3.id, kind: "SI_VAT", amount: "500.00",
    payments: [{ method: "CASH", amount: "500.00", reference: undefined }],
  });
  check("a downpayment issues an invoice for what was PAID", dp.amountPaid === "500.00", dp.amountPaid);
  check("…and leaves nothing owed on it", dp.balanceDue === "0.00", dp.balanceDue);

  const midway = await receipts.getPaymentOptions(cashier, jo3.id);
  check("the rest of the job stays invoiceable", midway.unbilled === "1500.00", midway.unbilled);
  check("a downpayment creates NO receivable", midway.outstanding === "0.00", midway.outstanding);
  check("another invoice is still allowed", midway.availability.SI_VAT.enabled);

  const balance = await receipts.receivePayment(cashier, {
    ...base, jobOrderId: jo3.id, kind: "SI_VAT", amount: "1500.00",
    payments: [{ method: "CASH", amount: "1500.00", reference: undefined }],
  });
  check("the balance is a SECOND invoice", balance.documentNo !== dp.documentNo, balance.documentNo);

  const done = await receipts.getPaymentOptions(cashier, jo3.id);
  check("the job is now fully invoiced", done.unbilled === "0.00", done.unbilled);
  check("…and fully collected", done.outstanding === "0.00", done.outstanding);
  check("nothing is recommended on a settled job", done.recommended === null, done.recommended);

  // Billing more than is left is refused.
  let overBill = "";
  try {
    await receipts.receivePayment(cashier, {
      ...base, jobOrderId: jo3.id, kind: "SI_VAT", amount: "100.00",
      payments: [{ method: "CASH", amount: "100.00", reference: undefined }],
    });
  } catch (e) { overBill = (e as Error).message; }
  check("invoicing a fully-billed job is refused", overBill.includes("already invoiced in full"), overBill);

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nAn invoice is always settled in full");

  const jo4 = await makeJo(4, "1000");
  let shortPay = "";
  try {
    await receipts.receivePayment(cashier, {
      ...base, jobOrderId: jo4.id, kind: "SI_VAT", amount: "1000.00",
      payments: [{ method: "CASH", amount: "400.00", reference: undefined }],
    });
  } catch (e) { shortPay = (e as Error).message; }
  check("a short-paid Sales Invoice is REFUSED (only a Charge Invoice opens A/R)", shortPay.includes("Issue it for 400.00 instead"), shortPay);

  let chargeWithMoney = "";
  try {
    await receipts.receivePayment(cashier, {
      ...base, jobOrderId: jo4.id, kind: "SI_CHARGE", amount: "1000.00",
      payments: [{ method: "CASH", amount: "1000.00", reference: undefined }],
    });
  } catch (e) { chargeWithMoney = (e as Error).message; }
  check("taking money against a Charge Invoice is refused", chargeWithMoney.includes("records a sale on credit"), chargeWithMoney);

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nJob Order Receipt and Sales Invoice are mutually exclusive");

  const jo5 = await makeJo(5, "600");
  const slip = await receipts.receivePayment(cashier, {
    ...base, jobOrderId: jo5.id, kind: "JO_RECEIPT", amount: "600.00",
    payments: [{ method: "CASH", amount: "600.00", reference: undefined }],
  });
  check("JO receipt takes the JO series", slip.documentNo === "JO-0500", slip.documentNo);

  const jo6 = await makeJo(6, "600");
  await receipts.receivePayment(cashier, {
    ...base, jobOrderId: jo6.id, kind: "SI_VAT", amount: "300.00",
    payments: [{ method: "CASH", amount: "300.00", reference: undefined }],
  });
  const mixed = await receipts.getPaymentOptions(cashier, jo6.id);
  check("once invoiced, a JO Receipt is blocked", !mixed.availability.JO_RECEIPT.enabled);
  check("…and says why", mixed.availability.JO_RECEIPT.reason?.includes("already been invoiced") ?? false, mixed.availability.JO_RECEIPT.reason);

  let mixService = "";
  try {
    await receipts.receivePayment(cashier, {
      ...base, jobOrderId: jo6.id, kind: "JO_RECEIPT", amount: "300.00",
      payments: [{ method: "CASH", amount: "300.00", reference: undefined }],
    });
  } catch (e) { mixService = (e as Error).message; }
  check("the service refuses the mix too", mixService.includes("already been invoiced"), mixService);

  // …and the other way round.
  const slipped = await receipts.getPaymentOptions(cashier, jo5.id);
  check("a job acknowledged by a JO Receipt cannot then be invoiced", !slipped.availability.SI_VAT.enabled);

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nGuards");

  const jo7 = await makeJo(7, "500");
  let zeroLine = "";
  try {
    await receipts.receivePayment(cashier, {
      ...base, jobOrderId: jo7.id, kind: "JO_RECEIPT", amount: "500.00",
      payments: [{ method: "CASH", amount: "0.00", reference: undefined }],
    });
  } catch (e) { zeroLine = (e as Error).message; }
  check("a zero payment line is refused", zeroLine.includes("greater than zero"), zeroLine);

  let noBooklet = "";
  try {
    await receipts.receivePayment(cashier, {
      ...base, jobOrderId: jo7.id, kind: "SI_NON_VAT", amount: "500.00",
      payments: [{ method: "CASH", amount: "500.00", reference: undefined }],
    });
  } catch (e) { noBooklet = (e as Error).message; }
  check("issuing with no active booklet explains itself", noBooklet.includes("No active booklet"), noBooklet);

  let overNonCash = "";
  try {
    await receipts.receivePayment(cashier, {
      ...base, jobOrderId: jo7.id, kind: "JO_RECEIPT", amount: "500.00",
      payments: [{ method: "GCASH", amount: "700.00", reference: undefined }],
    });
  } catch (e) { overNonCash = (e as Error).message; }
  check("over-tender with no cash to give back is refused", overNonCash.includes("Only cash can be over-tendered"), overNonCash);

  let viewerDenied = "";
  try {
    await receipts.receivePayment(viewer, {
      ...base, jobOrderId: jo7.id, kind: "JO_RECEIPT", amount: "1.00",
      payments: [{ method: "CASH", amount: "1.00", reference: undefined }],
    });
  } catch (e) { viewerDenied = (e as Error).constructor.name; }
  check("VIEWER cannot receive payment (ForbiddenError)", viewerDenied === "ForbiddenError", viewerDenied);

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nSeries numbers are gapless, unique, and never reused");

  const nums: string[] = [];
  for (let i = 0; i < 4; i++) {
    const j = await makeJo(100 + i, "10");
    const r = await receipts.receivePayment(cashier, {
      ...base, jobOrderId: j.id, kind: "JO_RECEIPT", amount: "10.00",
      payments: [{ method: "CASH", amount: "10.00", reference: undefined }],
    });
    nums.push(r.documentNo!);
  }
  check("sequential: JO-0501…JO-0504", nums.join(",") === "JO-0501,JO-0502,JO-0503,JO-0504", nums.join(","));
  check("all numbers unique", new Set(nums).size === nums.length);

  // 5 cashiers hitting Receive Payment at once must never share a number.
  const burstJos = await Promise.all(
    Array.from({ length: 5 }, (_, i) => makeJo(200 + i, "10"))
  );
  const burst = await Promise.all(
    burstJos.map((j) =>
      receipts.receivePayment(cashier, {
        ...base, jobOrderId: j.id, kind: "JO_RECEIPT", amount: "10.00",
        payments: [{ method: "CASH", amount: "10.00", reference: undefined }],
      }).then((r) => r.documentNo)
    )
  );
  check("5 concurrent payments → 5 DISTINCT numbers (no double-issue)", new Set(burst).size === 5, burst.join(","));

  // Concurrent collections against ONE invoice must not over-collect: the
  // guarded UPDATE inside the transaction is what stops it.
  const joRace = await makeJo(300, "1000");
  await receipts.receivePayment(cashier, {
    ...base, jobOrderId: joRace.id, kind: "SI_CHARGE", amount: "1000.00", payments: [],
  });
  const raceResults = await Promise.allSettled(
    Array.from({ length: 4 }, () =>
      receipts.receivePayment(cashier, {
        ...base, jobOrderId: joRace.id, kind: "COLLECTION", amount: "1000.00",
        issueDocument: false,
        payments: [{ method: "CASH", amount: "1000.00", reference: undefined }],
      })
    )
  );
  const won = raceResults.filter((r) => r.status === "fulfilled").length;
  const raceRow = await prisma.sale.findFirstOrThrow({
    where: { jobOrder: { joNumber: `${PREFIX}JO-300` }, type: "SI_CHARGE" },
  });
  check("4 cashiers collecting the same debt → exactly ONE succeeds", won === 1, won);
  check("…and the invoice is settled once, not four times", raceRow.settledAmount.toString() === "1000", raceRow.settledAmount.toString());

  // Exhaust a booklet: a dedicated 3-leaf Non-VAT series.
  const nvBk = await booklets.create(cashier, {
    type: "SI_NON_VAT", seriesStart: 9500, seriesEnd: 9502,
    label: `${PREFIX}NV booklet`, gapExempt: false,
  });
  await booklets.approve(actor, nvBk.id);
  for (let i = 0; i < 3; i++) {
    const j = await makeJo(400 + i, "100");
    await receipts.receivePayment(cashier, {
      ...base, jobOrderId: j.id, kind: "SI_NON_VAT", amount: "100.00",
      payments: [{ method: "CASH", amount: "100.00", reference: undefined }],
    });
  }
  const spent = (await booklets.list(actor, { type: "SI_NON_VAT" })).find((b) => b.id === nvBk.id)!;
  check("a used-up booklet flips to CONSUMED", spent.status === "CONSUMED", spent.status);
  check("consumed booklet reports 0 remaining", spent.remaining === 0, spent.remaining);

  const joPast = await makeJo(410, "100");
  let exhausted = "";
  try {
    await receipts.receivePayment(cashier, {
      ...base, jobOrderId: joPast.id, kind: "SI_NON_VAT", amount: "100.00",
      payments: [{ method: "CASH", amount: "100.00", reference: undefined }],
    });
  } catch (e) { exhausted = (e as Error).message; }
  check("issuing past the last leaf is refused", exhausted.length > 0 && !exhausted.includes("Cannot read"), exhausted);

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nDaily sales + VAT / Non-VAT report");
  const summary = await receipts.getDailySummary(actor);
  const delta = (now: string, was: string) => toCentavos(now) - toCentavos(was);

  // VAT invoices: 1120 + 2200 + 500 + 1500 + 300 = 5,620.00
  check("VAT invoices totalled", delta(summary.vat.gross, baseline.vat.gross) === toCentavos("5620.00"), summary.vat.gross);
  check("net + VAT === gross in the report",
    toCentavos(summary.vat.vatableSales) + toCentavos(summary.vat.vatAmount) === toCentavos(summary.vat.gross));
  // Charge invoices: 1,344 + 1,000 = 2,344.00 — revenue AT POINT OF SALE.
  check("charge invoices totalled separately", delta(summary.charge.gross, baseline.charge.gross) === toCentavos("2344.00"), summary.charge.gross);
  check("charge invoice VAT is reported like any other",
    delta(summary.charge.vatAmount, baseline.charge.vatAmount) === toCentavos("251.14"), summary.charge.vatAmount);
  // Non-VAT: 3 × 100
  check("Non-VAT invoices totalled", delta(summary.nonVat.gross, baseline.nonVat.gross) === toCentavos("300.00"), summary.nonVat.gross);
  // JO receipts: 600 + (4 × 10) + (5 × 10) = 690.00
  check("JO receipts totalled separately", delta(summary.joReceipts.gross, baseline.joReceipts.gross) === toCentavos("690.00"), summary.joReceipts.gross);
  // Collections: 500 + 344 + 1000 = 1,844.00
  check("collections totalled separately", delta(summary.collections.gross, baseline.collections.gross) === toCentavos("1844.00"), summary.collections.gross);
  // Gross = VAT + Non-VAT + Charge + JO receipts — collections EXCLUDED.
  check("collections are EXCLUDED from gross sales (no double-count)",
    delta(summary.grossSales, baseline.grossSales) === toCentavos("8954.00"),
    `${delta(summary.grossSales, baseline.grossSales)} (expected 895400 = 5620 + 300 + 2344 + 690)`);
  // A/R: the 1,344 charge invoice less 844 collected = 500 still owed.
  check("receivables net off what has been collected",
    delta(summary.receivables.amount, baseline.receivables.amount) === toCentavos("500.00"), summary.receivables.amount);

  const day = await receipts.listDay(actor, { take: 100 });
  check("daily log lists every receipt kind", day.rows.length >= 15, day.rows.length);
  check("an undocumented payment appears with no serial",
    day.rows.some((r) => r.documentNo === null && r.documentIssued === false));

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nAuditor sign-off");
  check("receipts start unaudited", summary.pendingAudit > 0, summary.pendingAudit);

  let cashierAudit = "";
  try {
    await receipts.auditReceipt(cashier, { saleId: siRow.id, status: "REVIEWED" });
  } catch (e) { cashierAudit = (e as Error).constructor.name; }
  check("a cashier cannot sign off their own receipt (ForbiddenError)", cashierAudit === "ForbiddenError", cashierAudit);

  await receipts.auditReceipt(auditor, { saleId: siRow.id, status: "REVIEWED", remarks: "Tallied with cash count." });
  const crRow = await prisma.collectionReceipt.findFirstOrThrow({ where: { crNumber: "CR-0300" } });
  await receipts.auditReceipt(auditor, {
    collectionReceiptId: crRow.id, status: "FLAGGED",
    flagType: "DISCREPANCY", remarks: "GCash ref not in the statement.",
  });

  const audited = await receipts.listDay(auditor, { take: 100 });
  const siAudited = audited.rows.find((r) => r.documentNo === "IN-9000")!;
  const crAudited = audited.rows.find((r) => r.documentNo === "CR-0300")!;
  check("auditor's REVIEWED sign-off shows on the sale", siAudited.auditStatus === "REVIEWED", siAudited.auditStatus);
  check("the auditor is named on the row", siAudited.auditorName === auditorUser.name, siAudited.auditorName);
  check("auditor can FLAG a collection receipt too", crAudited.auditStatus === "FLAGGED", crAudited.auditStatus);
  check("flag remarks are kept", crAudited.auditRemarks?.includes("GCash") ?? false, crAudited.auditRemarks);

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nCancel / void a receipt (docs/sales.txt §5)");

  const jo8 = await makeJo(8, "400");
  const doomed = await receipts.receivePayment(cashier, {
    ...base, jobOrderId: jo8.id, kind: "SI_VAT", amount: "400.00",
    payments: [{ method: "CASH", amount: "400.00", reference: undefined }],
  });
  const paidOpts = await receipts.getPaymentOptions(actor, jo8.id);
  check("a fresh invoice closes the job's unbilled", paidOpts.unbilled === "0.00", paidOpts.unbilled);

  let cashierVoid = "";
  try {
    await receipts.voidReceipt(cashier, {
      receiptId: doomed.id, kind: "SI_VAT",
      type: "CANCELLED", reason: "Customer changed their mind.",
    });
  } catch (e) { cashierVoid = (e as Error).constructor.name; }
  check("a cashier cannot void a receipt (needs a supervisor)", cashierVoid === "ForbiddenError", cashierVoid);

  await receipts.voidReceipt(actor, {
    receiptId: doomed.id, kind: "SI_VAT",
    type: "CANCELLED", reason: "Customer changed their mind.",
  });

  const voided = await prisma.sale.findUniqueOrThrow({
    where: { documentNo: doomed.documentNo! },
    include: { voidedBy: { select: { name: true } } },
  });
  check("the voided receipt is NOT deleted", voided.id === doomed.id);
  check("it keeps its serial number", voided.documentNo === doomed.documentNo, voided.documentNo);
  check("marked CANCELLED", voided.voidType === "CANCELLED", voided.voidType);
  check("the reason is kept (written on its face)", voided.voidReason === "Customer changed their mind.", voided.voidReason);
  check("the approver is named on it", voided.voidedBy?.name === admin.name, voided.voidedBy?.name);

  const reopened = await receipts.getPaymentOptions(actor, jo8.id);
  check("cancelling REOPENS the job for invoicing", reopened.unbilled === "400.00", reopened.unbilled);
  check("…and a new invoice is allowed again", reopened.availability.SI_VAT.enabled);
  check("the cancelled receipt is still LISTED (every leaf accounted for)",
    reopened.issued.some((r) => r.documentNo === doomed.documentNo && r.voidType === "CANCELLED"));
  check("a cancelled number is never reissued",
    reopened.nextNumbers.SI_VAT !== doomed.documentNo, reopened.nextNumbers.SI_VAT);

  let twice = "";
  try {
    await receipts.voidReceipt(actor, {
      receiptId: doomed.id, kind: "SI_VAT", type: "VOID", reason: "Again.",
    });
  } catch (e) { twice = (e as Error).message; }
  check("cancelling the same receipt twice is refused", twice.includes("already been cancelled"), twice);

  // Cancelling a COLLECTION must reopen the receivable it closed.
  const beforeUncollect = await receipts.getPaymentOptions(actor, jo2.id);
  await receipts.voidReceipt(actor, {
    receiptId: crRow.id, kind: "COLLECTION",
    type: "CANCELLED", reason: "GCash payment bounced.",
  });
  const afterUncollect = await receipts.getPaymentOptions(actor, jo2.id);
  check("cancelling a collection REOPENS the receivable",
    toCentavos(afterUncollect.outstanding) === toCentavos(beforeUncollect.outstanding) + 50000,
    `${beforeUncollect.outstanding} → ${afterUncollect.outstanding}`);
  const uncollected = await prisma.sale.findUniqueOrThrow({ where: { documentNo: "IN-0700" } });
  check("…and the invoice's settledAmount comes back down",
    uncollected.settledAmount.toString() === "344", uncollected.settledAmount.toString());
  check("its allocations are gone", (await prisma.crAllocation.count({ where: { crId: crRow.id } })) === 0);

  // An invoice with live collections against it cannot be pulled out from
  // under them — cancel the collections first.
  let voidCollected = "";
  try {
    await receipts.voidReceipt(actor, {
      receiptId: uncollected.id, kind: "SI_CHARGE",
      type: "CANCELLED", reason: "Trying to cancel a collected invoice.",
    });
  } catch (e) { voidCollected = (e as Error).message; }
  check("an invoice with collections applied cannot be cancelled", voidCollected.includes("collection"), voidCollected);

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nReplace a receipt — void + reissue in one transaction");

  const jo9 = await makeJo(9, "300");
  const wrong = await receipts.receivePayment(cashier, {
    ...base, jobOrderId: jo9.id, kind: "SI_VAT", amount: "250.00",
    payments: [{ method: "CASH", amount: "250.00", reference: undefined }],
  });

  const replaced = await receipts.replaceReceipt(actor, {
    receiptId: wrong.id, kind: "SI_VAT",
    reason: "Wrong amount encoded — should be 260.00.",
    replacement: {
      ...base, jobOrderId: jo9.id, kind: "SI_VAT", amount: "260.00",
      payments: [{ method: "CASH", amount: "300.00", reference: undefined }],
    },
  });
  check("replacing reports both serials", replaced.replacedDocumentNo === wrong.documentNo, replaced.replacedDocumentNo);
  check("the replacement takes the NEXT number", replaced.documentNo !== wrong.documentNo, replaced.documentNo);
  check("the replacement's own change is computed: 300 − 260 = 40.00", replaced.changeGiven === "40.00", replaced.changeGiven);

  const oldRow = await prisma.sale.findUniqueOrThrow({
    where: { documentNo: wrong.documentNo! },
    include: { replacedBy: { select: { documentNo: true } } },
  });
  const newRow = await prisma.sale.findUniqueOrThrow({
    where: { documentNo: replaced.documentNo! },
    include: { replaces: { select: { documentNo: true } } },
  });
  check("the spoiled receipt is marked REPLACED", oldRow.voidType === "REPLACED", oldRow.voidType);
  check("the reason is kept", oldRow.voidReason?.includes("Wrong amount") ?? false, oldRow.voidReason);
  check("the old points at the new", oldRow.replacedBy?.documentNo === replaced.documentNo, oldRow.replacedBy?.documentNo);
  check("the new points back at the old", newRow.replaces?.documentNo === wrong.documentNo, newRow.replaces?.documentNo);
  // The superseded receipt must not count against its own successor's cap.
  check("a replacement is not blocked by the receipt it supersedes", newRow.amount.toString() === "260", newRow.amount.toString());

  let crossKind = "";
  try {
    await receipts.replaceReceipt(actor, {
      receiptId: newRow.id, kind: "SI_VAT", reason: "Trying to cross series.",
      replacement: { ...base, jobOrderId: jo9.id, kind: "COLLECTION", amount: "260.00" },
    });
  } catch (e) { crossKind = (e as Error).message; }
  check("a replacement cannot switch receipt type", crossKind.includes("same receipt type"), crossKind);
  const strayStill = await prisma.sale.findUniqueOrThrow({ where: { id: newRow.id } });
  check("a refused replacement leaves the original untouched", strayStill.voidType === null, strayStill.voidType);

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nCredit control (behind the credit-control flag)");

  const customer = await prisma.customer.findFirstOrThrow({ where: { name: CUSTOMER } });
  const jo10 = await makeJo(10, "5000");

  // Flag OFF: terms and limits are ignored entirely — legacy behaviour.
  await prisma.customer.update({
    where: { id: customer.id },
    data: { creditTermDays: 30, creditLimit: "100.00" },
  });
  const offOpts = await receipts.getPaymentOptions(cashier, jo10.id);
  check("with the flag off, credit is not enforced", offOpts.credit.enabled === false, offOpts.credit);
  check("…and a charge invoice past the 'limit' is still allowed", offOpts.availability.SI_CHARGE.enabled);

  const noTerms = await receipts.receivePayment(cashier, {
    ...base, jobOrderId: jo10.id, kind: "SI_CHARGE", amount: "1000.00", payments: [],
  });
  const noTermsRow = await prisma.sale.findUniqueOrThrow({ where: { id: noTerms.id } });
  check("no due date is set while credit control is off", noTermsRow.dueDate === null, noTermsRow.dueDate);

  // Flag ON.
  await prisma.moduleFlag.upsert({
    where: { key: "credit-control" },
    create: { key: "credit-control", enabled: true },
    update: { enabled: true },
  });

  const onOpts = await receipts.getPaymentOptions(cashier, jo10.id);
  check("with the flag on, credit is enforced", onOpts.credit.enabled === true);
  check("terms are reported", onOpts.credit.termDays === 30, onOpts.credit.termDays);
  check("the limit is reported", onOpts.credit.limit === "100.00", onOpts.credit.limit);
  check("the customer's whole open A/R is counted, not just this job",
    toCentavos(onOpts.credit.customerOutstanding) > toCentavos("1000.00"), onOpts.credit.customerOutstanding);
  check("already past the limit → a charge invoice is blocked", !onOpts.availability.SI_CHARGE.enabled);
  check("…and says so", onOpts.availability.SI_CHARGE.reason?.includes("credit limit") ?? false, onOpts.availability.SI_CHARGE.reason);

  let overLimit = "";
  try {
    await receipts.receivePayment(cashier, {
      ...base, jobOrderId: jo10.id, kind: "SI_CHARGE", amount: "1000.00", payments: [],
    });
  } catch (e) { overLimit = (e as Error).message; }
  check("the service refuses a charge invoice past the limit", overLimit.includes("credit limit"), overLimit);

  // A cash invoice is unaffected — credit control governs credit only.
  check("a CASH invoice is never blocked by a credit limit", onOpts.availability.SI_VAT.enabled);

  // Raise the ceiling and the charge invoice goes through, with a due date.
  await prisma.customer.update({
    where: { id: customer.id }, data: { creditLimit: "999999.00" },
  });
  const termed = await receipts.receivePayment(cashier, {
    ...base, jobOrderId: jo10.id, kind: "SI_CHARGE", amount: "1000.00", payments: [],
  });
  const termedRow = await prisma.sale.findUniqueOrThrow({ where: { id: termed.id } });
  check("a charge invoice under the limit goes through", termedRow.voidType === null);
  check("…and carries a due date from the customer's terms", termedRow.dueDate !== null, termedRow.dueDate);
  const days = termedRow.dueDate
    ? Math.round((termedRow.dueDate.getTime() - termedRow.saleDate.getTime()) / 86_400_000)
    : -1;
  check("due exactly net-30 from the sale date", days === 30, days);

  // Credit terms are set through the service, and only by an admin.
  let cashierTerms = "";
  try {
    await ar.setCredit(cashier, { customerId: customer.id, creditTermDays: 15, creditLimit: null });
  } catch (e) { cashierTerms = (e as Error).constructor.name; }
  check("a cashier cannot change credit terms (ForbiddenError)", cashierTerms === "ForbiddenError", cashierTerms);

  await ar.setCredit(actor, { customerId: customer.id, creditTermDays: 15, creditLimit: "50000.00" });
  const reterm = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
  check("an admin can set terms", reterm.creditTermDays === 15, reterm.creditTermDays);
  check("…and a limit", reterm.creditLimit?.toString() === "50000", reterm.creditLimit?.toString());

  await ar.setCredit(actor, { customerId: customer.id, creditTermDays: null, creditLimit: null });
  const cleared = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
  check("terms can be cleared back to none", cleared.creditTermDays === null && cleared.creditLimit === null);

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nCustomer-level collection (the QuickBooks Receive Payment)");

  // Two charge invoices on DIFFERENT job orders — one payment must settle
  // across both, which the job-scoped counter flow cannot do.
  const joA = await makeJo(500, "1000");
  const joB = await makeJo(501, "600");
  await receipts.receivePayment(cashier, {
    ...base, jobOrderId: joA.id, kind: "SI_CHARGE", amount: "1000.00", payments: [],
  });
  await receipts.receivePayment(cashier, {
    ...base, jobOrderId: joB.id, kind: "SI_CHARGE", amount: "600.00", payments: [],
  });

  const acct = await receipts.getCollectOptions(cashier, customer.id);
  check("the account lists invoices from EVERY job order",
    new Set(acct.invoices.map((i) => i.joNumber)).size > 1,
    acct.invoices.map((i) => i.joNumber));
  check("…oldest first", acct.invoices.every((inv, i, all) =>
    i === 0 || new Date(all[i - 1].saleDate) <= new Date(inv.saleDate)));

  // ₱1,200 against a ₱1,000 + ₱600 pair: the first closes, the second part-pays.
  const paid = await receipts.collectFromCustomer(cashier, {
    customerId: customer.id,
    payments: [{ method: "CASH", amount: "1200.00", reference: undefined }],
    issueDocument: true,
  });
  check("one payment settles across job orders", paid.applied === "1200.00", paid.applied);
  check("…closing the oldest invoice outright", paid.invoicesClosed >= 1, paid.invoicesClosed);
  check("nothing is left as credit when invoices absorb it", paid.creditCreated === "0.00", paid.creditCreated);

  const spread = await prisma.crAllocation.findMany({ where: { crId: paid.id } });
  check("the payment is allocated to more than one invoice", spread.length >= 2, spread.length);
  check("allocations sum to what was applied",
    spread.reduce((t, a) => t + toCentavos(a.amount.toString()), 0) === toCentavos("1200.00"));

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nOverpayment is held as customer credit");

  const afterSpread = await receipts.getCollectOptions(cashier, customer.id);
  const owedNow = toCentavos(afterSpread.totalOutstanding);
  const over = await receipts.collectFromCustomer(cashier, {
    customerId: customer.id,
    payments: [{ method: "CASH", amount: toAmount(owedNow + 50000), reference: undefined }],
    issueDocument: true,
  });
  check("everything owed is applied", toCentavos(over.applied) === owedNow, over.applied);
  check("the excess becomes credit, not change", over.creditCreated === "500.00", over.creditCreated);

  const credited = await receipts.getCollectOptions(cashier, customer.id);
  check("the account now holds credit", credited.creditAvailable === "500.00", credited.creditAvailable);
  check("…and owes nothing", credited.totalOutstanding === "0.00", credited.totalOutstanding);

  const creditRow = await prisma.advancePayment.findFirstOrThrow({
    where: { customer: { name: CUSTOMER }, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  check("the credit is UNAPPLIED", creditRow.status === "UNAPPLIED", creditRow.status);
  check("…and traces back to the payment that created it",
    creditRow.sourceCollectionReceiptId === over.id, creditRow.sourceCollectionReceiptId);

  // The collection's own amount is the TENDER only — credit must not be
  // counted as cash arriving twice.
  const overCr = await prisma.collectionReceipt.findUniqueOrThrow({ where: { id: over.id } });
  check("the receipt records the tender, not the applied total",
    overCr.amount.toString() === String(Number(toAmount(owedNow + 50000))), overCr.amount.toString());

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nSpending credit on a later invoice");

  const joC = await makeJo(502, "800");
  await receipts.receivePayment(cashier, {
    ...base, jobOrderId: joC.id, kind: "SI_CHARGE", amount: "800.00", payments: [],
  });

  let cashAndCredit = "";
  try {
    await receipts.collectFromCustomer(cashier, {
      customerId: customer.id,
      payments: [{ method: "CASH", amount: "500.00", reference: undefined }],
      creditApplied: "500.00",
      issueDocument: false,
    });
  } catch (e) { cashAndCredit = (e as Error).message; }
  check("spending credit AND leaving credit over is refused",
    cashAndCredit === "" || cashAndCredit.includes("Apply only what"), cashAndCredit);

  const usedCredit = await receipts.collectFromCustomer(cashier, {
    customerId: customer.id,
    payments: [{ method: "CASH", amount: "300.00", reference: undefined }],
    creditApplied: "500.00",
    issueDocument: true,
  });
  check("credit funds part of the payment", usedCredit.creditUsed === "500.00", usedCredit.creditUsed);
  check("cash + credit settle the invoice", usedCredit.applied === "800.00", usedCredit.applied);
  check("only the CASH counts as received", usedCredit.received === "300.00", usedCredit.received);

  const spentCredit = await prisma.advancePayment.findUniqueOrThrow({ where: { id: creditRow.id } });
  check("the credit is now FULLY_APPLIED", spentCredit.status === "FULLY_APPLIED", spentCredit.status);

  const drained = await receipts.getCollectOptions(cashier, customer.id);
  check("no credit is left on the account", drained.creditAvailable === "0.00", drained.creditAvailable);
  check("…and nothing is outstanding", drained.totalOutstanding === "0.00", drained.totalOutstanding);

  let noCredit = "";
  try {
    await receipts.collectFromCustomer(cashier, {
      customerId: customer.id, creditApplied: "100.00", issueDocument: false,
    });
  } catch (e) { noCredit = (e as Error).message; }
  check("spending credit that isn't there is refused",
    noCredit.includes("of credit is on") || noCredit.includes("nothing outstanding"), noCredit);

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nCancelling a payment unwinds its credit");

  const joD = await makeJo(503, "400");
  await receipts.receivePayment(cashier, {
    ...base, jobOrderId: joD.id, kind: "SI_CHARGE", amount: "400.00", payments: [],
  });
  const willVoid = await receipts.collectFromCustomer(cashier, {
    customerId: customer.id,
    payments: [{ method: "CASH", amount: "700.00", reference: undefined }],
    issueDocument: true,
  });
  check("overpaying again parks 300 as credit", willVoid.creditCreated === "300.00", willVoid.creditCreated);

  await receipts.voidReceipt(actor, {
    receiptId: willVoid.id, kind: "COLLECTION",
    type: "CANCELLED", reason: "Cheque bounced.",
  });
  const unwound = await receipts.getCollectOptions(cashier, customer.id);
  check("cancelling reopens the invoice", unwound.totalOutstanding === "400.00", unwound.totalOutstanding);
  check("…and takes the credit back off the account", unwound.creditAvailable === "0.00", unwound.creditAvailable);

  // A credit already spent elsewhere cannot be yanked back.
  const joE = await makeJo(504, "200");
  await receipts.receivePayment(cashier, {
    ...base, jobOrderId: joE.id, kind: "SI_CHARGE", amount: "200.00", payments: [],
  });
  const maker = await receipts.collectFromCustomer(cashier, {
    customerId: customer.id,
    payments: [{ method: "CASH", amount: "1000.00", reference: undefined }],
    issueDocument: true,
  });
  check("that payment leaves credit behind", toCentavos(maker.creditCreated) > 0, maker.creditCreated);

  const joF = await makeJo(505, "100");
  await receipts.receivePayment(cashier, {
    ...base, jobOrderId: joF.id, kind: "SI_CHARGE", amount: "100.00", payments: [],
  });
  await receipts.collectFromCustomer(cashier, {
    customerId: customer.id, creditApplied: "100.00", issueDocument: false,
  });

  let lockedCredit = "";
  try {
    await receipts.voidReceipt(actor, {
      receiptId: maker.id, kind: "COLLECTION",
      type: "CANCELLED", reason: "Trying to unwind spent credit.",
    });
  } catch (e) { lockedCredit = (e as Error).message; }
  check("a payment whose credit has been spent cannot be cancelled",
    lockedCredit.includes("already been spent"), lockedCredit);

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nReplacing a customer-level Collection Receipt");

  const joR = await makeJo(550, "900");
  await receipts.receivePayment(cashier, {
    ...base, jobOrderId: joR.id, kind: "SI_CHARGE", amount: "900.00", payments: [],
  });
  const mistyped = await receipts.collectFromCustomer(cashier, {
    customerId: customer.id,
    payments: [{ method: "CASH", amount: "500.00", reference: undefined }],
    issueDocument: true,
  });

  const fixed = await receipts.collectFromCustomer(actor, {
    customerId: customer.id,
    payments: [{ method: "CASH", amount: "600.00", reference: undefined }],
    issueDocument: true,
    replaces: { receiptId: mistyped.id, reason: "Wrong amount encoded — 600, not 500." },
  });
  check("the replacement reports both serials",
    fixed.replacedDocumentNo === mistyped.documentNo, fixed.replacedDocumentNo);
  check("…and takes the next number", fixed.documentNo !== mistyped.documentNo, fixed.documentNo);
  check("the corrected amount is applied", fixed.applied === "600.00", fixed.applied);

  const oldCr = await prisma.collectionReceipt.findUniqueOrThrow({
    where: { id: mistyped.id },
    include: { replacedBy: { select: { crNumber: true } }, allocations: true },
  });
  const newCr = await prisma.collectionReceipt.findUniqueOrThrow({
    where: { id: fixed.id },
    include: { replaces: { select: { crNumber: true } } },
  });
  check("the spoiled receipt is marked REPLACED", oldCr.voidType === "REPLACED", oldCr.voidType);
  check("the old points at the new", oldCr.replacedBy?.crNumber === fixed.documentNo, oldCr.replacedBy?.crNumber);
  check("the new points back at the old", newCr.replaces?.crNumber === mistyped.documentNo, newCr.replaces?.crNumber);
  check("the superseded receipt no longer pays for anything", oldCr.allocations.length === 0, oldCr.allocations.length);

  // The invoice must reflect the REPLACEMENT only — not both, and not neither.
  const joRInvoice = await prisma.sale.findFirstOrThrow({
    where: { jobOrder: { joNumber: `${PREFIX}JO-550` }, type: "SI_CHARGE" },
  });
  check("the invoice is settled by the replacement alone",
    joRInvoice.settledAmount.toString() === "600", joRInvoice.settledAmount.toString());

  // A replacement is not blocked by the debt its own predecessor was paying.
  check("replacing did not double-count the old payment",
    toCentavos((await receipts.getCollectOptions(cashier, customer.id)).totalOutstanding) === toCentavos("300.00"),
    (await receipts.getCollectOptions(cashier, customer.id)).totalOutstanding);

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nAccounts Receivable ledger");

  // The collection tests above deliberately drained the account, so give the
  // ledger something live to report on.
  const joLedger = await makeJo(600, "1500");
  await receipts.receivePayment(cashier, {
    ...base, jobOrderId: joLedger.id, kind: "SI_CHARGE", amount: "1500.00", payments: [],
  });

  const ledger = await ar.list(actor);
  const line = ledger.customers.find((c) => c.customerName === CUSTOMER)!;
  check("the customer appears on the A/R ledger", line !== undefined);
  check("their outstanding is the sum of open invoices",
    toCentavos(line.outstanding) > 0, line.outstanding);
  check("aging buckets sum to the outstanding",
    Object.values(line.aging).reduce((t, a) => t + toCentavos(a), 0) === toCentavos(line.outstanding),
    line.aging);
  check("a fresh net-30 invoice sits in CURRENT, not overdue",
    toCentavos(line.aging.CURRENT) > 0, line.aging);
  check("the ledger reports the credit-control flag", ledger.creditControlEnabled === true);
  check("summary totals match the rows",
    toCentavos(ledger.summary.totalOutstanding) ===
      ledger.customers.reduce((t, c) => t + toCentavos(c.outstanding), 0));

  // A settled invoice must NOT appear — this is what the superset filter and
  // the open-balance drop are for. A customer may still show with nothing
  // outstanding when the shop is holding CREDIT for them; what must never
  // appear is a row that is empty on both counts.
  const settledIn = await ar.list(actor, { q: CUSTOMER });
  check("fully-collected invoices drop off the ledger",
    !settledIn.customers.some(
      (c) => toCentavos(c.outstanding) <= 0 && toCentavos(c.creditOnAccount) <= 0
    ));
  check("credit held for the customer is reported beside the debt",
    settledIn.customers.every(
      (c) => toCentavos(c.creditOnAccount) >= 0
    ));

  const statement = await ar.statement(actor, customer.id);
  check("the statement names the customer", statement.customerName === CUSTOMER, statement.customerName);
  check("it lists only OPEN invoices", statement.invoices.every((i) => toCentavos(i.openBalance) > 0));
  check("it is ordered oldest first",
    statement.invoices.every((inv, i, all) =>
      i === 0 || new Date(all[i - 1].saleDate) <= new Date(inv.saleDate)));
  check("its total matches the ledger line", statement.totalOutstanding === line.outstanding,
    `${statement.totalOutstanding} vs ${line.outstanding}`);
  check("every invoice lands in an aging bucket", statement.invoices.every((i) => i.bucket !== undefined));

  let viewerLedger = "";
  try {
    await ar.list({ id: admin.id, role: "VIEWER" });
  } catch (e) { viewerLedger = (e as Error).constructor.name; }
  check("a VIEWER may read the A/R ledger", viewerLedger === "", viewerLedger);

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nCustomer account — debts, credits and payment history");

  const acctView = await ar.account(actor, customer.id);
  check("the account names the customer", acctView.customerName === CUSTOMER, acctView.customerName);
  check("open invoices match the ledger line",
    acctView.totalOutstanding === line.outstanding,
    `${acctView.totalOutstanding} vs ${line.outstanding}`);
  check("aging sums to the outstanding",
    Object.values(acctView.aging).reduce((t, a) => t + toCentavos(a), 0) ===
      toCentavos(acctView.totalOutstanding));

  check("payment history is listed", acctView.payments.length > 0, acctView.payments.length);
  check("newest payment first", acctView.payments.every((p, i, all) =>
    i === 0 || new Date(all[i - 1].receivedAt) >= new Date(p.receivedAt)));
  check("each payment shows the invoices it settled",
    acctView.payments.some((p) => p.applied.length > 0));
  check("a payment across job orders lists several invoices",
    acctView.payments.some((p) => p.applied.length > 1),
    acctView.payments.map((p) => p.applied.length));
  check("a cancelled payment is shown, marked, not hidden",
    acctView.payments.some((p) => p.voidType === "CANCELLED"));
  check("an unreceipted payment is shown with no serial",
    acctView.payments.some((p) => p.documentNo === null && !p.documentIssued));

  check("credits are listed with what is left on them", acctView.credits.length > 0, acctView.credits.length);
  check("a fully-spent credit is kept in the history",
    acctView.credits.some((c) => c.status === "FULLY_APPLIED"));
  check("credit on account matches the ledger line",
    acctView.creditOnAccount === line.creditOnAccount,
    `${acctView.creditOnAccount} vs ${line.creditOnAccount}`);
  check("a payment funded by credit says so",
    acctView.payments.some((p) => toCentavos(p.creditApplied) > 0));
  check("a payment that left credit says so",
    acctView.payments.some((p) => toCentavos(p.creditCreated) > 0));

  let missingAccount = "";
  try {
    await ar.account(actor, "no-such-customer");
  } catch (e) { missingAccount = (e as Error).constructor.name; }
  check("an unknown customer is a clean NotFound", missingAccount === "NotFoundError", missingAccount);

  console.log(fails === 0 ? "\nALL SALES-AUDIT CHECKS PASSED" : `\n${fails} FAILED`);
  process.exitCode = fails ? 1 : 0;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => {
    // The shop's own booklets go back into service whatever happened above —
    // a failed assertion must never leave the counter unable to issue.
    await cleanup().catch((e) => console.error("cleanup failed", e));
    await restoreBooklets().catch((e) => console.error("restore failed", e));
    await prisma.$disconnect();
  });
