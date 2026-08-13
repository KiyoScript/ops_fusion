"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// Tarpaulin calculator — the pilot port of the legacy Tarpauline.html wizard:
// W × H with unit conversion, rate per sqft, eyelets (spec only — no price
// effect, per legacy calcTarpTotal), rush and design fees. Shares the design
// language of the area calculator (unit pills, fee cards) so the two read as
// one system. Auto-applies live: the composed description, computed unit price,
// and structured specs are written into the line item on every change.

const UNITS = [
  { value: "ft", label: "Feet", toFt: 1 },
  { value: "in", label: "Inches", toFt: 1 / 12 },
  { value: "cm", label: "cm", toFt: 1 / 30.48 },
  { value: "m", label: "Meters", toFt: 3.28084 },
] as const;

const EYELETS = ["With Eyelets", "No Eyelet"] as const;

// Fallbacks when the Tarpaulin product has no price rules (legacy Banner
// tab defaults) — normally the seeded PriceRules override these.
const RUSH_FEE = 150;
const DESIGN_FEE = 250;

const round2 = (n: number): number => Math.round(n * 100) / 100;

export type TarpSpecs = {
  calculator: "tarpaulin";
  width: number;
  height: number;
  unit: string;
  sqftPerPc: number;
  ratePerSqft: number;
  eyelet: string;
  rush: boolean;
  rushFee: number;
  design: boolean;
  designFee: number;
};

export function TarpCalculator({
  qty,
  defaultRate,
  rules,
  initialSpecs,
  onApply,
}: {
  /** Quantity from the line item — flat fees spread across it. */
  qty: number;
  /** Rate per sqft prefill (the Tarpaulin product's base price). */
  defaultRate: number;
  /** Tarpaulin PriceRules: VARIANT rate + rush/design ADDON amounts. */
  rules?: {
    type: "VARIANT" | "ADDON";
    label: string;
    unitPrice: string | null;
    amount: string | null;
  }[];
  /** Round-trips a previously applied calculation when editing. */
  initialSpecs?: Record<string, unknown> | null;
  onApply: (result: {
    description: string;
    unitPrice: string;
    specs: TarpSpecs;
  }) => void;
}) {
  const ruleRate = rules?.find((r) => r.type === "VARIANT" && r.unitPrice);
  const ruleAddon = (pattern: RegExp) =>
    rules?.find((r) => r.type === "ADDON" && pattern.test(r.label) && r.amount);
  const rushFee = parseFloat(ruleAddon(/rush/i)?.amount ?? "") || RUSH_FEE;
  const designFee = parseFloat(ruleAddon(/design/i)?.amount ?? "") || DESIGN_FEE;
  const baseRate =
    parseFloat(ruleRate?.unitPrice ?? "") || (defaultRate > 0 ? defaultRate : 50);

  const saved = (initialSpecs ?? {}) as Partial<TarpSpecs>;
  const [width, setWidth] = useState(saved.width ? String(saved.width) : "");
  const [height, setHeight] = useState(saved.height ? String(saved.height) : "");
  const [unit, setUnit] = useState(saved.unit ?? "ft");
  const [rate, setRate] = useState(String(saved.ratePerSqft ?? baseRate));
  const [eyelet, setEyelet] = useState<string>(saved.eyelet ?? "With Eyelets");
  const [rush, setRush] = useState(saved.rush ?? false);
  const [design, setDesign] = useState(saved.design ?? false);

  const toFt = UNITS.find((u) => u.value === unit)?.toFt ?? 1;
  const w = parseFloat(width) || 0;
  const h = parseFloat(height) || 0;
  const r = parseFloat(rate) || 0;
  const safeQty = qty > 0 ? qty : 1;
  const sqftPerPc = round2(w * toFt * (h * toFt));
  const lineTotal = round2(
    sqftPerPc * safeQty * r + (rush ? rushFee : 0) + (design ? designFee : 0)
  );
  const unitPrice = round2(lineTotal / safeQty);
  const ready = sqftPerPc > 0 && r > 0;

  const specs: TarpSpecs = {
    calculator: "tarpaulin",
    width: w,
    height: h,
    unit,
    sqftPerPc,
    ratePerSqft: r,
    eyelet,
    rush,
    rushFee: rush ? rushFee : 0,
    design,
    designFee: design ? designFee : 0,
  };
  const parts = [
    `Tarpaulin ${w} × ${h} ${unit} (${sqftPerPc.toFixed(2)} sqft/pc)`,
    eyelet === "With Eyelets" ? "With eyelets" : "No eyelets",
  ];
  if (rush) parts.push("Rush");
  if (design) parts.push("With design");
  const result = {
    description: parts.join(" · "),
    unitPrice: unitPrice.toFixed(2),
    specs,
  };

  // Auto-apply (skip mount): keep the line item in sync as the calculator fills
  // so the composed description + price + specs are written WITHOUT a manual
  // click. Skipping the first run means opening the editor never clobbers an
  // existing line (e.g. a restored draft with its own description).
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
  }, [w, h, r, unit, eyelet, rush, design, safeQty, ready]);

  const fees = [
    { key: "rush", label: "Rush", fee: rushFee, on: rush, toggle: () => setRush((v) => !v) },
    { key: "design", label: "Design fee", fee: designFee, on: design, toggle: () => setDesign((v) => !v) },
  ];

  return (
    <div className="grid gap-3 rounded-lg bg-muted/50 p-3">
      <p className="text-xs font-medium text-muted-foreground">
        Tarpaulin calculator
      </p>

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

      <div className="grid gap-3 sm:grid-cols-3">
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
        <div className="grid gap-1">
          <Label className="text-xs">Rate/sqft</Label>
          <Input
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label className="text-xs">Eyelets</Label>
        <div className="flex flex-wrap gap-2">
          {EYELETS.map((e) => {
            const selected = eyelet === e;
            return (
              <button
                key={e}
                type="button"
                onClick={() => setEyelet(e)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "hover:bg-accent"
                )}
              >
                {e}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label className="text-xs">Add-ons / fees (optional)</Label>
        <div
          role="group"
          aria-label="Add-on fees"
          className="grid gap-2 grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]"
        >
          {fees.map((f) => (
            <button
              key={f.key}
              type="button"
              role="checkbox"
              aria-checked={f.on}
              onClick={f.toggle}
              className={cn(
                "flex items-center justify-between gap-2 rounded-lg border bg-background p-3 text-left text-sm transition-colors",
                f.on ? "border-primary ring-1 ring-primary" : "hover:bg-accent/40"
              )}
            >
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded border",
                    f.on
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-muted-foreground/40"
                  )}
                >
                  {f.on && <CheckIcon className="size-3" />}
                </span>
                <span className="font-medium">{f.label}</span>
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                +₱{f.fee}
              </span>
            </button>
          ))}
        </div>
      </div>

      {ready && (
        <div className="flex items-center justify-between rounded-md bg-primary/5 px-4 py-2 text-sm">
          <span className="tabular-nums text-muted-foreground">
            {sqftPerPc.toFixed(2)} sqft/pc × {safeQty} pc × ₱{r}
          </span>
          <strong className="text-primary tabular-nums">
            ₱{lineTotal.toLocaleString("en-PH", { minimumFractionDigits: 2 })}
          </strong>
        </div>
      )}
    </div>
  );
}
