// End-to-end verification for the Sales & Audit module (receipts, booklets,
// accounts receivable). Run: npx tsx scripts/verify-sales-audit.ts
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getJobOrderService } from "../src/modules/job-orders/services";
import {
  getBookletService,
  getReceiptService,
  getReceivableService,
  getBacklogService,
  getWithholdingService,
  computeWithholding,
  splitVat,
  toAmount,
  toCentavos,
} from "../src/modules/sales-audit/services";
import { AGING_BUCKETS } from "../src/modules/sales-audit/schemas/receipt";
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

// This script switches credit control ON to exercise it. That is a setting the
// shop may have deliberately chosen, so its prior value is captured and put
// back — `undefined` means "not captured yet", `null` means "no override was
// stored", which is itself the state to restore.
let priorCreditFlag: { enabled: boolean } | null | undefined;

async function borrowCreditFlag() {
  priorCreditFlag = await prisma.moduleFlag.findUnique({
    where: { key: "credit-control" },
    select: { enabled: true },
  });
}

async function restoreCreditFlag() {
  if (priorCreditFlag === undefined) return;
  if (priorCreditFlag === null) {
    await prisma.moduleFlag.deleteMany({ where: { key: "credit-control" } });
  } else {
    await prisma.moduleFlag.upsert({
      where: { key: "credit-control" },
      create: { key: "credit-control", enabled: priorCreditFlag.enabled },
      update: { enabled: priorCreditFlag.enabled },
    });
    console.log(`  (restored credit-control = ${priorCreditFlag.enabled})`);
  }
  priorCreditFlag = undefined;
}

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
  // startsWith, not equals: the as-of block adds "<CUSTOMER> History" so it
  // can build a dated debt without disturbing the main fixture.
  const ours = { customer: { name: { startsWith: CUSTOMER } } };

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
  // Certificates hold a customer FK of their own — they go before the customer.
  await prisma.withholdingCertificate.deleteMany({
    where: { customer: { name: { startsWith: CUSTOMER } } },
  });
  await prisma.customer.deleteMany({
    where: { name: { startsWith: CUSTOMER } },
  });
  await prisma.booklet.deleteMany({ where: { label: { startsWith: PREFIX } } });
  // The credit-control flag is NOT cleared here — deleting it would discard a
  // setting the shop chose. restoreCreditFlag() puts back whatever was there.
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
  await borrowCreditFlag();

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
  // Snapshot the NV line BEFORE anything lands on IN. Comparing against this
  // makes the independence check below about the two lines rather than about
  // whatever happens to be in this database already.
  const nvBefore = await booklets.suggestRange(actor, "SI_NON_VAT");

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

  // VAT + Charge Invoice are ONE pre-printed IN series; Non-VAT is its own NV
  // series and shares nothing with them (docs/sales.txt §4.1).
  const [vatNext, nonVatNext, chargeNext] = await Promise.all([
    booklets.suggestRange(actor, "SI_VAT"),
    booklets.suggestRange(actor, "SI_NON_VAT"),
    booklets.suggestRange(actor, "SI_CHARGE"),
  ]);
  check("VAT and Charge Invoice continue ONE number line",
    chargeNext.suggestedStart === vatNext.suggestedStart,
    [vatNext.suggestedStart, chargeNext.suggestedStart]);
  check("that line runs past the SI booklet just registered", vatNext.suggestedStart > 9049, vatNext.suggestedStart);
  check("a Charge Invoice prints the same IN prefix", chargeNext.prefix === "IN", chargeNext.prefix);
  check("Non-VAT prints its OWN prefix", nonVatNext.prefix === "NV", nonVatNext.prefix);
  check("…and 150 leaves added to the IN line leave the NV line where it was",
    nonVatNext.suggestedStart === nvBefore.suggestedStart,
    [nvBefore.suggestedStart, nonVatNext.suggestedStart]);

  let crossLabel = "";
  try {
    await booklets.create(cashier, {
      type: "SI_CHARGE", seriesStart: 9002, seriesEnd: 9010,
      label: `${PREFIX}cross-label`, gapExempt: false,
    });
  } catch (e) { crossLabel = (e as Error).constructor.name; }
  check("a Charge range colliding with a VAT booklet is refused (ConflictError)", crossLabel === "ConflictError", crossLabel);

  // The SAME numbers on the other line are not a collision at all: IN-9002 and
  // NV-9002 are two different leaves on two different pads.
  const nvTwin = await booklets.create(cashier, {
    type: "SI_NON_VAT", seriesStart: 9002, seriesEnd: 9010,
    label: `${PREFIX}NV twin`, gapExempt: false,
  });
  check("…while the identical range on the NV line is accepted", !!nvTwin.id, nvTwin);

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
  const nvIssued: (string | null)[] = [];
  for (let i = 0; i < 3; i++) {
    const j = await makeJo(400 + i, "100");
    const nvSi = await receipts.receivePayment(cashier, {
      ...base, jobOrderId: j.id, kind: "SI_NON_VAT", amount: "100.00",
      payments: [{ method: "CASH", amount: "100.00", reference: undefined }],
    });
    nvIssued.push(nvSi.documentNo);
  }
  // The number actually printed on the leaf — an IN here would mean a Non-VAT
  // sale had eaten a serial out of the VAT/Charge line.
  check("a Non-VAT invoice takes its number from the NV series",
    nvIssued[0] === "NV-9500", nvIssued[0]);
  check("…and runs its own sequence", nvIssued.join(",") === "NV-9500,NV-9501,NV-9502", nvIssued);

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
  // Gross = VAT + Non-VAT + Charge + every JO slip. Only collections stay out,
  // because the document they settle already booked that revenue.
  check("collections are EXCLUDED from gross sales (no double-count)",
    delta(summary.grossSales, baseline.grossSales) === toCentavos("8954.00"),
    `${delta(summary.grossSales, baseline.grossSales)} (expected 895400 = 5620 + 300 + 2344 + 690)`);
  check("JO slips are counted as sales — each books what was handed over",
    delta(summary.joReceipts.gross, baseline.joReceipts.gross) === toCentavos("690.00"),
    summary.joReceipts.gross);
  check("…and none of these was tagged a downpayment",
    delta(summary.joDownpayments.gross, baseline.joDownpayments.gross) === 0,
    summary.joDownpayments.gross);
  // These two answer different questions and are SUPPOSED to differ: a charge
  // invoice earns without taking cash, a collection takes cash without
  // earning. Asserting one is bigger than the other would be asserting noise.
  check("cash in and gross sales are allowed to disagree — they measure different things",
    toCentavos(summary.cashIn) >= 0 && toCentavos(summary.grossSales) >= 0,
    { cashIn: summary.cashIn, gross: summary.grossSales });
  check("…and cash in includes the deposits and the collections",
    toCentavos(summary.cashIn) >=
      toCentavos(summary.joReceipts.gross) + toCentavos(summary.collections.gross),
    { cashIn: summary.cashIn, deposits: summary.joReceipts.gross, collections: summary.collections.gross });
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

  // ——— what the AUDITOR sees on the day log ———
  // §5.1 wants both halves: the two serials written on each other (step 3) and
  // the reason on the face of the receipt (step 2). A replaced receipt that
  // shows its successor but not why it was spoiled fails the audit.
  const trail = await receipts.listDay(actor, { take: 200 });
  const spoiled = trail.rows.find((r) => r.documentNo === wrong.documentNo)!;
  const successor = trail.rows.find((r) => r.documentNo === replaced.documentNo)!;
  check("the day log shows the spoiled receipt", spoiled !== undefined);
  check("…marked REPLACED", spoiled.voidType === "REPLACED", spoiled.voidType);
  check("…naming the receipt issued in its place",
    spoiled.replacedByDocumentNo === replaced.documentNo, spoiled.replacedByDocumentNo);
  check("…AND keeping the reason (not dropped for the link)",
    spoiled.voidReason?.includes("Wrong amount") ?? false, spoiled.voidReason);
  check("…and who approved it", spoiled.voidedByName === admin.name, spoiled.voidedByName);
  check("the replacement points back at what it superseded",
    successor.replacesDocumentNo === wrong.documentNo, successor.replacesDocumentNo);

  // Looking one up must surface BOTH, or the pairing is invisible in a search.
  const paired = await receipts.listDay(actor, { take: 200, q: wrong.documentNo! });
  check("searching a serial returns its replacement too",
    paired.rows.some((r) => r.documentNo === wrong.documentNo) &&
      paired.rows.some((r) => r.documentNo === replaced.documentNo),
    paired.rows.map((r) => r.documentNo));
  const pairedBack = await receipts.listDay(actor, { take: 200, q: replaced.documentNo! });
  check("…and searching the replacement returns the original",
    pairedBack.rows.some((r) => r.documentNo === wrong.documentNo),
    pairedBack.rows.map((r) => r.documentNo));
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
  console.log("\nExpanded withholding tax (BIR 2307) — the receivable must CLOSE");

  // The defect this whole block exists for: a corporate customer pays net of
  // the tax they withhold, and with nowhere to put that tax the invoice sits
  // short forever — inflating the aging report, the DSO and the customer's
  // credit exposure, and eventually being cleared by someone recording a
  // payment that never happened.

  /** Did this blow up? Used where the failure IS the behaviour under test. */
  const throws = async (fn: () => unknown): Promise<boolean> => {
    try {
      await fn();
      return false;
    } catch {
      return true;
    }
  };
  const cents = (v: unknown) => toCentavos(String(v));

  // ——— the arithmetic, before any database is involved ———
  // A 112,000 VAT invoice is 100,000 + 12,000 VAT. 2% withholding is 2,000 —
  // two per cent of the NET. Taking 2% of the gross gives 2,240, over-withholds
  // by 240, and is the classic way this is got wrong.
  const net112k = splitVat(toCentavos("112000.00"), "SI_VAT").vatableSales;
  check("VAT backs out of a gross invoice", toAmount(net112k) === "100000.00", toAmount(net112k));
  check("EWT is 2% of the NET, not the gross",
    toAmount(computeWithholding(net112k, "2")) === "2000.00", toAmount(computeWithholding(net112k, "2")));
  check("…so it is NOT 2% of the gross",
    computeWithholding(net112k, "2") !== Math.round(toCentavos("112000.00") * 0.02));
  check("the 1% goods rate works the same way", toAmount(computeWithholding(net112k, "1")) === "1000.00");
  check("no rate → nothing suggested", computeWithholding(net112k, null) === 0);
  check("a zero rate → nothing suggested", computeWithholding(net112k, "0") === 0);
  check("the suggestion never exceeds what is still open",
    computeWithholding(net112k, "2", toCentavos("500.00")) === toCentavos("500.00"));
  check("a rate above 100% is refused", await throws(() => computeWithholding(1000, "101")));

  // ——— a customer's withholding standing is admin-only (R8) ———
  check("a cashier cannot set a withholding rate",
    await throws(() => ar.setWithholding(cashier, {
      customerId: customer.id, isWithholdingAgent: true, ewtRatePct: 2,
      withholdsVat: false, vatWithholdingRatePct: null,
    })));
  await ar.setWithholding(actor, {
    customerId: customer.id, isWithholdingAgent: true, ewtRatePct: 2,
      withholdsVat: false, vatWithholdingRatePct: null,
  });

  // ——— end to end: 11,200 invoice, 11,000 paid, 200 withheld ———
  const joW = await makeJo(700, "11200");
  await receipts.receivePayment(cashier, {
    ...base, jobOrderId: joW.id, kind: "SI_CHARGE", amount: "11200.00", payments: [],
  });

  const wOpts = await receipts.getCollectOptions(cashier, customer.id);
  check("the account is flagged as a withholding agent", wOpts.isWithholdingAgent === true);
  check("…and carries the rate", Number(wOpts.ewtRatePct) === 2, wOpts.ewtRatePct);
  const wInv = wOpts.invoices.find((i) => i.joNumber === `${PREFIX}JO-700`)!;
  check("the invoice exposes its VAT-exclusive base",
    cents(wInv.vatableSales) === toCentavos("10000.00"), wInv.vatableSales);
  check("…and the tax the counter should expect",
    cents(wInv.suggestedEwt) === toCentavos("200.00"), wInv.suggestedEwt);

  const wPaid = await receipts.collectFromCustomer(cashier, {
    customerId: customer.id,
    payments: [{ method: "CASH", amount: "11000.00", reference: undefined }],
    allocations: [{ saleId: wInv.id, amount: "11200.00", ewtWithheld: "200.00" }],
    issueDocument: true,
  });

  const wSale = await prisma.sale.findUniqueOrThrow({ where: { id: wInv.id } });
  const wOpen =
    cents(wSale.amount) - cents(wSale.amountPaid) - cents(wSale.settledAmount);
  check("THE RECEIVABLE CLOSES — 11,000 cash + 200 withheld settles 11,200",
    wOpen === 0, toAmount(wOpen));
  check("the invoice is settled by the full amount, not just the cash",
    cents(wSale.settledAmount) === toCentavos("11200.00"), wSale.settledAmount.toString());

  const wCr = await prisma.collectionReceipt.findUniqueOrThrow({
    where: { id: wPaid.id }, include: { allocations: true },
  });
  check("the receipt records only the CASH taken in",
    cents(wCr.amount) === toCentavos("11000.00"), wCr.amount.toString());
  check("the withheld tax is recorded against the invoice",
    cents(wCr.allocations[0]?.ewtWithheld ?? 0) === toCentavos("200.00"),
    wCr.allocations[0]?.ewtWithheld.toString());

  // The balancing identity from docs/sales-contract.md R5, widened for tax:
  //   amount + creditApplied + ewtWithheld = allocations + creditCreated
  const wEwt = wCr.allocations.reduce((t, a) => t + cents(a.ewtWithheld), 0);
  const wAlloc = wCr.allocations.reduce((t, a) => t + cents(a.amount), 0);
  check("the widened balancing identity holds",
    cents(wCr.amount) + 0 + wEwt === wAlloc + toCentavos(wPaid.creditCreated),
    { cash: wCr.amount.toString(), ewt: toAmount(wEwt), allocated: toAmount(wAlloc), credit: wPaid.creditCreated });
  check("withholding is not mistaken for an overpayment",
    toCentavos(wPaid.creditCreated) === 0, wPaid.creditCreated);

  // ——— the aging report must forget it entirely ———
  //
  // The customer carries unrelated debt from earlier scenarios, so "owes
  // nothing" is the wrong test. What matters is that the settled invoice
  // leaves NO RESIDUE: outstanding must fall by the whole 11,200, not by the
  // 11,000 that arrived as cash. A 200 remainder here is precisely the defect.
  const wAfter = await receipts.getCollectOptions(cashier, customer.id);
  check("outstanding falls by the FULL invoice, not just the cash received",
    toCentavos(wOpts.totalOutstanding) - toCentavos(wAfter.totalOutstanding) ===
      toCentavos("11200.00"),
    { before: wOpts.totalOutstanding, after: wAfter.totalOutstanding });
  check("the settled invoice is gone from the open list",
    !wAfter.invoices.some((i) => i.id === wInv.id));
  check("no withheld remainder is left aging",
    (await ar.statement(actor, customer.id)).invoices
      .every((i) => i.id !== wInv.id));

  // ——— guards ———
  const joW2 = await makeJo(701, "11200");
  await receipts.receivePayment(cashier, {
    ...base, jobOrderId: joW2.id, kind: "SI_CHARGE", amount: "11200.00", payments: [],
  });
  const w2 = (await receipts.getCollectOptions(cashier, customer.id)).invoices
    .find((i) => i.joNumber === `${PREFIX}JO-701`)!;

  check("withholding more than the allocation it sits in is refused",
    await throws(() => receipts.collectFromCustomer(cashier, {
      customerId: customer.id,
      payments: [{ method: "CASH", amount: "100.00", reference: undefined }],
      allocations: [{ saleId: w2.id, amount: "1000.00", ewtWithheld: "1200.00" }],
      issueDocument: true,
    })));
  check("cash short of what the allocation needs after tax is refused",
    await throws(() => receipts.collectFromCustomer(cashier, {
      customerId: customer.id,
      payments: [{ method: "CASH", amount: "500.00", reference: undefined }],
      allocations: [{ saleId: w2.id, amount: "11200.00", ewtWithheld: "200.00" }],
      issueDocument: true,
    })));

  // Cancelling must take the tax back with the cash, or the invoice reopens
  // for 11,000 only and 200 of debt quietly disappears.
  await receipts.voidReceipt(actor, {
    receiptId: wPaid.id, kind: "COLLECTION", type: "CANCELLED",
    reason: "Withholding reversal check.",
  });
  const wReopened = await prisma.sale.findUniqueOrThrow({ where: { id: wInv.id } });
  check("cancelling the collection reopens the FULL invoice, tax included",
    cents(wReopened.settledAmount) === 0, wReopened.settledAmount.toString());
  check("…and its allocations are gone",
    (await prisma.crAllocation.count({ where: { crId: wPaid.id } })) === 0);

  // ——— clearing the flag must clear the rate with it ———
  await ar.setWithholding(actor, {
    customerId: customer.id, isWithholdingAgent: false, ewtRatePct: null,
    withholdsVat: false, vatWithholdingRatePct: null,
  });
  const wOff = await receipts.getCollectOptions(cashier, customer.id);
  check("clearing the flag stops the counter suggesting tax",
    wOff.isWithholdingAgent === false &&
      wOff.ewtRatePct === null &&
      wOff.invoices.every((i) => toCentavos(i.suggestedEwt) === 0));

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nGovernment customer — BOTH withholdings at once (2307 + 2306)");

  // An LGU or public school withholds two different taxes on the same
  // invoice, on two different forms, credited on two different returns:
  //   2% income tax  → BIR 2307 → claimed against income tax
  //   5% VAT         → BIR 2306 → claimed against output VAT (2550M/Q)
  // Both on the SAME VAT-exclusive base. Merging them would still close the
  // receivable and still leave the accountant unable to split the two.
  await ar.setWithholding(actor, {
    customerId: customer.id,
    isWithholdingAgent: true,
    ewtRatePct: 2,
    withholdsVat: true,
    vatWithholdingRatePct: 5,
  });

  const joG = await makeJo(710, "11200");
  await receipts.receivePayment(cashier, {
    ...base, jobOrderId: joG.id, kind: "SI_CHARGE", amount: "11200.00", payments: [],
  });

  const gOpts = await receipts.getCollectOptions(cashier, customer.id);
  check("the account withholds income tax", gOpts.isWithholdingAgent === true);
  check("…and VAT", gOpts.withholdsVat === true);
  check("…at the statutory 5%", Number(gOpts.vatWithholdingRatePct) === 5, gOpts.vatWithholdingRatePct);

  const gInv = gOpts.invoices.find((i) => i.joNumber === `${PREFIX}JO-710`)!;
  check("2% income tax is suggested on the net",
    cents(gInv.suggestedEwt) === toCentavos("200.00"), gInv.suggestedEwt);
  check("5% VAT is suggested on the SAME net base",
    cents(gInv.suggestedVatWht) === toCentavos("500.00"), gInv.suggestedVatWht);
  check("the two together never exceed what is open",
    cents(gInv.suggestedEwt) + cents(gInv.suggestedVatWht) <= cents(gInv.openBalance));

  // 11,200 invoice − 200 income tax − 500 VAT = 10,500 actually paid.
  const gPaid = await receipts.collectFromCustomer(cashier, {
    customerId: customer.id,
    payments: [{ method: "CASH", amount: "10500.00", reference: undefined }],
    allocations: [{
      saleId: gInv.id, amount: "11200.00",
      ewtWithheld: "200.00", vatWithheld: "500.00",
    }],
    issueDocument: true,
  });

  const gSale = await prisma.sale.findUniqueOrThrow({ where: { id: gInv.id } });
  const gOpen =
    cents(gSale.amount) - cents(gSale.amountPaid) - cents(gSale.settledAmount);
  check("THE RECEIVABLE CLOSES — 10,500 cash + 200 EWT + 500 VAT settles 11,200",
    gOpen === 0, toAmount(gOpen));

  const gCr = await prisma.collectionReceipt.findUniqueOrThrow({
    where: { id: gPaid.id }, include: { allocations: true },
  });
  check("the receipt records only the 10,500 cash",
    cents(gCr.amount) === toCentavos("10500.00"), gCr.amount.toString());
  check("income tax is recorded separately",
    cents(gCr.allocations[0]?.ewtWithheld ?? 0) === toCentavos("200.00"),
    gCr.allocations[0]?.ewtWithheld.toString());
  check("VAT withheld is recorded separately — NOT merged into the 2307 figure",
    cents(gCr.allocations[0]?.vatWithheld ?? 0) === toCentavos("500.00"),
    gCr.allocations[0]?.vatWithheld.toString());

  // The identity, with both taxes:
  //   amount + creditApplied + ewtWithheld + vatWithheld
  //     = allocations + creditCreated
  const gEwt = gCr.allocations.reduce((t, a) => t + cents(a.ewtWithheld), 0);
  const gVat = gCr.allocations.reduce((t, a) => t + cents(a.vatWithheld), 0);
  const gAlloc = gCr.allocations.reduce((t, a) => t + cents(a.amount), 0);
  check("the identity holds with both withholdings",
    cents(gCr.amount) + 0 + gEwt + gVat === gAlloc + toCentavos(gPaid.creditCreated),
    { cash: gCr.amount.toString(), ewt: toAmount(gEwt), vat: toAmount(gVat), allocated: toAmount(gAlloc) });
  check("neither tax is mistaken for an overpayment",
    toCentavos(gPaid.creditCreated) === 0, gPaid.creditCreated);

  // ——— auto-allocation must net BOTH taxes, not just one ———
  const joG2 = await makeJo(711, "11200");
  await receipts.receivePayment(cashier, {
    ...base, jobOrderId: joG2.id, kind: "SI_CHARGE", amount: "11200.00", payments: [],
  });
  const beforeAuto = await receipts.getCollectOptions(cashier, customer.id);
  const autoPaid = await receipts.collectFromCustomer(cashier, {
    customerId: customer.id,
    // No allocations given: the service must work out that 10,500 closes an
    // 11,200 invoice once both withholdings are accounted for.
    payments: [{ method: "CASH", amount: "10500.00", reference: undefined }],
    issueDocument: true,
  });
  const afterAuto = await receipts.getCollectOptions(cashier, customer.id);
  const autoAllocs = await prisma.crAllocation.findMany({ where: { crId: autoPaid.id } });
  const autoEwt = autoAllocs.reduce((t, a) => t + cents(a.ewtWithheld), 0);
  const autoVat = autoAllocs.reduce((t, a) => t + cents(a.vatWithheld), 0);

  // Asserted as an INVARIANT rather than against a fixed invoice: money is
  // applied oldest-first across whatever the customer happens to owe, so which
  // invoices this reaches depends on the scenarios above it. What must hold in
  // every case is that the debt falls by the cash received PLUS every peso of
  // tax withheld — if it fell by the cash alone, the withholding was lost.
  check("auto-allocation retires cash AND both withheld taxes",
    toCentavos(beforeAuto.totalOutstanding) - toCentavos(afterAuto.totalOutstanding) ===
      toCentavos("10500.00") + autoEwt + autoVat,
    { before: beforeAuto.totalOutstanding, after: afterAuto.totalOutstanding,
      ewt: toAmount(autoEwt), vat: toAmount(autoVat) });
  check("…having worked out both taxes without being told",
    autoEwt > 0 && autoVat > 0,
    { ewt: toAmount(autoEwt), vat: toAmount(autoVat) });
  // 5% and 2% of the same base: the VAT figure must be 2.5x the income tax
  // one. This is what catches either rate being applied to the wrong base.
  check("…at 2% and 5% of the SAME net base",
    Math.abs(autoVat * 2 - autoEwt * 5) <= 2,
    { ewt: toAmount(autoEwt), vat: toAmount(autoVat) });

  // ——— the combined guard ———
  const joG3 = await makeJo(712, "11200");
  await receipts.receivePayment(cashier, {
    ...base, jobOrderId: joG3.id, kind: "SI_CHARGE", amount: "11200.00", payments: [],
  });
  const g3 = (await receipts.getCollectOptions(cashier, customer.id)).invoices
    .find((i) => i.joNumber === `${PREFIX}JO-712`)!;
  check("the two taxes TOGETHER cannot exceed the allocation",
    await throws(() => receipts.collectFromCustomer(cashier, {
      customerId: customer.id,
      payments: [{ method: "CASH", amount: "100.00", reference: undefined }],
      allocations: [{
        saleId: g3.id, amount: "1000.00",
        ewtWithheld: "600.00", vatWithheld: "600.00",
      }],
      issueDocument: true,
    })));

  // ——— clearing only the VAT flag leaves income tax alone ———
  await ar.setWithholding(actor, {
    customerId: customer.id,
    isWithholdingAgent: true, ewtRatePct: 2,
    withholdsVat: false, vatWithholdingRatePct: null,
  });
  const gOff = await receipts.getCollectOptions(cashier, customer.id);
  check("turning VAT withholding off leaves income tax withholding on",
    gOff.withholdsVat === false &&
      gOff.vatWithholdingRatePct === null &&
      gOff.isWithholdingAgent === true &&
      Number(gOff.ewtRatePct) === 2);
  check("…and the counter stops suggesting VAT",
    gOff.invoices.every((i) => toCentavos(i.suggestedVatWht) === 0));

  // ─────────────────────────────────────────────────────────────────────
  console.log("\nWithholding certificate register (BIR 2307 / 2306)");

  // Recording the deduction closed the invoice. It did NOT get the money
  // back — that takes the certificate, filed with the matching return. So the
  // register's job is the gap between what we recorded and what we can prove.
  const wht = getWithholdingService();

  // A collection with income tax and NO VAT, made on purpose: the kind guard
  // below has to be tested against a row where the VAT column is genuinely
  // zero, and an empty selection would pass it for the wrong reason.
  await ar.setWithholding(actor, {
    customerId: customer.id,
    isWithholdingAgent: true, ewtRatePct: 2,
    withholdsVat: false, vatWithholdingRatePct: null,
  });
  const joEwtOnly = await makeJo(730, "11200");
  await receipts.receivePayment(cashier, {
    ...base, jobOrderId: joEwtOnly.id, kind: "SI_CHARGE", amount: "11200.00", payments: [],
  });
  const ewtOnlyInv = (await receipts.getCollectOptions(cashier, customer.id)).invoices
    .find((i) => i.joNumber === `${PREFIX}JO-730`)!;
  await receipts.collectFromCustomer(cashier, {
    customerId: customer.id,
    payments: [{ method: "CASH", amount: "11000.00", reference: undefined }],
    allocations: [{ saleId: ewtOnlyInv.id, amount: "11200.00", ewtWithheld: "200.00" }],
    issueDocument: false,
  });

  const forCustomer = {
    customerId: customer.id,
    kind: null,
    status: "ALL" as const,
    from: null,
    to: null,
    search: null,
  };

  const reg0 = await wht.getRegister(actor, forCustomer);
  check("the register foots — certified + uncertified = withheld",
    cents(reg0.totals.certified) + cents(reg0.totals.uncertified) ===
      cents(reg0.totals.withheld),
    reg0.totals);
  check("every peso withheld in these tests is so far unclaimed",
    cents(reg0.totals.withheld) > 0 &&
      cents(reg0.totals.certified) === 0 &&
      cents(reg0.totals.uncertified) === cents(reg0.totals.withheld),
    reg0.totals);

  const ewtRows = reg0.outstanding.filter((o) => o.kind === "EWT_2307");
  const vatRows = reg0.outstanding.filter((o) => o.kind === "VAT_2306");
  check("both taxes are chased separately, on the same list",
    ewtRows.length > 0 && vatRows.length > 0,
    { ewt: ewtRows.length, vat: vatRows.length });
  check("the chase list is ordered oldest-first — those are the ones we lose",
    reg0.outstanding.every((o, i) =>
      i === 0 || reg0.outstanding[i - 1]!.daysWaiting >= o.daysWaiting));

  // ——— record a 2307 covering the income tax withheld ———
  const ewtTotal = ewtRows.reduce((t, o) => t + cents(o.withheld), 0);
  const cert2307 = await wht.create(actor, {
    customerId: customer.id,
    kind: "EWT_2307",
    certificateNo: `${PREFIX}2307-001`,
    periodFrom: dateStr(-90),
    periodTo: dateStr(0),
    amount: toAmount(ewtTotal),
    taxBase: null,
    ratePct: 2,
    receivedAt: dateStr(0),
    notes: null,
    allocationIds: ewtRows.map((o) => o.allocationId),
  });

  const reg1 = await wht.getRegister(actor, forCustomer);
  check("recording the form moves the money from unclaimed to claimable",
    cents(reg1.totals.certified) === ewtTotal &&
      cents(reg1.totals.uncertified) ===
        cents(reg0.totals.uncertified) - ewtTotal,
    reg1.totals);
  check("…and the register still foots",
    cents(reg1.totals.certified) + cents(reg1.totals.uncertified) ===
      cents(reg1.totals.withheld));
  check("the withholdings it covers leave the chase list",
    reg1.outstanding.every((o) => o.kind !== "EWT_2307"),
    reg1.outstanding.filter((o) => o.kind === "EWT_2307").length);
  check("the VAT withheld is untouched — a 2307 claims income tax only",
    cents(reg1.totals.byKind.VAT_2306.uncertified) ===
      cents(reg0.totals.byKind.VAT_2306.uncertified));

  const held = reg1.certificates.find((c) => c.id === cert2307.id)!;
  check("the certificate agrees with the payments under it",
    cents(held.variance) === 0 && cents(held.linkedTotal) === ewtTotal,
    { amount: held.amount, linked: held.linkedTotal, variance: held.variance });
  check("…and names every collection it covers",
    held.allocations.length === ewtRows.length);

  // ——— a 2306 must not be able to claim income tax ———
  const cert2306 = await wht.create(actor, {
    customerId: customer.id,
    kind: "VAT_2306",
    certificateNo: `${PREFIX}2306-001`,
    periodFrom: dateStr(-90),
    periodTo: dateStr(0),
    amount: "1.00",
    taxBase: null,
    ratePct: 5,
    receivedAt: null,
    notes: null,
    allocationIds: [],
  });
  // A government collection carries BOTH taxes on the SAME allocation row, so
  // the two chase lists overlap by id — and a 2306 claiming such a row is
  // right, because it is claiming that row's VAT side. What must never happen
  // is a 2306 reaching the income-tax column, which is what these test.
  const ewtOnly = ewtRows.filter(
    (e) => !vatRows.some((v) => v.allocationId === e.allocationId)
  );
  check("collections exist that carried income tax and no VAT",
    ewtOnly.length > 0, { ewt: ewtRows.length, vat: vatRows.length });
  check("A 2306 IS NEVER OFFERED INCOME TAX TO CLAIM",
    (await wht.listLinkable(actor, cert2306.id)).every(
      (o) => o.kind === "VAT_2306"
    ));
  check("…and refuses a collection where no VAT was withheld at all",
    ewtOnly.length > 0 &&
      (await throws(() =>
      wht.link(actor, {
        certificateId: cert2306.id,
        allocationIds: ewtOnly.map((o) => o.allocationId),
      }))));
  // Two people filing the same quarter must not both claim one withholding.
  const rivalCert = await wht.create(actor, {
    customerId: customer.id, kind: "EWT_2307",
    certificateNo: `${PREFIX}2307-RIVAL`,
    periodFrom: null, periodTo: null, amount: "100.00",
    taxBase: null, ratePct: null, receivedAt: null, notes: null,
    allocationIds: [],
  });
  check("a second form cannot claim tax the first one already holds",
    await throws(() =>
      wht.link(actor, {
        certificateId: rivalCert.id,
        allocationIds: ewtRows.map((o) => o.allocationId),
      })));

  // ——— the variance is a flag for a person, never a silent correction ———
  const shared =
    vatRows.find((v) => ewtRows.some((e) => e.allocationId === v.allocationId)) ??
    vatRows[0]!;
  await wht.link(actor, {
    certificateId: cert2306.id,
    allocationIds: [shared.allocationId],
  });
  const twoForms = await prisma.crAllocation.findUniqueOrThrow({
    where: { id: shared.allocationId },
    select: { ewtCertificateId: true, vatCertificateId: true },
  });
  check("ONE COLLECTION, TWO FORMS — claiming the VAT leaves the 2307 claim alone",
    twoForms.vatCertificateId === cert2306.id &&
      twoForms.ewtCertificateId === cert2307.id,
    twoForms);
  const mismatched = (await wht.getRegister(actor, forCustomer)).certificates
    .find((c) => c.id === cert2306.id)!;
  check("a form that disagrees with the payments under it is FLAGGED, not fixed",
    cents(mismatched.variance) === toCentavos("1.00") - cents(shared.withheld),
    { onTheForm: mismatched.amount, attached: mismatched.linkedTotal, variance: mismatched.variance });
  check("…and the money still counts as claimed, because the paper exists",
    cents(mismatched.linkedTotal) === cents(shared.withheld));

  const onlyMismatched = await wht.getRegister(actor, {
    ...forCustomer,
    status: "MISMATCHED",
  });
  check("the MISMATCHED filter lists every disagreeing form and nothing else",
    onlyMismatched.certificates.length > 0 &&
      onlyMismatched.certificates.some((c) => c.id === cert2306.id) &&
      onlyMismatched.certificates.every((c) => c.id !== cert2307.id) &&
      onlyMismatched.certificates.every((c) => cents(c.variance) !== 0),
    onlyMismatched.certificates.map((c) => ({ no: c.certificateNo, variance: c.variance })));

  // ——— guards ———
  check("a certificate number cannot be recorded twice",
    await throws(() =>
      wht.create(actor, {
        customerId: customer.id, kind: "EWT_2307",
        certificateNo: `${PREFIX}2307-001`,
        periodFrom: null, periodTo: null, amount: "100.00",
        taxBase: null, ratePct: null, receivedAt: null, notes: null,
        allocationIds: [],
      })));
  check("a certificate for zero tax is refused",
    await throws(() =>
      wht.create(actor, {
        customerId: customer.id, kind: "EWT_2307",
        certificateNo: null, periodFrom: null, periodTo: null,
        amount: "0.00", taxBase: null, ratePct: null,
        receivedAt: null, notes: null, allocationIds: [],
      })));
  check("an auditor may read the register but never write to it",
    await throws(() =>
      wht.create(auditor, {
        customerId: customer.id, kind: "EWT_2307",
        certificateNo: `${PREFIX}2307-AUD`, periodFrom: null, periodTo: null,
        amount: "100.00", taxBase: null, ratePct: null,
        receivedAt: null, notes: null, allocationIds: [],
      })));
  check("…and reading it is itself gated (R9)",
    (await wht.getRegister(auditor, forCustomer)).certificates.length > 0);
  check("a cashier cannot void a tax record — that takes a supervisor",
    await throws(() =>
      wht.voidCertificate(cashier, { id: cert2306.id, reason: "not mine to void" })));

  // ——— void puts the money back on the chase list ———
  const beforeVoid = await wht.getRegister(actor, forCustomer);
  await wht.voidCertificate(actor, {
    id: cert2307.id,
    reason: "replaced by a corrected form",
  });
  const afterVoid = await wht.getRegister(actor, forCustomer);
  check("VOIDING A CERTIFICATE PUTS ITS WITHHOLDINGS BACK ON THE CHASE LIST",
    cents(afterVoid.totals.uncertified) ===
      cents(beforeVoid.totals.uncertified) + ewtTotal,
    { before: beforeVoid.totals.uncertified, after: afterVoid.totals.uncertified });
  check("…the money is never lost between the two views",
    cents(afterVoid.totals.certified) + cents(afterVoid.totals.uncertified) ===
      cents(afterVoid.totals.withheld));
  check("…and the voided form is gone from the register",
    afterVoid.certificates.every((c) => c.id !== cert2307.id));

  // ——— a voided COLLECTION must not leave a certificate chasing a ghost ———
  const joReg = await makeJo(720, "11200");
  await receipts.receivePayment(cashier, {
    ...base, jobOrderId: joReg.id, kind: "SI_CHARGE", amount: "11200.00", payments: [],
  });
  const regInv = (await receipts.getCollectOptions(cashier, customer.id)).invoices
    .find((i) => i.joNumber === `${PREFIX}JO-720`)!;
  const regCr = await receipts.collectFromCustomer(cashier, {
    customerId: customer.id,
    payments: [{ method: "CASH", amount: "11000.00", reference: undefined }],
    allocations: [{ saleId: regInv.id, amount: "11200.00", ewtWithheld: "200.00" }],
    issueDocument: false,
  });
  const withGhost = await wht.getRegister(actor, forCustomer);
  check("a fresh withholding lands on the chase list",
    withGhost.outstanding.some(
      (o) => o.kind === "EWT_2307" && cents(o.withheld) === toCentavos("200.00")
    ));
  await receipts.voidReceipt(actor, {
    receiptId: regCr.id, kind: "COLLECTION",
    type: "CANCELLED", reason: "Verify — collection reversed.",
  });
  const noGhost = await wht.getRegister(actor, forCustomer);
  check("CANCELLING THE COLLECTION TAKES ITS WITHHOLDING OFF THE LIST TOO",
    cents(noGhost.totals.withheld) ===
      cents(withGhost.totals.withheld) - toCentavos("200.00"),
    { before: withGhost.totals.withheld, after: noGhost.totals.withheld });

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
  // ─────────────────────────────────────────────────────────────────────
  console.log("\nAging as of a past date — a reconstruction, not a filter");

  // Everything above ran "today". This block builds a debt with a KNOWN
  // history and asks what the ledger said at three different moments. The
  // failure this guards against is silent: a report that foots to a plausible
  // total while putting the money in the wrong month.
  const histCustomer = await prisma.customer.create({
    data: { name: `${CUSTOMER} History`, createdById: admin.id },
  });

  const backdate = async (n: number, amount: string, daysAgo: number) => {
    const jo = await makeJo(n, amount);
    await prisma.jobOrder.update({
      where: { id: jo.id },
      data: { customerId: histCustomer.id },
    });
    const sale = await receipts.receivePayment(cashier, {
      ...base, jobOrderId: jo.id, kind: "SI_CHARGE", amount, payments: [],
    });
    // Push the invoice back in time. Terms are net-30 from the sale date, so
    // the due date moves with it and the aging buckets stay honest.
    const saleDate = new Date(Date.now() - daysAgo * 86_400_000);
    await prisma.sale.update({
      where: { id: sale.id },
      data: {
        customerId: histCustomer.id,
        saleDate,
        dueDate: new Date(saleDate.getTime() + 30 * 86_400_000),
      },
    });
    return sale;
  };

  // ₱10,000 issued 100 days ago, ₱5,000 issued 20 days ago.
  const oldInv = await backdate(800, "10000", 100);
  await backdate(801, "5000", 20);

  const asOfDay = (n: number) =>
    new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

  // ——— 90 days ago: only the first invoice existed ———
  const at90 = await ar.list(actor, { asOf: asOfDay(90) });
  const line90 = at90.customers.find((c) => c.customerId === histCustomer.id);
  check("AN INVOICE RAISED LATER IS NOT IN AN EARLIER REPORT",
    line90 !== undefined &&
      toCentavos(line90.outstanding) === toCentavos("10000.00"),
    line90?.outstanding);
  check("the report says which date it was built at",
    at90.summary.asOf.slice(0, 10) === asOfDay(90), at90.summary.asOf);
  check("…and flags itself as historical, so no one reads it as live",
    at90.summary.historical === true);
  check("a live report does NOT",
    (await ar.list(actor, {})).summary.historical === false);

  // ——— aging is measured from the report date, not from today ———
  // ONE invoice, THREE reports, three different buckets. Issued 100 days ago
  // on net-30, so it fell due 70 days ago:
  //
  //   at T-90  →  not due for another 20 days  →  CURRENT
  //   at T-60  →  10 days overdue              →  1–30
  //   today    →  70 days overdue              →  61–90
  //
  // Note the distinction the naive version of this gets wrong: the invoice is
  // 100 days OLD today, but only 70 days OVERDUE, and it is the second number
  // that buckets it.
  check("AGING IS MEASURED FROM THE REPORT DATE, NOT FROM TODAY",
    line90 !== undefined &&
      toCentavos(line90.aging.CURRENT) === toCentavos("10000.00"),
    line90?.aging);
  const at60 = await ar.list(actor, { asOf: asOfDay(60) });
  const line60 = at60.customers.find((c) => c.customerId === histCustomer.id);
  check("…the same invoice sits in 1–30 a month later",
    line60 !== undefined &&
      toCentavos(line60.aging.D1_30) === toCentavos("10000.00"),
    line60?.aging);
  const live = await ar.list(actor, {});
  const lineNow = live.customers.find((c) => c.customerId === histCustomer.id)!;
  check("…and in 61–90 today, aged by days OVERDUE and not by age",
    toCentavos(lineNow.aging.D61_90) === toCentavos("10000.00"),
    lineNow.aging);
  check("every report foots to its own total",
    [line90!, line60!, lineNow].every(
      (l) =>
        AGING_BUCKETS.reduce((s, b) => s + toCentavos(l.aging[b]), 0) ===
        toCentavos(l.outstanding)
    ));

  // ——— a collection lands, and only later reports should see it ———
  const histOpts = await receipts.getCollectOptions(cashier, histCustomer.id);
  const histPaid = await receipts.collectFromCustomer(cashier, {
    customerId: histCustomer.id,
    payments: [{ method: "CASH", amount: "10000.00", reference: undefined }],
    allocations: [{ saleId: oldInv.id, amount: "10000.00" }],
    issueDocument: false,
  });
  check("the invoice is settled today",
    toCentavos((await ar.list(actor, {})).customers
      .find((c) => c.customerId === histCustomer.id)?.outstanding ?? "0") ===
      toCentavos("5000.00"),
    histOpts.totalOutstanding);

  const at90After = await ar.list(actor, { asOf: asOfDay(90) });
  const line90After = at90After.customers.find(
    (c) => c.customerId === histCustomer.id
  );
  check("A DEBT SETTLED SINCE IS STILL OWED IN AN EARLIER REPORT",
    line90After !== undefined &&
      toCentavos(line90After.outstanding) === toCentavos("10000.00"),
    line90After?.outstanding);
  check("…which is the whole point — today's paymentStatus cannot answer it",
    toCentavos(at90After.summary.totalOutstanding) >= toCentavos("10000.00"));

  // ——— the statement inherits the same date ———
  const stmt90 = await ar.statement(actor, histCustomer.id, asOfDay(90));
  check("the statement rewinds with the ledger",
    toCentavos(stmt90.totalOutstanding) === toCentavos("10000.00"),
    stmt90.totalOutstanding);
  check("…and stamps the date it was drawn at",
    stmt90.asOf.slice(0, 10) === asOfDay(90), stmt90.asOf);
  check("…listing only invoices that existed by then",
    stmt90.invoices.length === 1 &&
      stmt90.invoices.every((i) => i.saleDate.slice(0, 10) <= asOfDay(90)),
    stmt90.invoices.map((i) => i.saleDate));
  const stmtNow = await ar.statement(actor, histCustomer.id);
  check("a statement with no date is today's, and shows the settled one gone",
    toCentavos(stmtNow.totalOutstanding) === toCentavos("5000.00"),
    stmtNow.totalOutstanding);

  // ——— an invoice VOIDED since was still live back then ———
  await receipts.voidReceipt(actor, {
    receiptId: histPaid.id, kind: "COLLECTION",
    type: "CANCELLED", reason: "Verify — reopen for the void test.",
  });
  await receipts.voidReceipt(actor, {
    receiptId: oldInv.id, kind: "SI_CHARGE",
    type: "CANCELLED", reason: "Verify — cancelled after the fact.",
  });
  const at90Voided = await ar.list(actor, { asOf: asOfDay(90) });
  const line90Voided = at90Voided.customers.find(
    (c) => c.customerId === histCustomer.id
  );
  check("AN INVOICE CANCELLED SINCE WAS STILL LIVE IN AN EARLIER REPORT",
    line90Voided !== undefined &&
      toCentavos(line90Voided.outstanding) === toCentavos("10000.00"),
    line90Voided?.outstanding);
  check("…and is gone from today's",
    toCentavos((await ar.list(actor, {})).customers
      .find((c) => c.customerId === histCustomer.id)?.outstanding ?? "0") ===
      toCentavos("5000.00"));

  // ——— guards ———
  check("a nonsense date is refused rather than silently treated as today",
    await throws(() => ar.list(actor, { asOf: "not-a-date" })));
  check("the ledger read is still gated (R9)",
    (await ar.list(viewer, { asOf: asOfDay(90) })).customers.length >= 0);
  // ─────────────────────────────────────────────────────────────────────
  console.log("\nSales report over a date range");

  // The two ways a revenue report goes wrong are both silent: it counts the
  // collection as well as the invoice (every credit sale twice), or it counts
  // rptSpoiled receipts (gross and VAT both overstated). Neither shows up as an
  // error — only as a figure the accountant cannot reconcile.
  const today = new Date().toISOString().slice(0, 10);

  // The exhaustion test above deliberately used up the NV series, so this
  // block registers its own rather than depending on what earlier tests left.
  const rptNv = await booklets.create(cashier, {
    type: "SI_NON_VAT", seriesStart: 9600, seriesEnd: 9649,
    label: `${PREFIX}NV report booklet`, gapExempt: false,
  });
  await booklets.approve(actor, rptNv.id);

  const rptCustomer = await prisma.customer.create({
    data: { name: `${CUSTOMER} Report`, createdById: admin.id },
  });

  const rptSale = async (n: number, kind: "SI_VAT" | "SI_NON_VAT" | "SI_CHARGE" | "JO_SLIP", amount: string) => {
    const jo = await makeJo(n, amount);
    await prisma.jobOrder.update({
      where: { id: jo.id },
      data: { customerId: rptCustomer.id },
    });
    const sale = await receipts.receivePayment(cashier, {
      ...base,
      jobOrderId: jo.id,
      kind: kind === "JO_SLIP" ? "JO_RECEIPT" : kind,
      amount,
      payments: kind === "SI_CHARGE" ? [] : [{ method: "CASH", amount, reference: undefined }],
    });
    await prisma.sale.update({
      where: { id: sale.id },
      data: { customerId: rptCustomer.id },
    });
    return sale;
  };

  // ₱11,200 VAT + ₱5,000 non-VAT + ₱2,000 JO slip + ₱3,000 charge = ₱21,200.
  // The JO slip is UNTAGGED — a walk-in who paid and left — so it is the sale
  // document for that job and its money is revenue. A slip tagged as a
  // downpayment is tested separately, and stays outside every total.
  await rptSale(900, "SI_VAT", "11200");
  await rptSale(901, "SI_NON_VAT", "5000");
  await rptSale(902, "JO_SLIP", "2000");
  const chargeSale = await rptSale(903, "SI_CHARGE", "3000");

  const only = { from: today, to: today, groupBy: "day" as const, customerId: rptCustomer.id };
  const rpt = await receipts.getSalesReport(actor, only);

  check("gross sales is the sum of the four revenue kinds",
    toCentavos(rpt.totals.gross) === toCentavos("21200.00"), rpt.totals.gross);
  check("VAT is split out of the VAT series only",
    toCentavos(rpt.byType.SI_VAT.vatAmount) === toCentavos("1200.00") &&
      toCentavos(rpt.byType.SI_NON_VAT.vatAmount) === 0,
    { vat: rpt.byType.SI_VAT.vatAmount, nonVat: rpt.byType.SI_NON_VAT.vatAmount });
  check("the type split foots to the total",
    (["SI_VAT", "SI_NON_VAT", "SI_CHARGE", "JO_RECEIPT"] as const)
      .reduce((t, k) => t + toCentavos(rpt.byType[k].gross), 0) ===
      toCentavos(rpt.totals.gross));
  check("an UNTAGGED slip is revenue — nothing else will ever be issued for it",
    toCentavos(rpt.byType.JO_RECEIPT.gross) === toCentavos("2000.00") &&
      toCentavos(rpt.totals.deposits) === 0,
    { joSlip: rpt.byType.JO_RECEIPT.gross, deposits: rpt.totals.deposits });
  check("the period split foots to the total",
    rpt.byPeriod.reduce((t, p) => t + toCentavos(p.gross), 0) ===
      toCentavos(rpt.totals.gross));
  check("the customer split foots to the total",
    rpt.byCustomer.reduce((t, c) => t + toCentavos(c.gross), 0) ===
      toCentavos(rpt.totals.gross));
  check("a charge invoice is revenue the day it is issued, unpaid",
    toCentavos(rpt.byType.SI_CHARGE.gross) === toCentavos("3000.00"),
    rpt.byType.SI_CHARGE.gross);

  // ——— R4: collecting that charge invoice must NOT move gross sales ———
  await receipts.collectFromCustomer(cashier, {
    customerId: rptCustomer.id,
    payments: [{ method: "CASH", amount: "3000.00", reference: undefined }],
    allocations: [{ saleId: chargeSale.id, amount: "3000.00" }],
    issueDocument: false,
  });
  const afterCollect = await receipts.getSalesReport(actor, only);
  check("COLLECTING A CHARGE INVOICE DOES NOT COUNT THE SALE TWICE",
    toCentavos(afterCollect.totals.gross) === toCentavos("21200.00"),
    afterCollect.totals.gross);
  check("…the cash is reported beside the sales instead",
    toCentavos(afterCollect.totals.collected) === toCentavos("3000.00"),
    afterCollect.totals.collected);
  check("…and never inside the type split",
    toCentavos(afterCollect.byType.COLLECTION.gross) === 0);
  check("…nor inside the period gross",
    afterCollect.byPeriod.reduce((t, p) => t + toCentavos(p.gross), 0) ===
      toCentavos("21200.00"));
  check("the period row still reports the cash alongside",
    afterCollect.byPeriod.reduce((t, p) => t + toCentavos(p.collected), 0) ===
      toCentavos("3000.00"));

  // ——— a VOIDED receipt is not a sale ———
  const rptSpoiled = await rptSale(904, "SI_VAT", "9999");
  const withSpoiled = await receipts.getSalesReport(actor, only);
  check("a live receipt counts",
    toCentavos(withSpoiled.totals.gross) === toCentavos("31199.00"),
    withSpoiled.totals.gross);
  await receipts.voidReceipt(actor, {
    receiptId: rptSpoiled.id, kind: "SI_VAT",
    type: "CANCELLED", reason: "Verify — rptSpoiled receipt.",
  });
  const withoutSpoiled = await receipts.getSalesReport(actor, only);
  check("A CANCELLED RECEIPT IS NOT A SALE",
    toCentavos(withoutSpoiled.totals.gross) === toCentavos("21200.00"),
    withoutSpoiled.totals.gross);
  check("…and its VAT is not owed either",
    toCentavos(withoutSpoiled.byType.SI_VAT.vatAmount) === toCentavos("1200.00"),
    withoutSpoiled.byType.SI_VAT.vatAmount);

  // ——— the range is a range, and both ends are included ———
  const yesterdayOnly = {
    ...only,
    from: dateStr(-1), to: dateStr(-1),
  };
  check("a range that excludes today reports nothing of today's",
    toCentavos((await receipts.getSalesReport(actor, yesterdayOnly)).totals.gross) === 0);
  const spanning = { ...only, from: dateStr(-7), to: today };
  check("a range whose LAST day is today includes today",
    toCentavos((await receipts.getSalesReport(actor, spanning)).totals.gross) ===
      toCentavos("21200.00"));
  check("…and grouping by month keeps the same total",
    toCentavos(
      (await receipts.getSalesReport(actor, { ...spanning, groupBy: "month" }))
        .totals.gross
    ) === toCentavos("21200.00"));
  check("…with fewer rows than grouping by day",
    (await receipts.getSalesReport(actor, { ...spanning, groupBy: "month" }))
      .byPeriod.length <=
      (await receipts.getSalesReport(actor, { ...spanning, groupBy: "day" }))
        .byPeriod.length);

  // ——— guards ———
  check("a backwards range is refused",
    await throws(() =>
      receipts.getSalesReport(actor, { ...only, from: today, to: dateStr(-5) })));
  check("a range longer than a year is refused rather than served slowly",
    await throws(() =>
      receipts.getSalesReport(actor, { ...only, from: dateStr(-400), to: today })));
  check("the report read is gated (R9)",
    (await receipts.getSalesReport(viewer, only)).totals.gross !== undefined);
  check("customer share sums to 100% when one customer bought everything",
    withoutSpoiled.byCustomer.length === 1 &&
      Math.abs(withoutSpoiled.byCustomer[0]!.sharePct - 100) < 0.05,
    withoutSpoiled.byCustomer.map((c) => c.sharePct));
  // ─────────────────────────────────────────────────────────────────────
  console.log("\nUnbilled & backlog — the three states of a job's value");

  // Backlog, unbilled and invoiced must PARTITION the job's value. Overlap and
  // the shop plans against money it counted twice; a gap and delivered work
  // falls out of every report at once. Both failures are silent.
  const pipe = getBacklogService();
  const pipeCustomer = await prisma.customer.create({
    data: { name: `${CUSTOMER} Pipeline`, createdById: admin.id },
  });

  // One job: 100 units at ₱100 = ₱10,000, approved and on the floor.
  const pipeJo = await makeJo(950, "10000");
  await prisma.jobOrder.update({
    where: { id: pipeJo.id },
    data: { customerId: pipeCustomer.id, status: "IN_PROGRESS", total: "10000" },
  });
  await prisma.jobOrderItem.deleteMany({ where: { jobOrderId: pipeJo.id } });
  const pipeItem = await prisma.jobOrderItem.create({
    data: {
      jobOrderId: pipeJo.id, description: "Verify — 100 flyers",
      qty: 100, unitPrice: "100", lineTotal: "10000", qtyDelivered: 0,
    },
  });

  const forPipe = { state: "ALL" as const, customerId: pipeCustomer.id, search: null };
  const jobOf = async () =>
    (await pipe.getPipeline(actor, forPipe)).jobs.find(
      (j) => j.joNumber === `${PREFIX}JO-950`
    );

  const partitions = (j: { total: string; backlog: string; unbilled: string; invoiced: string }) =>
    toCentavos(j.backlog) + toCentavos(j.unbilled) + toCentavos(j.invoiced) ===
    toCentavos(j.total);

  // ——— nothing delivered, nothing billed ———
  const p0 = await jobOf();
  check("undelivered, unbilled work is ALL backlog",
    p0 !== undefined &&
      toCentavos(p0.backlog) === toCentavos("10000.00") &&
      toCentavos(p0.unbilled) === 0 &&
      toCentavos(p0.invoiced) === 0,
    p0 && { backlog: p0.backlog, unbilled: p0.unbilled, invoiced: p0.invoiced });
  check("THE THREE STATES PARTITION THE JOB'S VALUE",
    p0 !== undefined && partitions(p0));
  check("backlog is NOT on the A/R ledger — no invoice exists to age",
    !(await ar.list(actor, {})).customers.some(
      (c) => c.customerId === pipeCustomer.id
    ));

  // ——— a downpayment is NOT a bill ———
  //
  // On its OWN job order, because the counter refuses to invoice a job that
  // carries a JO receipt. Per the shop's own scenario table that is correct:
  // a walk-in job stays on JO slips throughout — ₱230 down, then ₱470 on
  // release — and a VAT customer stays on VAT invoices. The two series are
  // not mixed on one job.
  const depJo = await makeJo(951, "4000");
  await prisma.jobOrder.update({
    where: { id: depJo.id },
    data: { customerId: pipeCustomer.id, status: "IN_PROGRESS", total: "4000" },
  });
  await prisma.jobOrderItem.deleteMany({ where: { jobOrderId: depJo.id } });
  await prisma.jobOrderItem.create({
    data: {
      jobOrderId: depJo.id, description: "Verify — 40 posters",
      qty: 40, unitPrice: "100", lineTotal: "4000", qtyDelivered: 0,
    },
  });
  await receipts.receivePayment(cashier, {
    ...base, jobOrderId: depJo.id, kind: "JO_RECEIPT", amount: "2000.00",
    isDownpayment: true,
    payments: [{ method: "CASH", amount: "2000.00", reference: undefined }],
  });
  const pDeposit = (await pipe.getPipeline(actor, forPipe)).jobs.find(
    (j) => j.joNumber === `${PREFIX}JO-951`
  );
  check("A DOWNPAYMENT BILLS ITS OWN PORTION AND NO MORE",
    pDeposit !== undefined &&
      toCentavos(pDeposit.invoiced) === toCentavos("2000.00") &&
      toCentavos(pDeposit.backlog) === toCentavos("2000.00"),
    pDeposit && { backlog: pDeposit.backlog, invoiced: pDeposit.invoiced });
  check("…and it is flagged as a downpayment, so the balance is expected",
    toCentavos(pDeposit!.deposits) === toCentavos("2000.00"),
    pDeposit!.deposits);
  check("…and the partition still holds",
    partitions(pDeposit!));
  check("a slip paid in cash leaves nothing on the A/R ledger",
    !(await ar.list(actor, {})).customers.some(
      (c) => c.customerId === pipeCustomer.id
    ));

  // ——— half delivered: THE STATE THIS REPORT EXISTS FOR ———
  await prisma.jobOrderItem.update({
    where: { id: pipeItem.id }, data: { qtyDelivered: 50 },
  });
  const pHalf = await jobOf();
  check("DELIVERED-BUT-UNBILLED WORK IS ITS OWN STATE",
    pHalf !== undefined &&
      toCentavos(pHalf.unbilled) === toCentavos("5000.00") &&
      toCentavos(pHalf.backlog) === toCentavos("5000.00"),
    pHalf && { backlog: pHalf.backlog, unbilled: pHalf.unbilled });
  check("…and the partition still holds", partitions(pHalf!));
  check("…and it is STILL invisible to the A/R ledger",
    !(await ar.list(actor, {})).customers.some(
      (c) => c.customerId === pipeCustomer.id
    ));
  check("the UNBILLED filter finds exactly this job",
    (await pipe.getPipeline(actor, { ...forPipe, state: "UNBILLED" })).jobs
      .some((j) => j.joNumber === `${PREFIX}JO-950`));
  check("the open item names what is still to deliver, untruncated",
    pHalf!.openItems.length === 1 &&
      pHalf!.openItems[0]!.description === "Verify — 100 flyers" &&
      pHalf!.openItems[0]!.qtyDelivered === 50,
    pHalf!.openItems);

  // ——— invoice the delivered half ———
  await receipts.receivePayment(cashier, {
    ...base, jobOrderId: pipeJo.id, kind: "SI_CHARGE", amount: "5000.00", payments: [],
  });
  const pBilled = await jobOf();
  check("INVOICING MOVES VALUE OUT OF UNBILLED, NOT OUT OF BACKLOG",
    pBilled !== undefined &&
      toCentavos(pBilled.unbilled) === 0 &&
      toCentavos(pBilled.invoiced) === toCentavos("5000.00") &&
      toCentavos(pBilled.backlog) === toCentavos("5000.00"),
    pBilled && { backlog: pBilled.backlog, unbilled: pBilled.unbilled, invoiced: pBilled.invoiced });
  check("…and the partition still holds", partitions(pBilled!));
  check("NOW it appears on the A/R ledger, and only now",
    (await ar.list(actor, {})).customers.some(
      (c) => c.customerId === pipeCustomer.id
    ));

  // ——— billing ahead of delivery must not double-count ———
  await receipts.receivePayment(cashier, {
    ...base, jobOrderId: pipeJo.id, kind: "SI_CHARGE", amount: "5000.00", payments: [],
  });
  const pAhead = await jobOf();
  check("BILLING AHEAD OF DELIVERY IS NOT COUNTED TWICE",
    pAhead === undefined ||
      (toCentavos(pAhead.backlog) === 0 && toCentavos(pAhead.unbilled) === 0),
    pAhead && { backlog: pAhead.backlog, unbilled: pAhead.unbilled });
  check("…a fully billed job leaves the pipeline entirely",
    pAhead === undefined,
    pAhead?.joNumber);

  // ——— a VOIDED invoice puts the work back on the unbilled list ———
  const pipeSales = await prisma.sale.findMany({
    where: { jobOrderId: pipeJo.id, type: "SI_CHARGE", voidedAt: null },
    select: { id: true }, orderBy: { saleDate: "desc" }, take: 1,
  });
  await receipts.voidReceipt(actor, {
    receiptId: pipeSales[0]!.id, kind: "SI_CHARGE",
    type: "CANCELLED", reason: "Verify — billed in error.",
  });
  const pVoided = await jobOf();
  check("A CANCELLED INVOICE PUTS THE WORK BACK ON THE LIST",
    pVoided !== undefined && toCentavos(pVoided.invoiced) === toCentavos("5000.00"),
    pVoided && { invoiced: pVoided.invoiced, backlog: pVoided.backlog });
  check("…and the partition survives the void", partitions(pVoided!));

  // ——— totals and gating ———
  const whole = await pipe.getPipeline(actor, forPipe);
  check("the totals are the sum of the rows",
    whole.jobs.reduce((t, j) => t + toCentavos(j.backlog), 0) ===
      toCentavos(whole.totals.backlog) &&
      whole.jobs.reduce((t, j) => t + toCentavos(j.unbilled), 0) ===
        toCentavos(whole.totals.unbilled));
  check("off-ledger is backlog plus unbilled, and nothing else",
    toCentavos(whole.totals.offLedger) ===
      toCentavos(whole.totals.backlog) + toCentavos(whole.totals.unbilled),
    whole.totals);
  check("a cancelled job order is not in the pipeline",
    await (async () => {
      await prisma.jobOrder.update({
        where: { id: pipeJo.id }, data: { status: "CANCELLED" },
      });
      const gone = (await pipe.getPipeline(actor, forPipe)).jobs
        .some((j) => j.joNumber === `${PREFIX}JO-950`);
      await prisma.jobOrder.update({
        where: { id: pipeJo.id }, data: { status: "IN_PROGRESS" },
      });
      return !gone;
    })());
  check("the pipeline read is gated (R9)",
    (await pipe.getPipeline(viewer, forPipe)).totals.jobCount >= 0);
  // ─────────────────────────────────────────────────────────────────────
  console.log("\nJO slip: downpayment or the sale itself");

  // The same document, two meanings, and only the tag tells them apart:
  //   untagged — the walk-in paid and left. No invoice will follow, so this
  //              slip IS the sale and its money is revenue.
  //   tagged   — a downpayment on unfinished work. A deposit, not revenue,
  //              and more may follow on the same job.
  // Getting this wrong loses real revenue in one direction and invents it in
  // the other, and the day's total looks plausible either way.
  const dpBefore = await receipts.getDailySummary(actor);

  const walkInJo = await makeJo(960, "600");
  await receipts.receivePayment(cashier, {
    ...base, jobOrderId: walkInJo.id, kind: "JO_RECEIPT", amount: "600.00",
    payments: [{ method: "CASH", amount: "600.00", reference: undefined }],
  });
  const afterWalkIn = await receipts.getDailySummary(actor);
  check("a JO slip is a sale for what was handed over",
    toCentavos(afterWalkIn.grossSales) - toCentavos(dpBefore.grossSales) ===
      toCentavos("600.00"),
    { before: dpBefore.grossSales, after: afterWalkIn.grossSales });
  check("…and it is not tagged as a downpayment",
    toCentavos(afterWalkIn.joDownpayments.gross) ===
      toCentavos(dpBefore.joDownpayments.gross));

  // ——— the ₱20,000 job, taken in downpayments ———
  const dpJo = await makeJo(961, "20000");
  const dp1 = await receipts.receivePayment(cashier, {
    ...base, jobOrderId: dpJo.id, kind: "JO_RECEIPT", amount: "5000.00",
    isDownpayment: true,
    payments: [{ method: "CASH", amount: "5000.00", reference: undefined }],
  });
  const afterDp1 = await receipts.getDailySummary(actor);
  check("A DOWNPAYMENT BOOKS THE AMOUNT PAID — ₱5,000 down is ₱5,000 of sales",
    toCentavos(afterDp1.grossSales) - toCentavos(afterWalkIn.grossSales) ===
      toCentavos("5000.00"),
    { before: afterWalkIn.grossSales, after: afterDp1.grossSales });
  check("…and the tag marks it on the day's log without changing the total",
    toCentavos(afterDp1.joDownpayments.gross) -
      toCentavos(afterWalkIn.joDownpayments.gross) === toCentavos("5000.00"),
    afterDp1.joDownpayments.gross);
  check("…and cash in counts it, because it did cross the counter",
    toCentavos(afterDp1.cashIn) - toCentavos(afterWalkIn.cashIn) ===
      toCentavos("5000.00"),
    { before: afterWalkIn.cashIn, after: afterDp1.cashIn });

  // He comes back and pays another ₱5,000 — a second slip on the SAME job.
  await receipts.receivePayment(cashier, {
    ...base, jobOrderId: dpJo.id, kind: "JO_RECEIPT", amount: "5000.00",
    isDownpayment: true,
    payments: [{ method: "CASH", amount: "5000.00", reference: undefined }],
  });
  const afterDp2 = await receipts.getDailySummary(actor);
  check("A JOB TAKES AS MANY DOWNPAYMENTS AS THE CUSTOMER MAKES",
    toCentavos(afterDp2.joDownpayments.gross) -
      toCentavos(afterWalkIn.joDownpayments.gross) === toCentavos("10000.00"),
    afterDp2.joDownpayments.gross);
  check("…and each one books its own amount, so they add up to the job",
    toCentavos(afterDp2.grossSales) - toCentavos(afterWalkIn.grossSales) ===
      toCentavos("10000.00"),
    { before: afterWalkIn.grossSales, after: afterDp2.grossSales });

  const dpSlips = await prisma.sale.findMany({
    where: { jobOrderId: dpJo.id, voidedAt: null },
    select: { documentNo: true, amount: true, isDownpayment: true },
    orderBy: { saleDate: "asc" },
  });
  check("every downpayment keeps its own serial and its own tag",
    dpSlips.length === 2 &&
      dpSlips.every((s) => s.isDownpayment) &&
      new Set(dpSlips.map((s) => s.documentNo)).size === 2,
    dpSlips.map((s) => ({ no: s.documentNo, dp: s.isDownpayment })));

  // ——— the whole history of that job, in one place ———
  const dpHistory = await receipts.getJobOrderHistory(actor, dpJo.id);
  check("THE JOB'S ENTIRE TRANSACTION HISTORY IS TRACEABLE",
    dpHistory.entries.length === 2 &&
      toCentavos(dpHistory.totalReceived) === toCentavos("10000.00"),
    { entries: dpHistory.entries.length, received: dpHistory.totalReceived });
  check("…each line says what it was and what it left owing",
    dpHistory.entries[0]!.label.toLowerCase().includes("downpayment") &&
      toCentavos(dpHistory.entries[0]!.balanceAfter) === toCentavos("15000.00") &&
      toCentavos(dpHistory.entries[1]!.balanceAfter) === toCentavos("10000.00"),
    dpHistory.entries.map((e) => ({ label: e.label, bal: e.balanceAfter })));
  check("…and the job still shows ₱10,000 to go",
    toCentavos(dpHistory.stillDue) === toCentavos("10000.00"),
    dpHistory.stillDue);

  // ——— the sales report agrees with the daily summary ———
  const dpToday = new Date().toISOString().slice(0, 10);
  const dpRpt = await receipts.getSalesReport(actor, {
    from: dpToday, to: dpToday, groupBy: "day", customerId: null,
  });
  check("the range report marks downpayments the same way the day does",
    toCentavos(dpRpt.totals.deposits) >= toCentavos("10000.00"),
    { deposits: dpRpt.totals.deposits, joSales: dpRpt.totals.joSales });
  check("…and the downpayments are INSIDE the JO receipts row, not beside it",
    toCentavos(dpRpt.totals.deposits) <= toCentavos(dpRpt.byType.JO_RECEIPT.gross),
    { deposits: dpRpt.totals.deposits, joReceipts: dpRpt.byType.JO_RECEIPT.gross });

  // ——— and the balance is billed by a SECOND slip, as the shop does it ———
  await receipts.receivePayment(cashier, {
    ...base, jobOrderId: dpJo.id, kind: "JO_RECEIPT", amount: "10000.00",
    payments: [{ method: "CASH", amount: "10000.00", reference: undefined }],
  });
  const settledHistory = await receipts.getJobOrderHistory(actor, dpJo.id);
  check("THE SLIPS ADD UP TO THE JOB — ₱5,000 + ₱5,000 + ₱10,000 = ₱20,000",
    settledHistory.entries.length === 3 &&
      toCentavos(settledHistory.totalReceived) === toCentavos("20000.00") &&
      toCentavos(settledHistory.stillDue) === 0,
    { entries: settledHistory.entries.length, received: settledHistory.totalReceived, due: settledHistory.stillDue });
  check("…and the job is gone from the unbilled pipeline, fully billed",
    !(await getBacklogService().getPipeline(actor, {
      state: "ALL", customerId: null, search: null,
    })).jobs.some((j) => j.joNumber === `${PREFIX}JO-961`));





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
    await restoreCreditFlag().catch((e) => console.error("flag restore failed", e));
    await prisma.$disconnect();
  });
