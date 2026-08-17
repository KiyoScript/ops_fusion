// Seed newspaper pricing from "Newspaper Computation 2026.xlsx".
// Idempotent: replaces imported TABLE rows, preserves TEMPLATE rows (saved via
// "Add to Template"). Run: npx tsx scripts/import-newspaper.ts
import "dotenv/config";
import ExcelJS from "exceljs";
import { prisma } from "../src/lib/prisma";

const round2 = (n: number) => Math.round(n * 100) / 100;

function cellNum(ws: ExcelJS.Worksheet, r: number, c: number): number | null {
  let v: unknown = ws.getRow(r).getCell(c).value;
  if (v && typeof v === "object" && "result" in (v as object)) v = (v as { result: unknown }).result;
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
}
function cellStr(ws: ExcelJS.Worksheet, r: number, c: number): string {
  let v: unknown = ws.getRow(r).getCell(c).value;
  if (v && typeof v === "object" && "result" in (v as object)) v = (v as { result: unknown }).result;
  return v == null ? "" : String(v).trim();
}

type ColMap = {
  totalPages?: number;
  colorPages: number;
  bwPages: number;
  copies: number;
  price: number[]; // summed (SLB = printing + sorting)
  priceCode?: number;
};
type PubConfig = {
  sheet: string;
  name: string;
  sortOrder: number;
  full: ColMap;
  loose: ColMap | null; // loose rows store totalPages = null
};

// Per-publication column mapping (1-indexed). NOTE EVMail is copies-first.
const CONFIGS: PubConfig[] = [
  { sheet: "SLT Price", name: "SLT", sortOrder: 1,
    full: { totalPages: 1, colorPages: 2, bwPages: 3, copies: 4, price: [6] }, loose: null },
  { sheet: "SLB Price", name: "SLB", sortOrder: 2,
    full: { totalPages: 1, colorPages: 2, bwPages: 3, copies: 4, price: [5, 6], priceCode: 7 },
    loose: { colorPages: 3, bwPages: 2, copies: 1, price: [4] } },
  { sheet: "EVMail Price", name: "EVMail", sortOrder: 3,
    full: { totalPages: 2, colorPages: 3, bwPages: 4, copies: 1, price: [5] },
    loose: { colorPages: 3, bwPages: 4, copies: 1, price: [5] } },
  { sheet: "Krusada Price", name: "Krusada", sortOrder: 4,
    full: { totalPages: 1, colorPages: 2, bwPages: 3, copies: 4, price: [5], priceCode: 6 }, loose: null },
  { sheet: "Bandilyo", name: "Bandilyo", sortOrder: 5,
    full: { totalPages: 1, colorPages: 2, bwPages: 3, copies: 4, price: [6], priceCode: 7 }, loose: null },
];

type ParsedRow = {
  kind: "FULL_ISSUE" | "LOOSE_PAGES";
  totalPages: number | null;
  colorPages: number;
  bwPages: number;
  copies: number;
  price: number;
  priceCode: string | null;
};

function parseSheet(ws: ExcelJS.Worksheet, cfg: PubConfig): ParsedRow[] {
  const out: ParsedRow[] = [];
  let section: "FULL" | "LOOSE" = "FULL";
  let skipNext = false;
  for (let r = 3; r <= ws.rowCount; r++) {
    if (skipNext) { skipNext = false; continue; }
    if (/loose pages/i.test(cellStr(ws, r, 1))) {
      if (!cfg.loose) break;
      section = "LOOSE";
      skipNext = true; // skip the loose header row
      continue;
    }
    const map = section === "FULL" ? cfg.full : cfg.loose!;
    const copies = cellNum(ws, r, map.copies);
    const priceSum = map.price.reduce((s, c) => s + (cellNum(ws, r, c) ?? 0), 0);
    const price = round2(priceSum);
    if (!copies || price <= 0) continue; // skip blank / incomplete rows
    out.push({
      kind: section === "FULL" ? "FULL_ISSUE" : "LOOSE_PAGES",
      totalPages:
        section === "FULL" && map.totalPages ? cellNum(ws, r, map.totalPages) : null,
      colorPages: cellNum(ws, r, map.colorPages) ?? 0,
      bwPages: cellNum(ws, r, map.bwPages) ?? 0,
      copies,
      price,
      priceCode: map.priceCode ? cellStr(ws, r, map.priceCode) || null : null,
    });
  }
  return out;
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile("Newspaper Computation 2026.xlsx");

  // Formula constants are a FIXED code-side guide (DEFAULT_FORMULA_PARAMS,
  // decoded from the Formula sheet) — not DB-persisted, so nothing to seed here.

  let totalRows = 0;
  for (const cfg of CONFIGS) {
    const ws = wb.getWorksheet(cfg.sheet);
    if (!ws) { console.log(`(missing sheet ${cfg.sheet})`); continue; }
    const rows = parseSheet(ws, cfg);

    const pub = await prisma.newspaperPublication.upsert({
      where: { name: cfg.name },
      update: { sortOrder: cfg.sortOrder, isActive: true, deletedAt: null },
      create: { name: cfg.name, sortOrder: cfg.sortOrder },
    });
    // Replace imported rows only; keep user TEMPLATE saves.
    await prisma.newspaperPriceRow.deleteMany({
      where: { publicationId: pub.id, source: "TABLE" },
    });
    if (rows.length) {
      await prisma.newspaperPriceRow.createMany({
        data: rows.map((row) => ({ ...row, publicationId: pub.id, source: "TABLE" })),
      });
    }
    const full = rows.filter((r) => r.kind === "FULL_ISSUE").length;
    const loose = rows.length - full;
    console.log(`${cfg.name}: ${rows.length} rows (${full} full${loose ? `, ${loose} loose` : ""})`);
    totalRows += rows.length;
  }
  console.log(`\nTOTAL: ${totalRows} price rows across ${CONFIGS.length} publications.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
