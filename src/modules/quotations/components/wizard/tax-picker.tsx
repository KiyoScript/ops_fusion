"use client";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { VAT_RATE, type TaxType } from "../../services/totals";

export type { TaxType };

const OPTIONS: { value: TaxType; label: string; desc: string }[] = [
  { value: "NON_VAT", label: "Non-VAT", desc: "No VAT applied" },
  { value: "VAT_EXCLUSIVE", label: "VAT Exclusive", desc: "+12% on top" },
  { value: "VAT_INCLUSIVE", label: "VAT Inclusive", desc: "12% already in" },
];

/** Applies the legacy VAT rules to a base subtotal:
 *  - NON_VAT: no tax, total = subtotal
 *  - VAT_EXCLUSIVE: tax = subtotal×12%, total = subtotal×1.12
 *  - VAT_INCLUSIVE: tax = subtotal − subtotal/1.12, total = subtotal */
export function applyTax(
  subtotal: number,
  taxType: TaxType
): { taxAmount: number; total: number } {
  const r = (n: number) => Math.round(n * 100) / 100;
  if (taxType === "VAT_EXCLUSIVE") {
    const taxAmount = r(subtotal * VAT_RATE);
    return { taxAmount, total: r(subtotal + taxAmount) };
  }
  if (taxType === "VAT_INCLUSIVE") {
    return { taxAmount: r(subtotal - subtotal / (1 + VAT_RATE)), total: r(subtotal) };
  }
  return { taxAmount: 0, total: r(subtotal) };
}

export function TaxPicker({
  taxType,
  onChange,
}: {
  taxType: TaxType;
  onChange: (t: TaxType) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label className="mb-1">Tax</Label>
      <div className="grid gap-2 sm:grid-cols-3">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-lg border p-3 text-left",
              taxType === o.value
                ? "border-primary ring-1 ring-primary"
                : "hover:bg-accent"
            )}
          >
            <p className="text-sm font-semibold">{o.label}</p>
            <p className="text-xs text-muted-foreground">{o.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
