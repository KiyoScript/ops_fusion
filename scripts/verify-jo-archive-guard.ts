/**
 * F4 — a job order with money owed on it must not leave the board.
 *
 * Archiving keeps the JO's issued receipts (R11) and keeps them on the A/R
 * ledger, so archiving an unpaid job creates a receivable nobody is looking
 * at. This drives the real service against the real database and checks the
 * four cases, including the one that must NOT block: unbilled work is not a
 * debt (R3).
 *
 * Run: npx tsx scripts/verify-jo-archive-guard.ts
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getJobOrderService } from "../src/modules/job-orders/services";
import type { Actor } from "../src/lib/authz";

let failures = 0;
const pass = (label: string) => console.log(`  ✓ ${label}`);
const fail = (label: string, detail: string) => {
  failures++;
  console.log(`  ✗ ${label} — ${detail}`);
};

const TAG = "ZZ-F4-VERIFY";

/** Run archiveJo and report which way it went. */
async function tryArchive(
  actor: Actor,
  id: string
): Promise<{ archived: boolean; message: string }> {
  try {
    await getJobOrderService().archiveJo(actor, id);
    return { archived: true, message: "" };
  } catch (err) {
    return { archived: false, message: (err as Error).message };
  }
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!admin) throw new Error("No ADMIN user in this database.");
  const actor: Actor = { id: admin.id, role: admin.role };

  const customer = await prisma.customer.findFirst({ where: { deletedAt: null } });
  if (!customer) throw new Error("No customer in this database.");

  let seq = 0;
  const makeJo = async (total: string) => {
    seq++;
    const jo = await prisma.jobOrder.create({
      data: {
        joNumber: `${TAG}-${Date.now()}-${seq}`,
        customerId: customer.id,
        status: "IN_PROGRESS",
        subtotal: total,
        total,
        createdById: admin.id,
        items: {
          create: [
            { description: `${TAG} item`, qty: 1, unitPrice: total, lineTotal: total },
          ],
        },
      },
      select: { id: true, joNumber: true },
    });
    return jo;
  };

  const makeSale = async (
    jobOrderId: string,
    o: { amount: string; amountPaid: string; settledAmount?: string; voided?: boolean }
  ) => {
    seq++;
    return prisma.sale.create({
      data: {
        documentNo: `${TAG}-SI-${Date.now()}-${seq}`,
        type: "SI_NON_VAT",
        customerId: customer.id,
        jobOrderId,
        saleDate: new Date(),
        amount: o.amount,
        amountPaid: o.amountPaid,
        settledAmount: o.settledAmount ?? "0.00",
        createdById: admin.id,
        ...(o.voided
          ? { voidedAt: new Date(), voidReason: TAG, voidedById: admin.id }
          : {}),
      },
      select: { id: true },
    });
  };

  const created: string[] = [];

  console.log("\nArchive guard — four cases against the real database\n");

  // ── A. No receipts at all. Nothing is owed; archive proceeds. ──
  {
    const jo = await makeJo("10000.00");
    created.push(jo.id);
    const r = await tryArchive(actor, jo.id);
    r.archived
      ? pass("a JO with no receipts archives")
      : fail("a JO with no receipts archives", r.message);
  }

  // ── B. An invoice with money still open. Refused. ──
  {
    const jo = await makeJo("10000.00");
    created.push(jo.id);
    await makeSale(jo.id, { amount: "10000.00", amountPaid: "2000.00" });
    const r = await tryArchive(actor, jo.id);
    if (r.archived) {
      fail("an unpaid JO is refused", "it archived anyway");
    } else if (!r.message.includes("8,000.00") && !r.message.includes("8000.00")) {
      fail("an unpaid JO is refused", `message did not name ₱8,000: ${r.message}`);
    } else {
      pass("an unpaid JO is refused, and the message names the ₱8,000 owed");
    }
    const still = await prisma.jobOrder.findUnique({
      where: { id: jo.id },
      select: { status: true },
    });
    still?.status === "IN_PROGRESS"
      ? pass("  …and the JO is left untouched on the board")
      : fail("the refused JO is left untouched", `status is ${still?.status}`);
  }

  // ── C. THE NUANCE. Invoice fully settled, but most of the job was never
  //      billed. Unbilled work is not a debt, so this must NOT block. ──
  {
    const jo = await makeJo("10000.00");
    created.push(jo.id);
    // A ₱2,000 slip against a ₱10,000 job: ₱8,000 unbilled, ₱0 owed.
    await makeSale(jo.id, { amount: "2000.00", amountPaid: "2000.00" });
    const r = await tryArchive(actor, jo.id);
    r.archived
      ? pass("unbilled work does NOT block — ₱8,000 uninvoiced, nothing owed")
      : fail("unbilled work does NOT block", r.message);
  }

  // ── D. The only unpaid invoice was cancelled. A spoiled leaf owes nothing. ──
  {
    const jo = await makeJo("10000.00");
    created.push(jo.id);
    await makeSale(jo.id, { amount: "10000.00", amountPaid: "0.00", voided: true });
    const r = await tryArchive(actor, jo.id);
    r.archived
      ? pass("a cancelled invoice owes nothing — archive proceeds (R2)")
      : fail("a cancelled invoice owes nothing", r.message);
  }

  // ── cleanup ──
  await prisma.sale.deleteMany({ where: { documentNo: { startsWith: TAG } } });
  await prisma.jobOrderStatusHistory.deleteMany({
    where: { jobOrderId: { in: created } },
  });
  await prisma.activityLog.deleteMany({
    where: { entityType: "JobOrder", entityId: { in: created } },
  });
  await prisma.jobOrderItem.deleteMany({ where: { jobOrderId: { in: created } } });
  await prisma.jobOrder.deleteMany({ where: { id: { in: created } } });
  console.log(`\n  cleaned up ${created.length} test job orders\n`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log(failures === 0 ? "PASS\n" : `FAIL — ${failures} case(s)\n`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (e) => {
    await prisma.$disconnect();
    console.error(e);
    process.exit(1);
  });
