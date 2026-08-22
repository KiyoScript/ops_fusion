"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ProductRuleDto } from "@/modules/shared/hooks/use-products";

// Area calculator — for products priced by the square foot (Signage, Acrylic
// Display, Stickers, Canvas, Frame, …). Ports the legacy generic-wizard
// "isArea" path: W × H with unit conversion → sqft, multiplied by a per-sqft
// rate (from the chosen VARIANT tier, else the product base price), with a
// minimum-charge floor, then optional ADDON fees folded into the line. Writes
// the composed description, the per-piece unit price, and structured specs into
// the quotation line — live, so the item never stays a bare product name.

const UNITS = [
  { value: "ft", label: "Feet", toFt: 1 },
  { value: "in", label: "Inches", toFt: 1 / 12 },
  { value: "cm", label: "cm", toFt: 1 / 30.48 },
  { value: "m", label: "Meters", toFt: 3.28084 },
] as const;

const round2 = (n: number): number => Math.round(n * 100) / 100;

export type AreaSpecs = {
  calculator: "area";
  variant: string | null;
  unit: string;
  width: number;
  height: number;
  area: number;
  ratePerSqft: number;
  minCharge: number;
  addons: string[];
  baseUnit: string;
};

export function AreaCalculator({
  productName,
  basePrice,
  qty,
  rules,
  initialSpecs,
  onApply,
}: {
  productName: string;
  /** Fallback per-sqft rate when the product has no VARIANT tiers. */
  basePrice: number;
  /** Quantity from the line item — the min-charge floor and fees span it. */
  qty: number;
  /** Product PriceRules merged with global add-ons: VARIANT rates + ADDON fees. */
  rules: ProductRuleDto[];
  /** Round-trips a previously applied calculation when editing. */
  initialSpecs?: Record<string, unknown> | null;
  onApply: (result: {
    description: string;
    unitPrice: string;
    specs: AreaSpecs;
  }) => void;
}) {
  // Distinct VARIANT labels; area pricing ignores qty tiers — the legacy wizard
  // used tiers[0] — so each label resolves to its lowest-minQty tier.
  const variantLabels = [
    ...new Set(
      rules.filter((r) => r.type === "VARIANT" && r.unitPrice).map((r) => r.label)
    ),
  ];
  const tierFor = (label: string) =>
    rules
      .filter((r) => r.type === "VARIANT" && r.label === label && r.unitPrice)
      .sort((a, b) => a.minQty - b.minQty)[0] ?? null;
  // Per-line add-ons only; whole-JO ones live in the quotation-wide section.
  const fees = rules.filter((r) => r.type === "ADDON" && r.scope !== "WHOLE_JO");

  const saved = (initialSpecs ?? {}) as Partial<AreaSpecs>;
  const [variant, setVariant] = useState<string | null>(
    saved.variant ?? (variantLabels.length === 1 ? variantLabels[0]! : null)
  );
  const [unit, setUnit] = useState(saved.unit ?? "ft");
  const [width, setWidth] = useState(saved.width ? String(saved.width) : "");
  const [height, setHeight] = useState(saved.height ? String(saved.height) : "");
  const [checked, setChecked] = useState<string[]>(saved.addons ?? []);

  // Rate + minimum charge from the chosen variant, falling back to the base price.
  const tier = variant ? tierFor(variant) : null;
  const rate = tier ? parseFloat(tier.unitPrice ?? "0") || 0 : basePrice;
  const minCharge = tier ? parseFloat(tier.minCharge ?? "0") || 0 : 0;

  const toFt = UNITS.find((u) => u.value === unit)?.toFt ?? 1;
  const w = parseFloat(width) || 0;
  const h = parseFloat(height) || 0;
  const safeQty = qty > 0 ? qty : 1;
  const area = round2(w * toFt * (h * toFt));

  const lineBase = round2(Math.max(area * rate * safeQty, minCharge));
  let addonTotal = 0;
  for (const f of fees) {
    if (!checked.includes(f.label)) continue;
    addonTotal += f.pct
      ? lineBase * (parseFloat(f.pct) / 100)
      : parseFloat(f.amount ?? "0");
  }
  addonTotal = round2(addonTotal);
  const lineTotal = round2(lineBase + addonTotal);
  const unitPrice = round2(lineTotal / safeQty);
  const ready = area > 0 && rate > 0;

  const specs: AreaSpecs = {
    calculator: "area",
    variant,
    unit,
    width: w,
    height: h,
    area,
    ratePerSqft: rate,
    minCharge,
    addons: checked,
    baseUnit: round2(area * rate).toFixed(2),
  };
  const parts = [
    `${productName}${variant ? ` — ${variant}` : ""}`,
    `${w} × ${h} ${unit} (${area.toFixed(2)} sqft/pc)`,
  ];
  for (const label of checked) parts.push(label);
  const result = {
    description: parts.join(" · "),
    unitPrice: unitPrice.toFixed(2),
    specs,
  };

  // Live-apply (skip the first mount so opening the editor never clobbers an
  // existing line) — same pattern as the tarp calculator.
  const onApplyRef = useRef(onApply);
  useEffect(() => {
    onApplyRef.current = onApply;
  });
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (ready) onApplyRef.current(result);
    // `result` is derived from these values; re-run only when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, unit, w, h, safeQty, ready, checked.join("|")]);

  const toggle = (label: string) =>
    setChecked((c) =>
      c.includes(label) ? c.filter((l) => l !== label) : [...c, label]
    );

  return (
    <div className="grid gap-3 rounded-lg bg-muted/50 p-3">
      <p className="text-xs font-medium text-muted-foreground">
        Area calculator (priced per sqft)
      </p>

      {variantLabels.length > 1 && (
        <div className="grid gap-1.5">
          <Label className="text-xs">Variant</Label>
          <div
            role="radiogroup"
            aria-label="Variant"
            className="grid gap-2 grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]"
          >
            {variantLabels.map((label) => {
              const t = tierFor(label);
              const selected = variant === label;
              return (
                <button
                  key={label}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setVariant(label)}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-lg border bg-background p-3 text-left transition-colors",
                    selected
                      ? "border-primary ring-1 ring-primary"
                      : "hover:bg-accent/40"
                  )}
                >
                  <span className="text-sm font-semibold">{label}</span>
                  {t && (
                    <span className="shrink-0 text-sm font-bold tabular-nums text-primary">
                      ₱{t.unitPrice}/sqft
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {UNITS.map((u) => {
          const selected = unit === u.value;
          return (
            <button
              key={u.value}
              type="button"
              onClick={() => setUnit(u.value)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-accent"
              )}
            >
              {u.label}
            </button>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <div className="grid gap-1">
          <Label className="text-xs">Width ({unit})</Label>
          <Input
            inputMode="decimal"
            value={width}
            onChange={(e) => setWidth(e.target.value)}
            placeholder="3"
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Height ({unit})</Label>
          <Input
            inputMode="decimal"
            value={height}
            onChange={(e) => setHeight(e.target.value)}
            placeholder="6"
          />
        </div>
        <div className="grid content-end">
          <span className="text-xs text-muted-foreground">Rate/sqft</span>
          <span className="pb-2 text-sm font-semibold tabular-nums">
            {rate > 0
              ? `₱${rate.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`
              : "—"}
          </span>
        </div>
      </div>

      {fees.length > 0 && (
        <div className="grid gap-1.5">
          <Label className="text-xs">Add-ons / fees (optional)</Label>
          <div
            role="group"
            aria-label="Add-on fees"
            className="grid gap-2 grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]"
          >
            {fees.map((f) => {
              const on = checked.includes(f.label);
              return (
                <button
                  key={f.label}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => toggle(f.label)}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-lg border bg-background p-3 text-left text-sm transition-colors",
                    on
                      ? "border-primary ring-1 ring-primary"
                      : "hover:bg-accent/40"
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded border",
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/40"
                      )}
                    >
                      {on && <CheckIcon className="size-3" />}
                    </span>
                    <span className="font-medium">{f.label}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {f.pct ? `+${f.pct}%` : `+₱${f.amount}`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {ready && (
        <div className="flex items-center justify-between rounded-md bg-primary/5 px-4 py-2 text-sm">
          <span className="tabular-nums text-muted-foreground">
            {area.toFixed(2)} sqft/pc × {safeQty} pc × ₱{rate}
            {minCharge > 0 && lineBase === minCharge ? " (min charge)" : ""}
          </span>
          <strong className="text-primary tabular-nums">
            ₱{lineTotal.toLocaleString("en-PH", { minimumFractionDigits: 2 })}
          </strong>
        </div>
      )}
    </div>
  );
}
