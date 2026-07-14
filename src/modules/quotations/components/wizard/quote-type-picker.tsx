"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// Quotation-type picker for the final review step of every wizard. The quote
// is ALWAYS saved as a DRAFT — it never flows straight to a JO; it must be
// submitted for supervisor approval first (handled on the detail page).

export type QuoteType = "SALES" | "PO" | "NON_JO";

const OPTIONS: { value: QuoteType; label: string; desc: string }[] = [
  { value: "SALES", label: "Sales Quotation", desc: "Standard sales quote" },
  { value: "PO", label: "PO Quotation", desc: "Against a customer PO" },
  { value: "NON_JO", label: "Non-JO Quotation", desc: "No production job" },
];

export function QuoteTypePicker({
  type,
  poNumber,
  onType,
  onPoNumber,
}: {
  type: QuoteType;
  poNumber: string;
  onType: (t: QuoteType) => void;
  onPoNumber: (v: string) => void;
}) {
  return (
    <div className="grid gap-3">
      <Label className="mb-1">Quotation type</Label>
      <div className="grid gap-2 sm:grid-cols-3">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onType(o.value)}
            className={cn(
              "rounded-lg border p-3 text-left",
              type === o.value
                ? "border-primary ring-1 ring-primary"
                : "hover:bg-accent"
            )}
          >
            <p className="text-sm font-semibold">{o.label}</p>
            <p className="text-xs text-muted-foreground">{o.desc}</p>
          </button>
        ))}
      </div>
      {type === "PO" && (
        <div className="grid gap-1.5">
          <Label htmlFor="qt-po">
            PO Number <span className="text-destructive">*</span>
          </Label>
          <Input
            id="qt-po"
            placeholder="Customer's PO reference"
            value={poNumber}
            onChange={(e) => onPoNumber(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
