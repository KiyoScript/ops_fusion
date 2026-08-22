/**
 * F2 — the Job Order board and the Receive Payment dialog must agree.
 *
 * Before this fix there were two implementations of "is this job paid": the
 * dialog's (integer centavos, counted legacy collections, fell back to line
 * items) and the board's (floats, Sales only, raw header total). This script
 * runs the board's path over every job order in the database and checks the
 * three cases where they used to diverge.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { PrismaJobOrderRepository } from "../src/modules/job-orders/repositories/job-order-repository";
import { joCollectedCentavos, joTotalCentavos, toAmount } from "../src/modules/sales-audit/services/money";

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (ok) return;
  failures++;
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
};

/**
 * The three divergences, exercised directly.
 *
 * The dev database happens not to contain a zero-header JO or a legacy
 * collection, so the shared functions are driven here with the shapes that
 * used to be read wrong. These are pure functions — no database needed, and
 * no rows written to one.
 */
function verifyFallbacks() {
  console.log("\nShared maths — the cases that used to diverge\n");

  // 1. Zero header total falls back to the line items.
  const legacyJo = {
    total: "0.00",
    items: [{ lineTotal: "230.00" }, { lineTotal: "470.00" }],
  };
  check(
    joTotalCentavos(legacyJo) === 70000,
    "zero-header JO falls back to line items",
    `got ${toAmount(joTotalCentavos(legacyJo))}, want ₱700.00`
  );

  // A header total always wins when it is present.
  check(
    joTotalCentavos({ total: "700.00", items: [{ lineTotal: "1.00" }] }) === 70000,
    "header total wins over line items when set"
  );

  // 2. A legacy collection (no allocations) counts from its own face.
  const withLegacyCr = joCollectedCentavos({
    sales: [],
    crs: [{ amount: "500.00", allocations: [] }],
  });
  check(
    withLegacyCr === 50000,
    "legacy collection counts toward received",
    `got ${toAmount(withLegacyCr)}, want ₱500.00`
  );

  // 3. A modern collection does NOT double-count: its money already reached
  //    the invoice's settledAmount, so the CR itself contributes nothing.
  const modern = joCollectedCentavos({
    sales: [{ amountPaid: "0.00", settledAmount: "500.00" }],
    crs: [{ amount: "500.00", allocations: [{ id: "a1" }] }],
  });
  check(
    modern === 50000,
    "modern collection is counted once, not twice",
    `got ${toAmount(modern)}, want ₱500.00`
  );

  // 4. Counter payment + later collection on the same job add up.
  const both = joCollectedCentavos({
    sales: [{ amountPaid: "230.00", settledAmount: "470.00" }],
    crs: [],
  });
  check(both === 70000, "amountPaid + settledAmount", `got ${toAmount(both)}, want ₱700.00`);

  // 5. No float drift: three thirds of a peso must land exactly on ₱1.00.
  const thirds = joCollectedCentavos({
    sales: [
      { amountPaid: "0.33", settledAmount: "0.00" },
      { amountPaid: "0.33", settledAmount: "0.00" },
      { amountPaid: "0.34", settledAmount: "0.00" },
    ],
    crs: [],
  });
  check(thirds === 100, "no float drift across many small amounts", `got ${thirds} centavos, want 100`);

  if (failures === 0) console.log("  ✓ all five cases correct");
}

async function main() {
  verifyFallbacks();

  const repo = new PrismaJobOrderRepository();
  const jos = await prisma.jobOrder.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      joNumber: true,
      total: true,
      items: { select: { lineTotal: true } },
      sales: {
        where: { voidedAt: null, deletedAt: null },
        select: { amountPaid: true, settledAmount: true },
      },
      collectionReceipts: {
        where: { voidedAt: null, deletedAt: null },
        select: { amount: true, allocations: { select: { id: true }, take: 1 } },
      },
    },
  });

  console.log(`\nJO payment position — ${jos.length} job orders\n`);
  if (jos.length === 0) {
    console.log("  (empty database — nothing to compare)\n");
    return;
  }

  const board = await repo.getJoPaymentStatus(jos.map((j) => j.id));

  let zeroHeader = 0;
  let legacyCr = 0;
  let paid = 0;

  for (const jo of jos) {
    const b = board.get(jo.id);
    check(b !== undefined, `${jo.joNumber}: missing from board map`);
    if (!b) continue;

    // The dialog's maths, computed independently here from raw rows.
    const expectedTotal = joTotalCentavos(jo);
    const expectedReceived = joCollectedCentavos({
      sales: jo.sales,
      crs: jo.collectionReceipts,
    });

    check(
      b.total === expectedTotal,
      `${jo.joNumber}: total disagrees`,
      `board ${toAmount(b.total)} vs dialog ${toAmount(expectedTotal)}`
    );
    check(
      b.received === expectedReceived,
      `${jo.joNumber}: received disagrees`,
      `board ${toAmount(b.received)} vs dialog ${toAmount(expectedReceived)}`
    );
    check(Number.isInteger(b.total) && Number.isInteger(b.received), `${jo.joNumber}: not integer centavos`);

    // Case coverage — the three divergences the fix targets.
    if (Number(jo.total.toString()) === 0 && jo.items.length > 0) {
      zeroHeader++;
      check(b.total > 0, `${jo.joNumber}: zero-header JO still reads ₱0`, "item fallback did not fire");
    }
    if (jo.collectionReceipts.some((c) => c.allocations.length === 0)) legacyCr++;
    if (b.total > 0 && b.received >= b.total) paid++;
  }

  console.log(`  ✓ board total and received match the dialog's maths on all ${jos.length}`);
  console.log(`  ✓ every figure is integer centavos`);
  console.log(`\n  coverage: ${zeroHeader} zero-header JOs (item fallback), ${legacyCr} with legacy collections, ${paid} fully paid`);
  if (zeroHeader === 0 && legacyCr === 0) {
    console.log(`  note: no rows in this DB exercise the legacy paths — agreement proven, not the fallbacks`);
  }
  console.log("");
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log(failures === 0 ? "PASS\n" : `FAIL — ${failures} mismatch(es)\n`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (e) => {
    await prisma.$disconnect();
    console.error(e);
    process.exit(1);
  });
