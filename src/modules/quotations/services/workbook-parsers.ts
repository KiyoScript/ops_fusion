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
    // Only real size rows (e.g. 2×2", 3x4") — skip note/legend rows that
    // carry a stray peso value in the price columns.
    if (!/^\d+\s*[×x]\s*\d+/.test(size)) continue;
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
// Banner: the tarpaulin price block — top rows are "Banner | label | price"
// (Price Per Sq. Foot / Rush / Design Fee); everything below is the legacy
// order log, ignored. Sold as "Tarpaulin" in the quote form, so that's the
// product name it imports under.
// ═══════════════════════════════════════════════════════════════════════════
function parseBanner(rows: Rows): ParsedProduct[] {
  const rules: RuleCreateData[] = [];
  let sort = 0;
  for (let r = 0; r < rows.length; r++) {
    if (!/^banner$/i.test(cell(rows, r, 0))) continue;
    const label = cell(rows, r, 1);
    const price = money(cell(rows, r, 2));
    if (!label || price === null) continue;
    const isFee = /rush|design/i.test(label);
    rules.push(
      isFee ? addon(label, price, null, sort++) : variant(label, price, sort++)
    );
  }
  return rules.length
    ? [{ name: "Tarpaulin", category: "Large Format", unit: "sqft", rules }]
    : [];
}

// ═══════════════════════════════════════════════════════════════════════════
// Receipt: the receipt-booklet price DB — one row per Print Type × Copies ×
// Size Division × Total Booklets, priced per booklet ("Low Price/Booklet",
// col 9). Same combo at growing booklet counts = qty tiers of one variant.
// The "Receipt Old Pricing" tab is superseded and intentionally NOT parsed.
// ═══════════════════════════════════════════════════════════════════════════
function parseReceipt(rows: Rows): ParsedProduct[] {
  const header = rows.findIndex((r) => /print\s*type/i.test(String(r[0] ?? "")));
  if (header < 0) return [];
  const rules: RuleCreateData[] = [];
  let sort = 0;
  for (let r = header + 1; r < rows.length; r++) {
    const type = cell(rows, r, 0);
    const copies = cell(rows, r, 1);
    const division = cell(rows, r, 2);
    const minQty = parseInt(cell(rows, r, 3), 10);
    const price = money(cell(rows, r, 9));
    if (!type || !copies || !division || price === null) continue;
    if (!Number.isFinite(minQty) || minQty < 1) continue;
    rules.push(
      variant(`${type} · ${copies}-copy · 1/${division} page`, price, sort++, minQty)
    );
  }
  return rules.length
    ? [
        {
          name: "Receipt Booklet",
          category: "Printing",
          unit: "booklet",
          description:
            "Legacy receipt price DB — print type · copies · page division, tiered by booklet count",
          rules,
        },
      ]
    : [];
}

// ═══════════════════════════════════════════════════════════════════════════
// Products: the signage master list (Group | Name | Price | Type) — the same
// legacy layout the "Import price list" button reads, parsed here too so ONE
// workbook upload covers it. Group = product, Name = variant, Type = unit.
// ═══════════════════════════════════════════════════════════════════════════
function parseProductsTab(rows: Rows): ParsedProduct[] {
  const header = rows.findIndex(
    (r) =>
      /^group$/i.test(String(r[0] ?? "").trim()) &&
      /^name$/i.test(String(r[1] ?? "").trim())
  );
  if (header < 0) return [];
  const byGroup = new Map<string, ParsedProduct>();
  for (let r = header + 1; r < rows.length; r++) {
    const group = cell(rows, r, 0);
    const label = cell(rows, r, 1);
    const price = money(cell(rows, r, 2));
    if (!group || !label || price === null) continue;
    let product = byGroup.get(group.toLowerCase());
    if (!product) {
      product = {
        name: group,
        category: "Uncategorized",
        unit: cell(rows, r, 3) || "pcs",
        rules: [],
      };
      byGroup.set(group.toLowerCase(), product);
    }
    product.rules.push(variant(label, price, product.rules.length));
  }
  return [...byGroup.values()];
}

// ═══════════════════════════════════════════════════════════════════════════
// Newspaper Maintenance: side-by-side contract-rate blocks (EVMail / SLT /
// SLB …). Row 0 = block titles, row 1 = column headers, data below. Each data
// row is one whole print-run package — the label carries pages/colors/copies
// and the price is the run total, so minQty stays 1.
// ═══════════════════════════════════════════════════════════════════════════
function parseNewspaperMaintenance(rows: Rows): ParsedProduct[] {
  const titles = rows[0] ?? [];
  const headers = rows[1] ?? [];
  const blocks: { name: string; start: number; end: number }[] = [];
  const seen = new Set<string>();
  for (let c = 0; c < titles.length; c++) {
    const title = String(titles[c] ?? "").trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    blocks.push({ name: title.split(/\s+/)[0]!, start: c, end: titles.length });
  }
  blocks.forEach((b, i) => {
    const next = blocks[i + 1];
    if (next) b.end = next.start;
  });

  const products: ParsedProduct[] = [];
  for (const b of blocks) {
    const col = (re: RegExp): number => {
      for (let c = b.start; c < b.end; c++) {
        if (re.test(String(headers[c] ?? ""))) return c;
      }
      return -1;
    };
    const cPages = col(/total pages|# of pages$/i);
    const cCopies = col(/copies/i);
    const cColor = col(/colored|full color/i);
    const cRate = col(/new rate/i) >= 0 ? col(/new rate/i) : col(/rate/i);
    if (cPages < 0 || cCopies < 0 || cRate < 0) continue;

    const rules: RuleCreateData[] = [];
    for (let r = 2; r < rows.length; r++) {
      const pages = parseInt(cell(rows, r, cPages), 10);
      const copies = parseInt(cell(rows, r, cCopies), 10);
      const price = money(cell(rows, r, cRate));
      if (!Number.isFinite(pages) || !Number.isFinite(copies) || price === null)
        continue;
      const color = parseInt(cell(rows, r, cColor), 10);
      const colorTxt =
        Number.isFinite(color) && color > 0 ? ` (${color} color)` : "";
      rules.push(
        variant(
          `${pages} pages${colorTxt} × ${copies} copies`,
          price,
          rules.length
        )
      );
    }
    if (rules.length) {
      products.push({
        name: `Newspaper — ${b.name}`,
        category: "Printing",
        unit: "run",
        description: `${b.name} contract rates — price is for the whole print run`,
        rules,
      });
    }
  }
  return products;
}

// ═══════════════════════════════════════════════════════════════════════════
// NewsLetterNewPaper: two paired label|price columns — Newsletter (page-count
// variants, per copy) and Newspaper (color+BW page combos where the BW line
// sits on the next row without a price). Spec lines (size/method/material/
// minimum order) become the description; "minimum order: N" becomes minQty.
// ═══════════════════════════════════════════════════════════════════════════
function parseNewsletterNewspaper(rows: Rows): ParsedProduct[] {
  const out: ParsedProduct[] = [];
  const build = (name: string, cLabel: number, cPrice: number) => {
    const rules: RuleCreateData[] = [];
    const specs: string[] = [];
    for (let r = 1; r < rows.length; r++) {
      const label = cell(rows, r, cLabel);
      if (!label) continue;
      const price = money(cell(rows, r, cPrice));
      if (price !== null && /page/i.test(label)) {
        const next = cell(rows, r + 1, cLabel);
        const nextPrice = money(cell(rows, r + 1, cPrice));
        const full =
          nextPrice === null && /bw/i.test(next) ? `${label} + ${next}` : label;
        rules.push(variant(full, price, rules.length));
      } else if (price === null && !/bw/i.test(label)) {
        specs.push(label);
      }
    }
    const minMatch = specs.join(" ").match(/minimum order\s*:?\s*(\d+)/i);
    if (minMatch) {
      const minQty = parseInt(minMatch[1]!, 10);
      for (const rule of rules) rule.minQty = minQty;
    }
    if (rules.length) {
      out.push({
        name,
        category: "Printing",
        unit: "copy",
        description: specs.join(" · "),
        rules,
      });
    }
  };
  build("Newsletter", 0, 1);
  build("Newspaper", 2, 3);
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// UV Print: two tier tables on one sheet — flat surface (per location, up to
// 4 sq in) in cols 0-1 and cylindrical (pocket / vertical logo) in cols 3-5.
// Qty ranges ("3-10 pcs.") become minQty tiers; the flat 30+ row switches to
// per-sq-in pricing, so it is kept as its own variant.
// ═══════════════════════════════════════════════════════════════════════════
function parseUvPrint(rows: Rows): ParsedProduct[] {
  const rules: RuleCreateData[] = [];
  const qtyMin = (raw: string): number | null => {
    const m = raw.match(/^(\d+)/);
    return m ? parseInt(m[1]!, 10) : null;
  };
  for (let r = 0; r < rows.length; r++) {
    const flatQty = qtyMin(cell(rows, r, 0));
    if (flatQty !== null) {
      const raw = cell(rows, r, 1);
      const price = money(raw);
      if (price !== null) {
        const perSqIn = /per sq/i.test(raw);
        rules.push(
          variant(
            perSqIn
              ? "Flat surface — per sq. in. (30+ pcs)"
              : "Flat surface — per location (up to 4 sq in)",
            price,
            rules.length,
            flatQty,
            perSqIn ? "or tiered scale" : undefined
          )
        );
      }
    }
    const cylQty = qtyMin(cell(rows, r, 3));
    if (cylQty !== null) {
      const pocket = money(cell(rows, r, 4));
      const vertical = money(cell(rows, r, 5));
      const base = (raw: string) =>
        /base rate/i.test(raw) ? "base rate" : undefined;
      if (pocket !== null) {
        rules.push(
          variant(
            'Cylindrical — pocket logo (up to 2×2")',
            pocket,
            rules.length,
            cylQty,
            base(cell(rows, r, 4))
          )
        );
      }
      if (vertical !== null) {
        rules.push(
          variant(
            'Cylindrical — vertical logo (up to 2×7")',
            vertical,
            rules.length,
            cylQty,
            base(cell(rows, r, 5))
          )
        );
      }
    }
  }
  return rules.length
    ? [
        {
          name: "UV Print",
          category: "Printing",
          unit: "pc",
          description: "Priced per print location/surface (up to 4 sq in per location)",
          rules,
        },
      ]
    : [];
}

// ═══════════════════════════════════════════════════════════════════════════
// Registry: sheet name (lowercased) → parser. Sheets not listed are skipped.
// ═══════════════════════════════════════════════════════════════════════════
export const SHEET_PARSERS: Record<string, (rows: Rows) => ParsedProduct[]> = {
  banner: parseBanner,
  receipt: parseReceipt,
  products: parseProductsTab,
  "newspaper maintenance": parseNewspaperMaintenance,
  newsletternewpaper: parseNewsletterNewspaper,
  "uv print": parseUvPrint,
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
    // Type headers legitimately contain digits ("1 month per page (12 pages
    // only)"), so don't money()-reject them — the "size = ₱price" data rows
    // below are what identify a real type column.
    const type = cell(rows, 0, c);
    if (!type) continue;
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
