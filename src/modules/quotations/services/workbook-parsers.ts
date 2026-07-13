import type { RuleCreateData } from "../repositories/price-list-repository";

// Per-tab parsers for the legacy "Online Product specs" workbook. Each tab
// has its own shape, so each gets a dedicated parser that returns products
// with their price rules. The registry at the bottom maps sheet name → parser.

export type ParsedProduct = {
  name: string;
  category: string;
  unit: string;
  description?: string;
  rules: RuleCreateData[];
};

type Rows = string[][];

// ——— cell helpers ———

const money = (raw: string | undefined): number | null => {
  if (!raw) return null;
  // take the FIRST number (ranges like "125-150" → 125; "₱ 49/50" → 49)
  const m = raw.replace(/[₱,\s]/g, "").match(/(\d+(?:\.\d+)?)/);
  const n = m ? parseFloat(m[1]!) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};
const cell = (rows: Rows, r: number, c: number): string =>
  String(rows[r]?.[c] ?? "").trim();
const variant = (
  label: string,
  price: number,
  sortOrder: number,
  minQty = 1,
  notes?: string
): RuleCreateData => ({
  type: "VARIANT",
  label,
  unitPrice: price.toFixed(2),
  minQty,
  minCharge: null,
  amount: null,
  pct: null,
  notes: notes ?? null,
  sortOrder,
});
const addon = (
  label: string,
  amount: number | null,
  pct: number | null,
  sortOrder: number
): RuleCreateData => ({
  type: "ADDON",
  label,
  unitPrice: null,
  minQty: 1,
  minCharge: null,
  amount: amount !== null ? amount.toFixed(2) : null,
  pct: pct !== null ? pct.toFixed(2) : null,
  notes: null,
  sortOrder,
});

// Extract qty tiers embedded in a mug cell: "Min. 5pcs. 180" / "10pcs. ₱150".
const tierFromCell = (raw: string): { minQty: number; price: number } | null => {
  const qtyM = raw.match(/(\d+)\s*pcs?/i);
  const price = money(raw.replace(/\d+\s*pcs?\.?/i, ""));
  if (!qtyM || price === null) return null;
  return { minQty: parseInt(qtyM[1]!, 10), price };
};

// ═══════════════════════════════════════════════════════════════════════════
// Simple two-column tabs: label | price (one product, each row a variant).
// ═══════════════════════════════════════════════════════════════════════════
function twoColumn(
  name: string,
  category: string,
  unit: string
): (rows: Rows) => ParsedProduct[] {
  return (rows) => {
    const rules: RuleCreateData[] = [];
    let sort = 0;
    for (let r = 0; r < rows.length; r++) {
      const label = cell(rows, r, 0);
      const price = money(cell(rows, r, 1));
      if (!label || price === null) continue;
      if (/^(column|type|price|name)\b/i.test(label)) continue;
      const isFee = /rush|design fee/i.test(label);
      rules.push(
        isFee ? addon(label, price, null, sort++) : variant(label, price, sort++)
      );
    }
    return rules.length ? [{ name, category, unit, rules }] : [];
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Mugs: each COLUMN is a mug type; rows 3-6 are qty tiers within that column.
// ═══════════════════════════════════════════════════════════════════════════
function parseMugs(rows: Rows): ParsedProduct[] {
  const headerRow = rows.findIndex((row) =>
    row.some((c) => /mug/i.test(String(c)))
  );
  if (headerRow < 0) return [];
  const products: ParsedProduct[] = [];
  const cols = rows[headerRow]!.length;
  for (let c = 0; c < cols; c++) {
    const type = cell(rows, headerRow, c);
    if (!type || !/mug/i.test(type)) continue;
    const rules: RuleCreateData[] = [];
    let sort = 0;
    for (let r = headerRow + 1; r < rows.length; r++) {
      const tier = tierFromCell(cell(rows, r, c));
      if (tier) rules.push(variant(type, tier.price, sort++, tier.minQty));
    }
    if (rules.length) {
      products.push({ name: `Mug — ${type}`, category: "Souvenirs", unit: "pc", rules });
    }
  }
  return products;
}

// ═══════════════════════════════════════════════════════════════════════════
// Totebag / Calendar style: first col = size/variant label, following cols are
// qty tiers (header row carries "25pcs." etc.).
// ═══════════════════════════════════════════════════════════════════════════
function qtyColumns(
  name: string,
  category: string,
  unit: string
): (rows: Rows) => ParsedProduct[] {
  return (rows) => {
    if (rows.length < 2) return [];
    const header = rows[0]!;
    const tierQty: (number | null)[] = header.map((h) => {
      const m = String(h).match(/(\d+)\s*pcs?/i);
      return m ? parseInt(m[1]!, 10) : null;
    });
    const rules: RuleCreateData[] = [];
    let sort = 0;
    for (let r = 1; r < rows.length; r++) {
      const size = cell(rows, r, 0);
      if (!size) continue;
      for (let c = 1; c < header.length; c++) {
        const price = money(cell(rows, r, c));
        if (price === null) continue;
        const q = tierQty[c] ?? 1;
        rules.push(variant(size, price, sort++, q));
      }
    }
    return rules.length ? [{ name, category, unit, rules }] : [];
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Acrylic Keychains: size table with Standard / Die-cut price columns.
// ═══════════════════════════════════════════════════════════════════════════
function parseKeychains(rows: Rows): ParsedProduct[] {
  const headerRow = rows.findIndex((row) =>
    row.some((c) => /size/i.test(String(c))) &&
    row.some((c) => /standard/i.test(String(c)))
  );
  if (headerRow < 0) return [];
  const header = rows[headerRow]!;
  const stdCol = header.findIndex((c) => /standard/i.test(String(c)));
  const dieCol = header.findIndex((c) => /die.?cut/i.test(String(c)));
  const rules: RuleCreateData[] = [];
  let sort = 0;
  for (let r = headerRow + 1; r < rows.length; r++) {
    const size = cell(rows, r, 0).replace(/★/g, "").trim();
    if (!size) continue;
    const std = stdCol >= 0 ? money(cell(rows, r, stdCol)) : null;
    const die = dieCol >= 0 ? money(cell(rows, r, dieCol)) : null;
    if (std !== null) rules.push(variant(`${size} — Standard`, std, sort++));
    if (die !== null) rules.push(variant(`${size} — Die-cut`, die, sort++));
  }
  return rules.length
    ? [{ name: "Acrylic Keychain", category: "Acrylic", unit: "pc", rules }]
    : [];
}

// ═══════════════════════════════════════════════════════════════════════════
// Acrylic Plaques: paired columns (label | price) side by side.
// ═══════════════════════════════════════════════════════════════════════════
function parsePlaques(rows: Rows): ParsedProduct[] {
  const rules: RuleCreateData[] = [];
  let sort = 0;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length - 1; c++) {
      const label = cell(rows, r, c);
      const price = money(cell(rows, r, c + 1));
      if (label && price !== null && !/^acrylic$|glass/i.test(label)) {
        rules.push(variant(label, price, sort++));
        c++; // consume the price column
      }
    }
  }
  return rules.length
    ? [{ name: "Acrylic Plaque", category: "Acrylic", unit: "pc", rules }]
    : [];
}

// ═══════════════════════════════════════════════════════════════════════════
// T-shirt: three method blocks (Sublimation / DTF / Full Sub), each with a
// label|price pair; rows below the header are size tiers.
// ═══════════════════════════════════════════════════════════════════════════
function parseTshirt(rows: Rows): ParsedProduct[] {
  const header = rows[0] ?? [];
  const products: ParsedProduct[] = [];
  for (let c = 0; c < header.length; c++) {
    const method = cell(rows, 0, c);
    if (!method || money(method) !== null) continue;
    if (!/sublimation|dtf/i.test(method)) continue;
    const rules: RuleCreateData[] = [];
    let sort = 0;
    for (let r = 2; r < rows.length; r++) {
      const size = cell(rows, r, c);
      const price = money(cell(rows, r, c + 1));
      if (size && price !== null) rules.push(variant(size, price, sort++));
    }
    if (rules.length) {
      products.push({
        name: `T-Shirt — ${method}`,
        category: "Apparel",
        unit: "pc",
        rules,
      });
    }
  }
  return products;
}

// ═══════════════════════════════════════════════════════════════════════════
// Sticker: Type | (normal price) | Pre Cut price.
// ═══════════════════════════════════════════════════════════════════════════
function parseSticker(rows: Rows): ParsedProduct[] {
  const rules: RuleCreateData[] = [];
  let sort = 0;
  for (let r = 1; r < rows.length; r++) {
    const type = cell(rows, r, 0);
    if (!type) continue;
    const normal = money(cell(rows, r, 1));
    const preCut = money(cell(rows, r, 2));
    if (normal !== null) rules.push(variant(`${type}`, normal, sort++));
    if (preCut !== null) rules.push(variant(`${type} — Pre-cut`, preCut, sort++));
  }
  return rules.length
    ? [{ name: "Sticker", category: "Printing", unit: "sheet", rules }]
    : [];
}

// ═══════════════════════════════════════════════════════════════════════════
// Acrylic Signage & Plate Number: Signage Type | Price, plus Rush/Design fees.
// ═══════════════════════════════════════════════════════════════════════════
function parseAcrylicSignage(rows: Rows): ParsedProduct[] {
  const rules: RuleCreateData[] = [];
  let sort = 0;
  for (let r = 1; r < rows.length; r++) {
    const label = cell(rows, r, 0);
    const price = money(cell(rows, r, 1));
    if (!label || price === null) continue;
    if (/^rush more than/i.test(label)) continue; // the +5% note row
    if (/rush|design fee/i.test(label)) {
      rules.push(addon(label, price, null, sort++));
    } else {
      rules.push(variant(label, price, sort++));
    }
  }
  return rules.length
    ? [{ name: "Acrylic Signage & Plate", category: "Acrylic", unit: "pc", rules }]
    : [];
}

// ═══════════════════════════════════════════════════════════════════════════
// Single-value tabs (Canvas, Mesh Caps): one price for the whole product.
// ═══════════════════════════════════════════════════════════════════════════
function singlePrice(
  name: string,
  category: string,
  unit: string,
  label: string
): (rows: Rows) => ParsedProduct[] {
  return (rows) => {
    for (const row of rows) {
      for (const c of row) {
        const price = money(String(c));
        if (price !== null) {
          return [
            { name, category, unit, rules: [variant(label, price, 0)] },
          ];
        }
      }
    }
    return [];
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Registry: sheet name (lowercased) → parser. Sheets not listed are skipped.
// ═══════════════════════════════════════════════════════════════════════════
export const SHEET_PARSERS: Record<string, (rows: Rows) => ParsedProduct[]> = {
  "foldable fan": twoColumn("Foldable Fan", "Souvenirs", "pc"),
  canvas: singlePrice("Canvas Print", "Large Format", "sqft", "Standard rate"),
  "mesh caps": singlePrice("Mesh Cap", "Apparel", "pc", "Standard rate"),
  "calling card": twoColumnPaired("Calling Card", "Printing", "set"),
  certificates: twoColumnPaired("Certificate", "Printing", "copy"),
  "acrylic plaques": parsePlaques,
  nameplate: singlePrice("Name Plate", "Signage", "pc", "Standard rate"),
  "id printing": twoColumnPaired("ID Printing", "Printing", "pc"),
  "acrylic signage and plate numbe": parseAcrylicSignage,
  "acrylic display": twoColumn("Acrylic Display", "Acrylic", "sqft"),
  "acrylic keychains": parseKeychains,
  mugs: parseMugs,
  bookbind: twoColumn("Bookbinding", "Printing", "book"),
  "t-shirt": parseTshirt,
  frame: parseFrame,
  sticker: parseSticker,
  totebag: qtyColumns("Tote Bag", "Apparel", "pc"),
  tickets: twoColumn("Ticket", "Printing", "pc"),
  calendar: parseCalendar,
  "souvenir program": singlePrice("Souvenir Program", "Printing", "page", "Per page A3"),
  "life-size standee": singlePrice("Life-Size Standee", "Large Format", "sqft", "Standard rate"),
  risograph: parseRisograph,
};

// ═══════════════════════════════════════════════════════════════════════════
// Calendar: three type columns; row 1 = type name, rows 2-3 = size = ₱price.
// ═══════════════════════════════════════════════════════════════════════════
function parseCalendar(rows: Rows): ParsedProduct[] {
  const rules: RuleCreateData[] = [];
  let sort = 0;
  const header = rows[0] ?? [];
  for (let c = 0; c < header.length; c++) {
    const type = cell(rows, 0, c);
    if (!type || money(type) !== null) continue;
    for (let r = 1; r < Math.min(rows.length, 4); r++) {
      const raw = cell(rows, r, c); // "11\"x17\" = ₱ 28.50"
      const price = money(raw.split("=")[1] ?? "");
      const size = raw.split("=")[0]?.trim();
      if (size && price !== null && !/material|minimum|method/i.test(size)) {
        rules.push(variant(`${type.split("(")[0]!.trim()} ${size}`, price, sort++));
      }
    }
  }
  return rules.length
    ? [{ name: "Calendar", category: "Printing", unit: "pc", rules }]
    : [];
}

// ═══════════════════════════════════════════════════════════════════════════
// Risograph: paper-type sections; rows carry Short/Long with 4 price columns
// (Riso+paper front/back, Riso-only front/back).
// ═══════════════════════════════════════════════════════════════════════════
function parseRisograph(rows: Rows): ParsedProduct[] {
  const rules: RuleCreateData[] = [];
  let sort = 0;
  let section = "";
  for (let r = 0; r < rows.length; r++) {
    const first = cell(rows, r, 0);
    if (!first) continue;
    const prices = [1, 2, 3, 4].map((c) => money(cell(rows, r, c)));
    const hasPrice = prices.some((p) => p !== null);
    if (!hasPrice) {
      if (!/paper type|front|back/i.test(first)) section = first;
      continue;
    }
    const cols = ["Riso+paper Front", "Riso+paper B2B", "Riso-only Front", "Riso-only B2B"];
    prices.forEach((p, i) => {
      if (p !== null) {
        rules.push(variant(`${section} ${first} — ${cols[i]}`.trim(), p, sort++));
      }
    });
  }
  return rules.length
    ? [{ name: "Risograph", category: "Printing", unit: "ream", rules }]
    : [];
}

// ═══════════════════════════════════════════════════════════════════════════
// Two paired columns where row 1 = labels, row 2 = prices (Calling Card,
// Certificates, ID Printing).
// ═══════════════════════════════════════════════════════════════════════════
function twoColumnPaired(
  name: string,
  category: string,
  unit: string
): (rows: Rows) => ParsedProduct[] {
  return (rows) => {
    if (rows.length < 2) return [];
    const labels = rows[0]!;
    const prices = rows[1]!;
    const rules: RuleCreateData[] = [];
    let sort = 0;
    for (let c = 0; c < labels.length; c++) {
      const label = String(labels[c] ?? "").trim();
      const price = money(String(prices[c] ?? ""));
      if (label && price !== null) rules.push(variant(label, price, sort++));
    }
    return rules.length ? [{ name, category, unit, rules }] : [];
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Frame: pr.sq header, then "with matting|600", "without matting|550",
// "rush|150".
// ═══════════════════════════════════════════════════════════════════════════
function parseFrame(rows: Rows): ParsedProduct[] {
  const rules: RuleCreateData[] = [];
  let sort = 0;
  for (const row of rows) {
    const label = String(row[0] ?? "").trim();
    const price = money(String(row[1] ?? ""));
    if (!label || price === null) continue;
    if (/rush/i.test(label)) rules.push(addon("Rush fee", price, null, sort++));
    else if (/matting/i.test(label)) rules.push(variant(label, price, sort++, 1, "per sqft"));
  }
  return rules.length
    ? [{ name: "Frame", category: "Frames", unit: "sqft", rules }]
    : [];
}
