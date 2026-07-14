import { ValidationError } from "@/lib/errors";
import { type Actor } from "@/lib/authz";
import { assertCan } from "@/lib/ability";
import { PriceRuleType } from "@/generated/prisma/enums";
import type { IActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import type {
  IPriceListRepository,
  RuleCreateData,
} from "../repositories/price-list-repository";
import type {
  PriceImportRowError,
  PriceImportSummaryDto,
} from "../schemas/price-list";

// Price-list import — the quotation counterpart of the JO legacy import.
// Columns are matched BY HEADER NAME (not position), so both the template
// (Product · Category · Unit · Type · Label · Unit Price · Min Qty ·
// Min Charge · Amount · Percent · Notes) and the legacy sheet layout
// (Group · Name · Price) import as-is.
//
//   • Products are found case-insensitively or created (category/unit/
//     basePrice apply only on create — the app owns them afterwards).
//   • Type VARIANT needs a Unit Price; ADDON needs Amount and/or Percent;
//     blank Type = VARIANT when a Unit Price is present, else the row just
//     ensures the product exists.
//   • Rules of every product in the file are REPLACED from the file — the
//     spreadsheet stays the source of truth, so re-imports are safe.

type ColumnKey =
  | "product"
  | "category"
  | "unit"
  | "type"
  | "label"
  | "unitPrice"
  | "minQty"
  | "minCharge"
  | "amount"
  | "pct"
  | "notes";

// First alias hit wins per header cell; keys are checked in this order, so
// "Product Name" maps to product, plain "Name" to label.
const HEADER_ALIASES: [ColumnKey, string[]][] = [
  ["product", ["product", "productname", "group", "item", "service"]],
  ["category", ["category", "section"]],
  ["unit", ["unit", "uom"]],
  ["type", ["type", "ruletype"]],
  ["label", ["label", "name", "variant", "option", "tier"]],
  ["unitPrice", ["unitprice", "price", "rate", "unitcost", "srp"]],
  ["minQty", ["minqty", "minquantity", "minimumqty", "minorder", "minimumorder"]],
  ["minCharge", ["mincharge", "minimumcharge"]],
  ["amount", ["amount", "flatfee", "flat", "fee"]],
  ["pct", ["percent", "pct", "percentage", "%"]],
  ["notes", ["notes", "remarks", "specs", "description"]],
];

type ColumnMap = Partial<Record<ColumnKey, number>>;

const normalizeHeader = (raw: string): string =>
  raw.toLowerCase().replace(/[^a-z%]/g, "");

/** Scans the first rows for a header naming at least Product + a price
 *  column. Returns the header row index and the name → column map. */
function findHeader(rows: string[][]): { index: number; map: ColumnMap } | null {
  const scan = Math.min(rows.length, 10);
  for (let i = 0; i < scan; i++) {
    const map: ColumnMap = {};
    rows[i]!.forEach((cellRaw, col) => {
      const name = normalizeHeader(String(cellRaw ?? ""));
      if (!name) return;
      for (const [key, aliases] of HEADER_ALIASES) {
        if (aliases.includes(name)) {
          if (map[key] === undefined) map[key] = col;
          return;
        }
      }
    });
    if (
      map.product !== undefined &&
      (map.unitPrice !== undefined || map.amount !== undefined)
    ) {
      return { index: i, map };
    }
  }
  return null;
}

type ParsedProduct = {
  name: string;
  category: string;
  unit: string;
  rules: RuleCreateData[];
};

/** "₱1,500.00" → 1500 (legacy sheets carry currency formatting). */
const parseMoney = (raw: string): number | null => {
  if (!raw) return null;
  const cleaned = raw.replace(/[₱,\s]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export class PriceImportService {
  constructor(
    private readonly priceList: IPriceListRepository,
    private readonly activity: IActivityLogRepository
  ) {}

  /** `rows` are positional cells from fileToRows — CSV or XLSX. */
  async import(actor: Actor, rows: string[][]): Promise<PriceImportSummaryDto> {
    assertCan(actor, "maintain", "Maintenance");

    const header = findHeader(rows);
    if (!header) {
      throw new ValidationError(
        'Could not find a header row. The sheet must name its columns — either the template ("Product, Category, Unit, Type, Label, Unit Price, …" — download it from this dialog) or the legacy layout ("Group, Name, Price").'
      );
    }
    const { map } = header;
    const cell = (row: string[], key: ColumnKey): string => {
      const index = map[key];
      return index === undefined ? "" : String(row[index] ?? "").trim();
    };

    const errors: PriceImportRowError[] = [];
    const products = new Map<string, ParsedProduct>(); // keyed lowercased name

    rows.forEach((row, index) => {
      if (index <= header.index) return; // header + anything above it
      const line = index + 1;
      const name = cell(row, "product");
      if (!name) return; // blank/spacer row

      const key = name.toLowerCase();
      let product = products.get(key);
      if (!product) {
        product = {
          name,
          category: cell(row, "category") || "Uncategorized",
          unit: cell(row, "unit") || "",
          rules: [],
        };
        products.set(key, product);
      }

      try {
        const parsed = parseRule(cell.bind(null, row), product.rules.length);
        if (parsed.rule) product.rules.push(parsed.rule);
        // The legacy Products tab labels its UNIT column "Type" (sqft/pc/
        // flat) — a non-VARIANT/ADDON value there is a unit, not an error.
        if (!product.unit && parsed.unitHint) product.unit = parsed.unitHint;
      } catch (err) {
        errors.push({
          line,
          message: err instanceof Error ? err.message : "Invalid row.",
        });
      }
    });
    for (const product of products.values()) {
      if (!product.unit) product.unit = "pcs";
    }

    if (products.size === 0) {
      throw new ValidationError(
        "No product rows found below the header — check the file."
      );
    }

    let productsCreated = 0;
    let productsUpdated = 0;
    let rulesCreated = 0;

    await this.priceList.withTransaction(async (tx) => {
      for (const product of products.values()) {
        const ref = await this.priceList.findOrCreateProduct(
          {
            name: product.name,
            category: product.category,
            unit: product.unit,
            // Prefill from the first variant so the picker shows a price
            // even before a variant is chosen; the app owns it afterwards.
            basePrice:
              product.rules.find((r) => r.type === PriceRuleType.VARIANT)
                ?.unitPrice ?? "0",
            createdById: actor.id,
          },
          tx
        );
        if (ref.created) productsCreated++;

        if (product.rules.length > 0) {
          await this.priceList.replaceRules(ref.id, product.rules, tx);
          rulesCreated += product.rules.length;
          if (!ref.created) productsUpdated++;
        }
      }

      await this.activity.log(
        {
          userId: actor.id,
          entityType: "Product",
          entityId: "price-list-import",
          action: "import",
          payload: {
            products: products.size,
            productsCreated,
            rulesCreated,
            errors: errors.length,
          },
        },
        tx
      );
    });

    return { productsCreated, productsUpdated, rulesCreated, errors };
  }
}

/** One spreadsheet row → one rule (or none for a product-only row). A
 *  non-VARIANT/ADDON value in the Type column is a unit hint (sqft/pc). */
function parseRule(
  cell: (key: ColumnKey) => string,
  sortOrder: number
): { rule: RuleCreateData | null; unitHint: string | null } {
  const typeCell = cell("type");
  const typeRaw = typeCell.toUpperCase();
  const isRuleType = typeRaw === "VARIANT" || typeRaw === "ADDON";
  const unitHint = typeCell && !isRuleType ? typeCell : null;
  const label = cell("label");
  const unitPrice = parseMoney(cell("unitPrice"));
  const amount = parseMoney(cell("amount"));
  const pct = parseMoney(cell("pct"));
  const minCharge = parseMoney(cell("minCharge"));
  const minQtyRaw = cell("minQty");
  const minQty = minQtyRaw ? parseInt(minQtyRaw, 10) : 1;
  const notes = cell("notes") || null;

  const type =
    typeRaw === "ADDON"
      ? PriceRuleType.ADDON
      : typeRaw === "VARIANT" || unitPrice !== null
        ? PriceRuleType.VARIANT
        : null;
  if (type === null) return { rule: null, unitHint }; // product-only row

  if (!Number.isFinite(minQty) || minQty < 1) {
    throw new Error(`Invalid Min Qty "${minQtyRaw}".`);
  }

  if (type === PriceRuleType.VARIANT) {
    if (unitPrice === null) {
      throw new Error("A VARIANT row needs a Unit Price.");
    }
    return {
      unitHint,
      rule: {
        type,
        label: label || "Standard rate",
        unitPrice: unitPrice.toFixed(2),
        minQty,
        minCharge: minCharge !== null ? minCharge.toFixed(2) : null,
        notes,
        sortOrder,
      },
    };
  }

  if (amount === null && pct === null) {
    throw new Error("An ADDON row needs an Amount and/or Percent.");
  }
  if (!label) throw new Error("An ADDON row needs a Label.");
  return {
    unitHint,
    rule: {
      type,
      label,
      minQty: 1,
      amount: amount !== null ? amount.toFixed(2) : null,
      pct: pct !== null ? pct.toFixed(2) : null,
      notes,
      sortOrder,
    },
  };
}
