"use client";

import { useState } from "react";
import { CalculatorIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Tarpaulin calculator — the pilot port of the legacy Tarpauline.html
// wizard: W × H with unit conversion, rate per sqft, eyelets, rush and
// design fees. "Apply" writes the composed description, the computed unit
// price, and the structured specs into the quotation line item.

const UNITS = [
  { value: "ft", label: "ft", toFt: 1 },
  { value: "in", label: "in", toFt: 1 / 12 },
  { value: "cm", label: "cm", toFt: 1 / 30.48 },
  { value: "m", label: "m", toFt: 3.28084 },
] as const;

const EYELETS = ["With Eyelets", "No Eyelet"] as const;

// Legacy flat fees (Banner tab defaults).
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
  initialSpecs,
  onApply,
}: {
  /** Quantity from the line item — flat fees spread across it. */
  qty: number;
  /** Rate per sqft prefill (the Tarpaulin product's base price). */
  defaultRate: number;
  /** Round-trips a previously applied calculation when editing. */
  initialSpecs?: Record<string, unknown> | null;
  onApply: (result: {
    description: string;
    unitPrice: string;
    specs: TarpSpecs;
  }) => void;
}) {
  const saved = (initialSpecs ?? {}) as Partial<TarpSpecs>;
  const [width, setWidth] = useState(saved.width ? String(saved.width) : "");
  const [height, setHeight] = useState(saved.height ? String(saved.height) : "");
  const [unit, setUnit] = useState(saved.unit ?? "ft");
  const [rate, setRate] = useState(
    String(saved.ratePerSqft ?? (defaultRate > 0 ? defaultRate : 50))
  );
  const [eyelet, setEyelet] = useState(saved.eyelet ?? "With Eyelets");
  const [rush, setRush] = useState(saved.rush ?? false);
  const [design, setDesign] = useState(saved.design ?? false);

  const toFt = UNITS.find((u) => u.value === unit)?.toFt ?? 1;
  const w = parseFloat(width) || 0;
  const h = parseFloat(height) || 0;
  const r = parseFloat(rate) || 0;
  const safeQty = qty > 0 ? qty : 1;
  const sqftPerPc = round2(w * toFt * (h * toFt));
  const lineTotal = round2(
    sqftPerPc * safeQty * r + (rush ? RUSH_FEE : 0) + (design ? DESIGN_FEE : 0)
  );
  const unitPrice = round2(lineTotal / safeQty);
  const ready = sqftPerPc > 0 && r > 0;

  const apply = () => {
    const specs: TarpSpecs = {
      calculator: "tarpaulin",
      width: w,
      height: h,
      unit,
      sqftPerPc,
      ratePerSqft: r,
      eyelet,
      rush,
      rushFee: rush ? RUSH_FEE : 0,
      design,
      designFee: design ? DESIGN_FEE : 0,
    };
    const parts = [
      `Tarpaulin ${w} × ${h} ${unit} (${sqftPerPc.toFixed(2)} sqft/pc)`,
      eyelet === "With Eyelets" ? "With eyelets" : "No eyelets",
    ];
    if (rush) parts.push("Rush");
    if (design) parts.push("With design");
    onApply({
      description: parts.join(" · "),
      unitPrice: unitPrice.toFixed(2),
      specs,
    });
  };

  return (
    <div className="grid gap-3 rounded-lg bg-muted/50 p-3">
      <p className="text-xs font-medium text-muted-foreground">
        Tarpaulin calculator
      </p>
      <div className="grid gap-3 sm:grid-cols-[6rem_6rem_5rem_6rem_1fr]">
        <div className="grid gap-1">
          <Label className="text-xs">Width</Label>
          <Input
            inputMode="decimal"
            value={width}
            onChange={(e) => setWidth(e.target.value)}
            placeholder="3"
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Height</Label>
          <Input
            inputMode="decimal"
            value={height}
            onChange={(e) => setHeight(e.target.value)}
            placeholder="6"
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Unit</Label>
          <Select value={unit} onValueChange={(v) => setUnit(v ?? "ft")}>
            <SelectTrigger aria-label="Size unit">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UNITS.map((u) => (
                <SelectItem key={u.value} value={u.value}>
                  {u.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Rate/sqft</Label>
          <Input
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Eyelets</Label>
          <Select
            value={eyelet}
            onValueChange={(v) => setEyelet(v ?? "With Eyelets")}
          >
            <SelectTrigger aria-label="Eyelet option">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EYELETS.map((e) => (
                <SelectItem key={e} value={e}>
                  {e}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={rush}
            onChange={(e) => setRush(e.target.checked)}
          />
          Rush (+₱{RUSH_FEE})
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={design}
            onChange={(e) => setDesign(e.target.checked)}
          />
          Design fee (+₱{DESIGN_FEE})
        </label>
        <span className="ml-auto tabular-nums text-muted-foreground">
          {sqftPerPc.toFixed(2)} sqft/pc × {safeQty} pc
          {ready &&
            ` = ₱${lineTotal.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`}
        </span>
        <Button type="button" size="sm" variant="outline" onClick={apply} disabled={!ready}>
          <CalculatorIcon /> Apply to item
        </Button>
      </div>
    </div>
  );
}
