/**
 * Cheque lifecycle — a cheque is not money until it clears, and a bounced one
 * must put the debt back on the A/R ledger.
 *
 * The defect this guards is the worst one in the payment model: the shop takes
 * a cheque, writes a receipt, the invoice reads settled — and when the cheque
 * comes back DAIF nothing reopens the receivable. Nobody chases the money.
 *
 * Drives the real services against the real database, then cleans up.
 * Run: npx tsx scripts/verify-cheque-lifecycle.ts
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getChequeService } from "../src/modules/sales-audit/services";
import { openBalanceOf } from "../src/modules/sales-audit/services/money";
import { PaymentMethod } from "../src/generated/prisma/enums";
import type { Actor } from "../src/lib/authz";

let failures = 0;
const pass = (l: string) => console.log(`  ✓ ${l}`);
const fail = (l: string, d = "") => {
  failures++;
  console.log(`  ✗ ${l}${d ? ` — ${d}` : ""}`);
};
const check = (ok: boolean, l: string, d = "") => (ok ? pass(l) : fail(l, d));

const TAG = "ZZ-CHQ-VERIFY";
const created: { sales: string[]; jos: string[] } = { sales: [], jos: [] };

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  const customer = await prisma.customer.findFirst({ where: { deletedAt: null } });
  if (!admin || !customer) throw new Error("Need an ADMIN user and a customer.");
  const actor: Actor = { id: admin.id, role: admin.role };
  const svc = getChequeService();

  let seq = 0;
  /** A charge invoice with money still owed, paid by the tender lines given. */
  const makeSale = async (
    amount: string,
    tenders: { method: PaymentMethod; amount: string; reference?: string }[]
  ) => {
    seq++;
    const jo = await prisma.jobOrder.create({
      data: {
        joNumber: `${TAG}-JO-${Date.now()}-${seq}`,
        customerId: customer.id,
        status: "IN_PROGRESS",
        subtotal: amount,
        total: amount,
        createdById: admin.id,
      },
      select: { id: true },
    });
    created.jos.push(jo.id);

    const paid = tenders.reduce((t, x) => t + Number(x.amount), 0).toFixed(2);
    const sale = await prisma.sale.create({
      data: {
        documentNo: `${TAG}-SI-${Date.now()}-${seq}`,
        type: "SI_NON_VAT",
        customerId: customer.id,
        jobOrderId: jo.id,
        saleDate: new Date(),
        amount,
        amountPaid: paid,
        createdById: admin.id,
        payments: {
          create: tenders.map((t, i) => ({
            method: t.method,
            amount: t.amount,
            reference: t.reference ?? null,
            seq: i,
          })),
        },
      },
      select: { id: true },
    });
    created.sales.push(sale.id);

    // The cheque rows are normally written by the repository at issue; here the
    // fixture inserts the Sale directly, so mirror that one step.
    const lines = await prisma.receiptPayment.findMany({
      where: { saleId: sale.id, method: PaymentMethod.CHECK },
      select: { id: true, reference: true },
    });
    await prisma.cheque.createMany({
      data: lines.map((l) => ({
        receiptPaymentId: l.id,
        chequeNo: l.reference ?? "(number not recorded)",
      })),
    });
    const cheques = await prisma.cheque.findMany({
      where: { receiptPaymentId: { in: lines.map((l) => l.id) } },
      select: { id: true, chequeNo: true },
    });
    return { saleId: sale.id, cheques };
  };

  const openOf = async (saleId: string) => {
    const s = await prisma.sale.findUniqueOrThrow({
      where: { id: saleId },
      select: { amount: true, amountPaid: true, settledAmount: true, voidedAt: true },
    });
    return { open: openBalanceOf(s), voided: s.voidedAt !== null };
  };

  console.log("\nCheque lifecycle — against the real database\n");

  // ── 1. The happy path: received → deposited → cleared. ──
  {
    const { cheques } = await makeSale("5000.00", [
      { method: PaymentMethod.CHECK, amount: "5000.00", reference: "CHQ-1001" },
    ]);
    const id = cheques[0]!.id;

    const reg0 = await svc.list(actor, {});
    const row0 = reg0.rows.find((r) => r.id === id);
    check(row0?.status === "RECEIVED", "a cheque starts on hand, not as money");
    check(row0?.amount === "5000.00", "…carrying its tender line's amount", `got ${row0?.amount}`);
    check(row0?.isSoleTender === true, "…and knows it is the receipt's only tender");

    await svc.deposit(actor, { chequeIds: [id], depositSlipNo: "DS-77" });
    const afterDep = (await svc.list(actor, {})).rows.find((r) => r.id === id);
    check(afterDep?.status === "DEPOSITED", "deposit moves it to the bank, still not money");
    check(afterDep?.depositSlipNo === "DS-77", "…and records the deposit slip");

    await svc.clear(actor, { chequeIds: [id] });
    const afterClr = (await svc.list(actor, {})).rows.find((r) => r.id === id);
    check(afterClr?.status === "CLEARED", "clearing is the only state that is money");
  }

  // ── 2. Backwards is refused; a cleared cheque may still bounce. ──
  {
    const { cheques } = await makeSale("1000.00", [
      { method: PaymentMethod.CHECK, amount: "1000.00", reference: "CHQ-1002" },
    ]);
    const id = cheques[0]!.id;
    await svc.deposit(actor, { chequeIds: [id] });

    let refused = false;
    try {
      await svc.deposit(actor, { chequeIds: [id] });
    } catch {
      refused = true;
    }
    check(refused, "a deposited cheque cannot be deposited again");

    await svc.clear(actor, { chequeIds: [id] });
    const res = await svc.bounce(actor, { chequeId: id, reason: "Returned late by the bank" });
    check(res.receiptReversed, "a CLEARED cheque can still bounce — banks reverse days later");
  }

  // ── 3. THE POINT OF ALL THIS. A bounce reopens the receivable. ──
  {
    const { saleId, cheques } = await makeSale("8000.00", [
      { method: PaymentMethod.CHECK, amount: "8000.00", reference: "CHQ-2001" },
    ]);
    const before = await openOf(saleId);
    check(before.open === 0, "the invoice reads settled while the cheque is trusted", `open ${before.open}`);

    const res = await svc.bounce(actor, {
      chequeId: cheques[0]!.id,
      reason: "DAIF",
    });
    check(res.receiptReversed, "bouncing it reverses the receipt");

    const after = await openOf(saleId);
    check(after.voided, "…the receipt is cancelled in place, serial intact (R11)");
    check(
      after.open === 0 && after.voided,
      "…and a cancelled receipt owes nothing itself"
    );

    // The debt is back where it belongs: the JOB is unpaid again.
    const jo = await prisma.jobOrder.findFirstOrThrow({
      where: { sales: { some: { id: saleId } } },
      select: { id: true },
    });
    const live = await prisma.sale.findMany({
      where: { jobOrderId: jo.id, voidedAt: null, deletedAt: null },
      select: { id: true },
    });
    check(live.length === 0, "…leaving the job order with no live receipt — it is owed again");

    const logged = await prisma.activityLog.findFirst({
      where: { entityType: "Cheque", entityId: cheques[0]!.id, action: "bounce-cheque" },
    });
    check(logged !== null, "…and the bounce is on the activity log under its own action (R12)");
  }

  // ── 4. A SPLIT receipt is not silently unpicked. ──
  {
    const { saleId, cheques } = await makeSale("3000.00", [
      { method: PaymentMethod.CASH, amount: "1000.00" },
      { method: PaymentMethod.CHECK, amount: "2000.00", reference: "CHQ-3001" },
    ]);
    const res = await svc.bounce(actor, {
      chequeId: cheques[0]!.id,
      reason: "Account closed",
    });
    check(!res.receiptReversed, "a cheque in a SPLIT tender does not reverse the receipt");
    check(
      res.followUp !== null && res.followUp.includes("reissue"),
      "…and says what to do instead",
      res.followUp ?? "(no follow-up given)"
    );
    const after = await openOf(saleId);
    check(!after.voided, "…the ₱1,000 cash that really arrived is left alone");

    const row = (await svc.list(actor, {})).rows.find((r) => r.id === cheques[0]!.id);
    check(row?.status === "BOUNCED", "…but the cheque itself is still marked bounced");
  }

  // ── 5. Register totals are computed over every cheque, not a page (R7). ──
  {
    const reg = await svc.list(actor, { status: "BOUNCED" });
    const all = await prisma.cheque.count();
    const summed =
      reg.totals.RECEIVED.count +
      reg.totals.DEPOSITED.count +
      reg.totals.CLEARED.count +
      reg.totals.BOUNCED.count;
    check(
      summed === all,
      "totals cover every cheque even when the list is filtered",
      `totals ${summed} vs ${all} rows`
    );
    check(
      reg.rows.every((r) => r.status === "BOUNCED"),
      "…while the rows honour the filter"
    );
  }

  // ── 6. A bounce cannot be applied twice. ──
  {
    const { cheques } = await makeSale("500.00", [
      { method: PaymentMethod.CHECK, amount: "500.00", reference: "CHQ-4001" },
    ]);
    await svc.bounce(actor, { chequeId: cheques[0]!.id, reason: "DAUD" });
    let refused = false;
    try {
      await svc.bounce(actor, { chequeId: cheques[0]!.id, reason: "again" });
    } catch {
      refused = true;
    }
    check(refused, "a bounced cheque cannot be bounced again");
  }

  console.log("");
}

async function cleanup() {
  await prisma.cheque.deleteMany({
    where: { receiptPayment: { saleId: { in: created.sales } } },
  });
  await prisma.receiptPayment.deleteMany({ where: { saleId: { in: created.sales } } });
  await prisma.activityLog.deleteMany({
    where: { entityType: "Sale", entityId: { in: created.sales } },
  });
  await prisma.sale.deleteMany({ where: { id: { in: created.sales } } });
  await prisma.jobOrderStatusHistory.deleteMany({
    where: { jobOrderId: { in: created.jos } },
  });
  await prisma.activityLog.deleteMany({
    where: { entityType: "JobOrder", entityId: { in: created.jos } },
  });
  await prisma.jobOrder.deleteMany({ where: { id: { in: created.jos } } });
  console.log(`  cleaned up ${created.sales.length} receipts, ${created.jos.length} job orders\n`);
}

main()
  .then(cleanup)
  .then(async () => {
    await prisma.$disconnect();
    console.log(failures === 0 ? "PASS\n" : `FAIL — ${failures} case(s)\n`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (e) => {
    await cleanup().catch(() => {});
    await prisma.$disconnect();
    console.error(e);
    process.exit(1);
  });
