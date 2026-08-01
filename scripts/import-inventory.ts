// Import the legacy StockDatabase item master into OPS Fusion.
//
//   npx tsx scripts/import-inventory.ts <AllItems.csv> [Supplier.csv]
//
// Export the Google Sheet tabs to CSV first (File → Download → CSV). Columns are
// read BY POSITION (the legacy sheet is index-based), so keep the original
// column order; the header row is skipped automatically.
//
// AllItems columns (0-indexed, as in the legacy AllItemsCode.js):
//   A code · B name · C location · D unit · E area · F supplier ·
//   G stock-on-hand (computed → imported as OPENING stock) · H unitCost/pc ·
//   I date · J,K reserved · L possibleOffcut(Yes/No) · M status(Active/Inactive) ·
//   N reorderLevel · O unitPrice/bundle · P packSize(pcs/bundle)
//
// Supplier columns (optional file): A id · B code · C name · D contactPerson ·
//   E email · … I address · L contactNumber. Without this file, suppliers are
//   created on the fly from the AllItems "supplier" column.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma";
import { parseCsv } from "../src/lib/csv";
import { getSupplierService } from "../src/modules/inventory/services/supplier-service";
import { getMaterialService } from "../src/modules/inventory/services/material-service";
import type { Actor } from "../src/lib/authz";

const cell = (row: string[], i: number): string => (row[i] ?? "").toString().trim();
const num = (v: string): number => {
  const n = parseFloat(v.replace(/[₱,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const intNum = (v: string): number => Math.max(0, Math.round(num(v)));

async function main() {
  const [allItemsPath, supplierPath] = process.argv.slice(2);
  if (!allItemsPath) {
    console.error("Usage: npx tsx scripts/import-inventory.ts <AllItems.csv> [Supplier.csv]");
    process.exitCode = 1;
    return;
  }

  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!admin) throw new Error("No ADMIN user found — run the base seed first.");
  const actor: Actor = { id: admin.id, role: admin.role };
  const suppliers = getSupplierService();
  const materials = getMaterialService();

  // supplier key (lowercased code OR name) → supplierId
  const supplierKey = new Map<string, string>();
  const linkSupplier = (id: string, ...keys: string[]) => {
    for (const k of keys) if (k) supplierKey.set(k.toLowerCase(), id);
  };

  // Pre-seed from an existing supplier list so on-the-fly creation can reuse it.
  for (const s of await prisma.supplier.findMany({ where: { deletedAt: null }, select: { id: true, code: true, name: true } })) {
    linkSupplier(s.id, s.code ?? "", s.name);
  }

  let supMade = 0;
  if (supplierPath) {
    const rows = parseCsv(readFileSync(supplierPath, "utf8"));
    for (const row of rows.slice(1)) {
      const code = cell(row, 1);
      const name = cell(row, 2);
      if (!name && !code) continue;
      const key = (code || name).toLowerCase();
      if (supplierKey.has(key)) continue;
      const created = await suppliers.create(actor, {
        code: code || undefined,
        name: name || code,
        contactPerson: cell(row, 3) || undefined,
        email: cell(row, 4) || undefined,
        phone: cell(row, 11) || undefined,
        address: cell(row, 8) || undefined,
        status: "ACTIVE",
      });
      linkSupplier(created.id, code, name);
      supMade++;
    }
    console.log(`Suppliers: ${supMade} created from ${supplierPath}.`);
  }

  // Resolve (or lazily create) a supplier from the AllItems "supplier" cell,
  // which may be a code, a name, or slash-separated ("WYT / PRESTIGE").
  const resolveSupplier = async (raw: string): Promise<string | undefined> => {
    const first = raw.split("/")[0]?.trim();
    if (!first) return undefined;
    const found = supplierKey.get(first.toLowerCase());
    if (found) return found;
    const created = await suppliers.create(actor, { name: first, status: "ACTIVE" });
    linkSupplier(created.id, first);
    supMade++;
    return created.id;
  };

  const rows = parseCsv(readFileSync(allItemsPath, "utf8"));
  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const [idx, row] of rows.slice(1).entries()) {
    const code = cell(row, 0);
    if (!code) continue; // blank line
    const name = cell(row, 1);
    try {
      const existing = await prisma.material.findFirst({
        where: { code: { equals: code, mode: "insensitive" } },
        select: { id: true },
      });
      if (existing) { skipped++; continue; }

      const supplierId = await resolveSupplier(cell(row, 5));
      await materials.create(actor, {
        code,
        name: name || code,
        location: cell(row, 2) || undefined,
        unit: cell(row, 3) || "pc",
        area: cell(row, 4) || undefined,
        supplierId,
        unitCost: num(cell(row, 7)),
        possibleOffcut: cell(row, 11).toLowerCase() === "yes",
        status: cell(row, 12).toLowerCase() === "inactive" ? "INACTIVE" : "ACTIVE",
        reorderLevel: intNum(cell(row, 13)),
        unitPrice: cell(row, 14) ? num(cell(row, 14)) : undefined,
        packSize: intNum(cell(row, 15)),
        openingQty: intNum(cell(row, 6)), // col G = computed stock-on-hand
      });
      created++;
    } catch (e) {
      errors.push(`Row ${idx + 2} (${code}): ${(e as Error).message}`);
    }
  }

  console.log(`\nItems: ${created} imported, ${skipped} already present, ${errors.length} error(s).`);
  if (supMade) console.log(`Suppliers created (incl. on-the-fly): ${supMade}.`);
  if (errors.length) {
    console.log("\nErrors:");
    for (const e of errors.slice(0, 50)) console.log("  - " + e);
    if (errors.length > 50) console.log(`  … and ${errors.length - 50} more.`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
