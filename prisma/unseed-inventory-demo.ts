// Remove the Inventory demo set (items, their ledger rows, and demo suppliers).
// Run: npm run db:unseed-inventory
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { DEMO_MATERIAL_CODES, DEMO_SUPPLIER_NAMES } from "./inventory-demo-data";

async function main() {
  const items = await prisma.material.findMany({
    where: { code: { in: DEMO_MATERIAL_CODES } },
    select: { id: true },
  });
  const ids = items.map((i) => i.id);

  const ledger = await prisma.stockLedgerEntry.deleteMany({
    where: { materialId: { in: ids } },
  });
  // Demo materials are never referenced by real adjustments/counts, but clear
  // any that do point at them so the delete can't be blocked.
  await prisma.stockAdjustment.deleteMany({ where: { lines: { some: { materialId: { in: ids } } } } });
  await prisma.cycleCount.deleteMany({ where: { lines: { some: { materialId: { in: ids } } } } });
  const mats = await prisma.material.deleteMany({ where: { id: { in: ids } } });
  const sups = await prisma.supplier.deleteMany({ where: { name: { in: DEMO_SUPPLIER_NAMES } } });

  console.log(
    `Inventory demo removed: ${mats.count} item(s), ${ledger.count} ledger row(s), ${sups.count} supplier(s).`
  );
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
