/**
 * Sales report drill-down — the detail under a period row must agree with the
 * aggregate printed on it.
 *
 * The risk this guards against is R7: a report whose totals come from SQL over
 * the whole range, and whose expandable detail comes from a second query, can
 * quietly disagree. So for every period row at every granularity, this fetches
 * the drill-down the UI would fetch and checks that the revenue receipts in it
 * add up to exactly the count and gross the row claims.
 *
 * Run: npx tsx scripts/verify-sales-report-drilldown.ts
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getReceiptService } from "../src/modules/sales-audit/services";
import { toCentavos } from "../src/modules/sales-audit/services/money";
import { RECEIPT_KIND, type SalesGranularity } from "../src/modules/sales-audit/schemas/receipt";
import type { Actor } from "../src/lib/authz";

let failures = 0;
const pass = (label: string) => console.log(`  ✓ ${label}`);
const fail = (label: string, detail: string) => {
  failures++;
  console.log(`  ✗ ${label} — ${detail}`);
};

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!admin) throw new Error("No ADMIN user in this database.");
  const actor: Actor = { id: admin.id, role: admin.role };
  const svc = getReceiptService();

  const span = await prisma.sale.aggregate({
    _min: { saleDate: true },
    _max: { saleDate: true },
  });
  if (!span._min.saleDate || !span._max.saleDate) {
    console.log("\n  (no sales in this database — nothing to drill into)\n");
    return;
  }
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const from = iso(span._min.saleDate);
  const to = iso(span._max.saleDate);

  console.log(`\nSales report drill-down — ${from} to ${to}\n`);

  for (const groupBy of ["day", "week", "month"] as SalesGranularity[]) {
    const report = await svc.getSalesReport(actor, { from, to, groupBy });
    let checked = 0;
    let rowsSeen = 0;

    for (const p of report.byPeriod) {
      // ── the row must carry a usable range ──
      if (!p.from || !p.to || p.from > p.to) {
        fail(`${groupBy}/${p.key}: bad range`, `${p.from}..${p.to}`);
        continue;
      }
      if (p.from < from || p.to > to) {
        fail(`${groupBy}/${p.key}: range escapes the report`, `${p.from}..${p.to}`);
        continue;
      }
      if (groupBy === "day" && (p.from !== p.key || p.to !== p.key)) {
        fail(`${groupBy}/${p.key}: day range should be the key`, `${p.from}..${p.to}`);
        continue;
      }

      // ── the drill-down the UI would fetch ──
      const detail = await svc.listDay(actor, {
        from: p.from,
        to: p.to,
        take: 50,
      });
      rowsSeen += detail.rows.length;

      // Revenue only: cancelled receipts are listed for booklet
      // accountability but are not sales (R2), and a collection is cash in,
      // not revenue (R4). Those two exclusions are exactly what the aggregate
      // applies, so what is left must match it.
      const revenue = detail.rows.filter(
        (r) => r.voidedAt === null && r.kind !== RECEIPT_KIND.COLLECTION
      );
      const gross = revenue.reduce((t, r) => t + toCentavos(r.amount), 0);

      if (revenue.length !== p.count) {
        fail(
          `${groupBy}/${p.key}: receipt count`,
          `row says ${p.count}, drill-down has ${revenue.length}`
        );
        continue;
      }
      if (gross !== toCentavos(p.gross)) {
        fail(
          `${groupBy}/${p.key}: gross`,
          `row says ${p.gross}, drill-down sums ${gross} centavos`
        );
        continue;
      }
      checked++;
    }

    if (report.byPeriod.length === 0) {
      console.log(`  · ${groupBy}: no periods in range`);
    } else if (checked === report.byPeriod.length) {
      pass(
        `${groupBy}: all ${checked} period row(s) agree with their drill-down (${rowsSeen} receipts listed)`
      );
    }
  }

  // ── a range spanning several days returns the union of those days ──
  {
    const whole = await svc.listDay(actor, { from, to, take: 50 });
    const firstDay = await svc.listDay(actor, { date: from, take: 50 });
    const ids = new Set(whole.rows.map((r) => r.id));
    const missing = firstDay.rows.filter((r) => !ids.has(r.id));
    missing.length === 0
      ? pass("a multi-day range contains every receipt its first day contains")
      : fail("multi-day range is a superset of its days", `${missing.length} missing`);
    whole.rows.length >= firstDay.rows.length
      ? pass(`range returns ${whole.rows.length} receipts, single day returns ${firstDay.rows.length}`)
      : fail("range should return at least as many as one day", "");
  }

  // ── `from`/`to` win over `date` when both are sent ──
  {
    const both = await svc.listDay(actor, { date: to, from, to, take: 50 });
    const rangeOnly = await svc.listDay(actor, { from, to, take: 50 });
    both.rows.length === rangeOnly.rows.length
      ? pass("a range overrides `date` when both are sent")
      : fail("range overrides date", `${both.rows.length} vs ${rangeOnly.rows.length}`);
  }

  console.log("");
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log(failures === 0 ? "PASS\n" : `FAIL — ${failures} problem(s)\n`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (e) => {
    await prisma.$disconnect();
    console.error(e);
    process.exit(1);
  });
