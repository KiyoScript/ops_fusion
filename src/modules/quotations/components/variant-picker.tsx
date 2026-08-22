"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ProductRuleDto } from "@/modules/shared/hooks/use-products";

// Variant/tier picker for products with VARIANT price rules (Mug types,
// Frame matting, Bookbinding types, …). Rendered as selectable cards (same as
// the guided wizard) — not a dropdown. Picking a variant resolves the qty tier
// and writes the unit price; when the qty later crosses a tier boundary, an
// explicit "Apply tier" button offers the new price — the price is never
// changed behind the user's back.

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

  const resolved = currentVariant
    ? resolveTierPrice(rules, currentVariant, qty)
    : null;
  const tierMismatch =
    resolved !== null &&
    parseFloat(resolved.price) !== parseFloat(currentUnitPrice || "0");

  return (
    <div className="grid gap-2 rounded-lg bg-muted/50 p-3">
      <Label className="text-xs">Variant</Label>
      <div
        role="radiogroup"
        aria-label="Product variant"
        className="grid gap-2 grid-cols-[repeat(auto-fit,minmax(13rem,1fr))]"
      >
        {labels.map((label) => {
          const tiers = rules
            .filter((r) => r.type === "VARIANT" && r.label === label && r.unitPrice)
            .sort((a, b) => a.minQty - b.minQty);
          const tier = resolveTierPrice(rules, label, qty);
          const selected = currentVariant === label;
          return (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                if (tier) onPick(label, tier.price);
              }}
              className={cn(
                "grid gap-1.5 rounded-lg border bg-background p-3 text-left transition-colors",
                selected
                  ? "border-primary ring-1 ring-primary"
                  : "hover:bg-accent/40"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="text-sm font-semibold wrap-break-word">
                  {label}
                </span>
                {tier && (
                  <span className="shrink-0 text-base font-bold tabular-nums text-primary">
                    ₱{tier.price}
                  </span>
                )}
              </div>
              {tiers.length > 1 && (
                // Qty tiers as an aligned mini-grid (qty → price); the tier that
                // matches the current qty is highlighted so it reads at a glance.
                <div className="grid grid-cols-[repeat(auto-fit,minmax(4.5rem,1fr))] gap-x-3 gap-y-0.5 border-t border-border/60 pt-1.5 text-xs tabular-nums">
                  {tiers.map((t) => {
                    const active = tier != null && t.minQty === tier.minQty;
                    return (
                      <span
                        key={t.minQty}
                        className={cn(
                          "flex items-baseline justify-between gap-1",
                          active
                            ? "font-semibold text-primary"
                            : "text-muted-foreground"
                        )}
                      >
                        <span>{t.minQty > 1 ? `${t.minQty}+` : "1+"}</span>
                        <span>₱{t.unitPrice}</span>
                      </span>
                    );
                  })}
                </div>
              )}
            </button>
          );
        })}
      </div>
      {tierMismatch && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="justify-self-start"
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
