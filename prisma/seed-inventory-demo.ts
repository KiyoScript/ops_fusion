// Seed a small, realistic Inventory demo set. Idempotent — skips items/suppliers
// that already exist. Run: npm run db:seed-inventory
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getSupplierService } from "../src/modules/inventory/services/supplier-service";
import { getMaterialService } from "../src/modules/inventory/services/material-service";
import type { Actor } from "../src/lib/authz";
import { DEMO_MATERIALS, DEMO_SUPPLIERS } from "./inventory-demo-data";

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!admin) throw new Error("No ADMIN user found — run the base seed first.");
  const actor: Actor = { id: admin.id, role: admin.role };
  const suppliers = getSupplierService();
  const materials = getMaterialService();

  // Suppliers (dedup by code) → map code → id.
  const codeToId = new Map<string, string>();
  for (const s of DEMO_SUPPLIERS) {
    const existing = await prisma.supplier.findFirst({
      where: { code: { equals: s.code, mode: "insensitive" }, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      codeToId.set(s.code, existing.id);
      console.log(`  = supplier ${s.name} (exists)`);
      continue;
    }
    const created = await suppliers.create(actor, {
      code: s.code,
      name: s.name,
      contactPerson: s.contactPerson,
      phone: s.phone,
      status: "ACTIVE",
    });
    codeToId.set(s.code, created.id);
    console.log(`  + supplier ${s.name}`);
  }

  // Materials (dedup by code) with opening stock → OPENING ledger row.
  let created = 0;
  let skipped = 0;
  for (const m of DEMO_MATERIALS) {
    const existing = await prisma.material.findFirst({
      where: { code: { equals: m.code, mode: "insensitive" } },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      console.log(`  = item ${m.code} (exists)`);
      continue;
    }
    await materials.create(actor, {
      code: m.code,
      name: m.name,
      category: m.category,
      location: m.location,
      area: m.area,
      unit: m.unit,
      packSize: m.packSize,
      unitCost: m.unitCost,
      unitPrice: m.unitPrice,
      reorderLevel: m.reorderLevel,
      status: "ACTIVE",
      possibleOffcut: m.possibleOffcut,
      supplierId: m.supplierCode ? codeToId.get(m.supplierCode) : undefined,
      openingQty: m.openingQty,
    });
    created++;
    console.log(`  + item ${m.code} — ${m.name} (opening ${m.openingQty})`);
  }

  console.log(`\nInventory demo seed done: ${created} item(s) created, ${skipped} already present.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
