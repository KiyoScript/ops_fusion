"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProductRuleDto } from "@/modules/shared/hooks/use-products";

// Variant/tier picker for products with VARIANT price rules (Mug types,
// Frame matting, Bookbinding types, …). Picking a variant resolves the qty
// tier and writes the unit price; when the qty later crosses a tier
// boundary, an explicit "Apply tier" button offers the new price — the
// price is never changed behind the user's back.

/** Highest tier whose minQty the qty satisfies (else the lowest tier). */
export function resolveTierPrice(
  rules: ProductRuleDto[],
  label: string,
  qty: number
): { price: string; minQty: number } | null {
  const tiers = rules
    .filter((r) => r.type === "VARIANT" && r.label === label && r.unitPrice)
    .sort((a, b) => a.minQty - b.minQty);
  if (tiers.length === 0) return null;
  const eligible = tiers.filter((t) => qty >= t.minQty);
  const tier = eligible.length ? eligible[eligible.length - 1]! : tiers[0]!;
  return { price: tier.unitPrice!, minQty: tier.minQty };
}

export function VariantPicker({
  rules,
  qty,
  currentVariant,
  currentUnitPrice,
  onPick,
}: {
  rules: ProductRuleDto[];
  qty: number;
  /** Variant label stored in the item's specs (round-trips on edit). */
  currentVariant: string | null;
  currentUnitPrice: string;
  onPick: (label: string, price: string) => void;
}) {
  const labels = [
    ...new Set(rules.filter((r) => r.type === "VARIANT").map((r) => r.label)),
  ];
  if (labels.length < 2 && !hasTiers(rules)) return null;

  const tierHint = currentVariant
    ? rules
        .filter(
          (r) =>
            r.type === "VARIANT" && r.label === currentVariant && r.unitPrice
        )
        .sort((a, b) => a.minQty - b.minQty)
        .map((t) => `₱${t.unitPrice}${t.minQty > 1 ? ` @${t.minQty}+` : ""}`)
        .join(" · ")
    : null;

  const resolved = currentVariant
    ? resolveTierPrice(rules, currentVariant, qty)
    : null;
  const tierMismatch =
    resolved !== null &&
    parseFloat(resolved.price) !== parseFloat(currentUnitPrice || "0");

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg bg-muted/50 p-3">
      <div className="grid min-w-56 gap-1">
        <Label className="text-xs">Variant</Label>
        <Select
          value={currentVariant ?? ""}
          onValueChange={(label) => {
            if (!label) return;
            const tier = resolveTierPrice(rules, label, qty);
            if (tier) onPick(label, tier.price);
          }}
        >
          <SelectTrigger aria-label="Product variant">
            <SelectValue placeholder="Pick a variant…" />
          </SelectTrigger>
          <SelectContent>
            {labels.map((label) => (
              <SelectItem key={label} value={label}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {tierHint && (
        <p className="pb-2 text-xs tabular-nums text-muted-foreground">
          {tierHint}
        </p>
      )}
      {tierMismatch && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onPick(currentVariant!, resolved.price)}
        >
          Qty {qty} tier: apply ₱{resolved.price}
        </Button>
      )}
    </div>
  );
}

function hasTiers(rules: ProductRuleDto[]): boolean {
  return rules.some((r) => r.type === "VARIANT" && r.minQty > 1);
}
