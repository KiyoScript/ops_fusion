import { z } from "zod";

// Price-list maintenance (Quotation Maintenance) — CRUD for products +
// rules, plus the spreadsheet import. Import mirrors the JO legacy import:
// header-mapped columns, per-line errors, re-import safe.

const moneyString = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Enter a valid amount")
  .or(z.literal(""))
  .optional();

export const priceListRuleInput = z
  .object({
    type: z.enum(["VARIANT", "ADDON"]),
    label: z.string().trim().min(1, "Label is required").max(200),
    unitPrice: moneyString,
    minQty: z
      .string()
      .trim()
      .regex(/^\d*$/, "Whole number")
      .optional(),
    minCharge: moneyString,
    amount: moneyString,
    pct: moneyString,
    notes: z.string().trim().max(500).optional(),
  })
  .check((ctx) => {
    if (ctx.value.type === "VARIANT" && !ctx.value.unitPrice) {
      ctx.issues.push({
        code: "custom",
        message: "A variant needs a unit price.",
        path: ["unitPrice"],
        input: ctx.value,
      });
    }
    if (ctx.value.type === "ADDON" && !ctx.value.amount && !ctx.value.pct) {
      ctx.issues.push({
        code: "custom",
        message: "An add-on needs an amount and/or percent.",
        path: ["amount"],
        input: ctx.value,
      });
    }
  });

export const productSaveInput = z.object({
  id: z.string().optional(), // present when editing
  name: z.string().trim().min(1, "Product name is required").max(200),
  category: z.string().trim().min(1, "Category is required").max(120),
  unit: z.string().trim().min(1, "Unit is required").max(40),
  basePrice: moneyString,
  description: z.string().trim().max(500).optional(),
  rules: z.array(priceListRuleInput),
});

export type PriceListRuleInput = z.infer<typeof priceListRuleInput>;
export type ProductSaveInput = z.infer<typeof productSaveInput>;

// Global add-ons (Maintenance "Common add-ons" tab): fees offered on EVERY
// product. Saved replace-style like a product's rule set.
export const globalAddonInput = z
  .object({
    label: z.string().trim().min(1, "Label is required").max(200),
    amount: moneyString,
    pct: moneyString,
    notes: z.string().trim().max(500).optional(),
  })
  .check((ctx) => {
    if (!ctx.value.amount && !ctx.value.pct) {
      ctx.issues.push({
        code: "custom",
        message: "An add-on needs an amount and/or percent.",
        path: ["amount"],
        input: ctx.value,
      });
    }
  });

export const globalAddonsSaveInput = z.object({
  addons: z.array(globalAddonInput),
});

export type GlobalAddonInput = z.infer<typeof globalAddonInput>;
export type GlobalAddonsSaveInput = z.infer<typeof globalAddonsSaveInput>;

// Per-product production workflow (Maintenance). The whole ordered list is
// saved at once, replace-style.
export const productionStepsSaveInput = z.object({
  productId: z.string().min(1),
  steps: z
    .array(z.string().trim().min(1, "Step name is required").max(120))
    .max(30),
});

export type ProductionStepsSaveInput = z.infer<typeof productionStepsSaveInput>;

export type PriceImportRowError = { line: number; message: string };

export type PriceImportSummaryDto = {
  productsCreated: number;
  /** Products whose rules were replaced from the file. */
  productsUpdated: number;
  rulesCreated: number;
  errors: PriceImportRowError[];
};

/** Header row of the import template (also used for the CSV download). */
export const PRICE_LIST_COLUMNS = [
  "Product",
  "Category",
  "Unit",
  "Type",
  "Label",
  "Unit Price",
  "Min Qty",
  "Min Charge",
  "Amount",
  "Percent",
  "Notes",
] as const;
