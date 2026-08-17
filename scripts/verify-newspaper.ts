// verify-newspaper.ts — green end-to-end check of the newspaper pricing engine
// against the real seeded data. Run: npx tsx scripts/verify-newspaper.ts
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import {
  priceNewspaper,
  computeFormula,
  DEFAULT_FORMULA_PARAMS,
} from "../src/modules/quotations/services/newspaper-pricing";

let pass = 0;
let fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "✓" : "✗"} ${name}: ${JSON.stringify(actual)}${ok ? "" : ` (expected ${JSON.stringify(expected)})`}`);
  ok ? pass++ : fail++;
}

async function pubId(name: string): Promise<string> {
  const p = await prisma.newspaperPublication.findUniqueOrThrow({ where: { name } });
  return p.id;
}

async function main() {
  const SLT = await pubId("SLT");
  const SLB = await pubId("SLB");

  // 1) Formula decoded 1:1 vs the xlsx "Formula" example.
  const f = computeFormula(
    { totalPages: 12, colorPages: 8, bwPages: 4, copies: 300 },
    DEFAULT_FORMULA_PARAMS
  );
  check("formula total (12p/8c/4bw/300)", f.total, 30105);
  check("formula per-copy", f.perCopy, 100.35);

  // 2) Exact TABLE hit — SLT 8p/2c/6bw/300 → New Rate 13034.56.
  const t1 = await priceNewspaper({ publicationId: SLT, kind: "FULL_ISSUE", totalPages: 8, colorPages: 2, bwPages: 6, copies: 300 });
  check("SLT table source", t1.source, "TABLE");
  check("SLT table total", t1.total, 13034.56);

  // 3) SLB folds in the ₱300 sorting charge — 6p/0c/6bw/300 → 5984.56 + 300.
  const t2 = await priceNewspaper({ publicationId: SLB, kind: "FULL_ISSUE", totalPages: 6, colorPages: 0, bwPages: 6, copies: 300 });
  check("SLB table+sorting total", t2.total, 6284.56);

  // 4) Loose pages lookup — SLB 200 copies / 4 BW → ₱3,600.
  const t3 = await priceNewspaper({ publicationId: SLB, kind: "LOOSE_PAGES", totalPages: 4, colorPages: 0, bwPages: 4, copies: 200 });
  check("SLB loose source", t3.source, "TABLE");
  check("SLB loose total", t3.total, 3600);

  // 5) FORMULA fallback — a combo not in any table (SLT 8 color + 4 BW).
  const t4 = await priceNewspaper({ publicationId: SLT, kind: "FULL_ISSUE", totalPages: 12, colorPages: 8, bwPages: 4, copies: 300 });
  check("SLT formula fallback source", t4.source, "FORMULA");
  check("SLT formula fallback total", t4.total, 30105);

  // 6) Data volume.
  const rows = await prisma.newspaperPriceRow.count();
  const pubs = await prisma.newspaperPublication.count();
  check("publications seeded", pubs, 5);
  check("price rows seeded (>=190)", rows >= 190, true);

  console.log(`\n${pass}/${pass + fail} checks passed.`);
  if (fail) process.exit(1);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
