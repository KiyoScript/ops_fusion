"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { createQuotationAction } from "@/app/(app)/quotations/actions";
import type { ProductOptionDto } from "@/modules/shared/hooks/use-products";
import { WizardShell } from "./wizard-shell";
import {
  ClientInfoStep,
  EMPTY_CLIENT,
  isClientValid,
  type ClientInfo,
} from "./client-info-step";
import { QuoteTypePicker, type QuoteType } from "./quote-type-picker";

// Tarpaulin per-product wizard — 1:1 with legacy Tarpauline.html:
// Client Info → Dimensions → Eyelet → Print Layout → Quotation review.

const STEPS = [
  { label: "Client Info", sub: "Name, contact & date needed" },
  { label: "Dimensions", sub: "Width × height, quantity & sq ft" },
  { label: "Eyelet", sub: "Eyelet position for hanging" },
  { label: "Print Layout", sub: "Rush order & design fee" },
  { label: "Quotation", sub: "Review & create" },
] as const;

const UNITS = [
  { value: "ft", label: "Feet", toFt: 1 },
  { value: "m", label: "Meters", toFt: 3.28084 },
  { value: "cm", label: "cm", toFt: 1 / 30.48 },
  { value: "in", label: "Inches", toFt: 1 / 12 },
] as const;

const EYELETS = [
  { value: "No Eyelet", desc: "Plain edges, no hanging holes" },
  { value: "Top Only", desc: "Eyelets along the top edge" },
  { value: "All Sides", desc: "Eyelets on every side" },
] as const;

const round2 = (n: number) => Math.round(n * 100) / 100;
const php = (n: number) =>
  `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;

function rate(product: ProductOptionDto): number {
  const variant = product.rules.find((r) => r.type === "VARIANT" && r.unitPrice);
  return parseFloat(variant?.unitPrice ?? product.basePrice) || 50;
}
function addon(product: ProductOptionDto, pattern: RegExp): number {
  const a = product.rules.find(
    (r) => r.type === "ADDON" && pattern.test(r.label) && r.amount
  );
  return parseFloat(a?.amount ?? "") || 0;
}

export function TarpaulinWizard({
  product,
  inquiryId,
}: {
  product: ProductOptionDto;
  inquiryId?: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const [client, setClient] = useState<ClientInfo>(EMPTY_CLIENT);
  const [unit, setUnit] = useState<string>("ft");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [qty, setQty] = useState("1");
  const [eyelet, setEyelet] = useState<string>("No Eyelet");
  const [rush, setRush] = useState(false);
  const [design, setDesign] = useState(false);
  const [notes, setNotes] = useState("");
  const [quoteType, setQuoteType] = useState<QuoteType>("SALES");
  const [poNumber, setPoNumber] = useState("");

  const ratePerSqft = rate(product);
  const rushFee = addon(product, /rush/i) || 150;
  const designFee = addon(product, /design/i) || 250;

  const calc = useMemo(() => {
    const toFt = UNITS.find((u) => u.value === unit)?.toFt ?? 1;
    const wFt = (parseFloat(width) || 0) * toFt;
    const hFt = (parseFloat(height) || 0) * toFt;
    const q = Math.max(parseInt(qty, 10) || 0, 0);
    const sqftPerPc = round2(wFt * hFt);
    const totalSqft = round2(sqftPerPc * q);
    const base = round2(totalSqft * ratePerSqft);
    const total = round2(
      base + (rush ? rushFee : 0) + (design ? designFee : 0)
    );
    return { wFt, hFt, q, sqftPerPc, totalSqft, base, total };
  }, [unit, width, height, qty, ratePerSqft, rush, rushFee, design, designFee]);

  const stepValid = (i: number): boolean => {
    if (i === 0) return isClientValid(client);
    if (i === 1) return calc.totalSqft > 0 && calc.q >= 1;
    return true;
  };

  const next = () => {
    if (!stepValid(step)) {
      toast.error(
        step === 0
          ? "Client name is required."
          : "Enter width, height, and quantity."
      );
      return;
    }
    if (step < STEPS.length - 1) setStep(step + 1);
    else submit();
  };

  const submit = () => {
    if (quoteType === "PO" && !poNumber.trim()) {
      toast.error("PO number is required for a PO quotation.");
      return;
    }
    setSubmitting(true);
    const descParts = [
      `Tarpaulin — ${calc.wFt.toFixed(2)} × ${calc.hFt.toFixed(2)} ft × ${calc.q} pc (${calc.totalSqft.toFixed(2)} sqft)`,
    ];
    if (eyelet !== "No Eyelet") descParts.push(`Eyelet: ${eyelet}`);
    if (rush) descParts.push("Rush");
    if (design) descParts.push("With design");

    const noteLines = [
      client.contactNumber && `Contact: ${client.contactNumber}`,
      client.email && `Email: ${client.email}`,
      client.dateNeeded && `Date needed: ${client.dateNeeded}`,
      notes,
    ].filter(Boolean);

    startCreate();

    async function startCreate() {
      const result = await createQuotationAction({
        type: quoteType,
        poNumber: quoteType === "PO" ? poNumber.trim() : undefined,
        customerName: client.customerName,
        validUntil: "",
        taxType: "NON_VAT",
        paymentTermLabel: "50% Downpayment",
        downpaymentRate: "0.5",
        notes: noteLines.join("\n"),
        inquiryId,
        items: [
          {
            productId: product.id,
            description: descParts.join(" · "),
            qty: String(calc.q),
            unitPrice: round2(calc.total / calc.q).toFixed(2),
            specs: {
              calculator: "tarpaulin",
              width: calc.wFt,
              height: calc.hFt,
              unit: "ft",
              sqftPerPc: calc.sqftPerPc,
              ratePerSqft,
              eyelet,
              rush,
              rushFee: rush ? rushFee : 0,
              design,
              designFee: design ? designFee : 0,
            },
          },
        ],
      });
      setSubmitting(false);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Quotation ${result.data.quoteNumber} created.`);
      router.push(`/quotations/${result.data.id}`);
      router.refresh();
    }
  };

  return (
    <WizardShell
      title={
        <span>
          TARPAULIN <span className="text-primary">QUOTATION</span>
        </span>
      }
      subtitle="Complete each step to generate a tarpaulin quotation."
      badge={`₱${ratePerSqft}/sq ft`}
      steps={STEPS as unknown as { label: string; sub?: string }[]}
      current={step}
      onJump={setStep}
      onBack={() => setStep(Math.max(step - 1, 0))}
      onNext={next}
      nextDisabled={submitting}
      nextLabel={
        submitting
          ? "Creating…"
          : step === STEPS.length - 1
            ? "Create quotation"
            : undefined
      }
    >
      {step === 0 && <ClientInfoStep value={client} onChange={setClient} />}

      {step === 1 && (
        <div className="grid gap-5">
          <div className="grid gap-1.5">
            <Label>Unit of Measurement</Label>
            <div className="flex flex-wrap gap-2">
              {UNITS.map((u) => (
                <button
                  key={u.value}
                  type="button"
                  onClick={() => setUnit(u.value)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-sm font-medium",
                    unit === u.value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:bg-accent"
                  )}
                >
                  {u.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="tw-w">
                Width ({unit}) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="tw-w"
                inputMode="decimal"
                placeholder="0"
                value={width}
                onChange={(e) => setWidth(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="tw-h">
                Height ({unit}) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="tw-h"
                inputMode="decimal"
                placeholder="0"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="tw-q">
                Quantity <span className="text-destructive">*</span>
              </Label>
              <Input
                id="tw-q"
                inputMode="numeric"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border bg-muted/40 p-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Total Billable Area
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {calc.wFt ? calc.wFt.toFixed(2) : "?"} ×{" "}
                {calc.hFt ? calc.hFt.toFixed(2) : "?"} ft × {calc.q} pc(s)
              </p>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold text-primary tabular-nums">
                {calc.totalSqft > 0 ? calc.totalSqft.toFixed(2) : "—"}
              </p>
              <p className="text-xs text-muted-foreground">sq ft total</p>
            </div>
          </div>
          {calc.base > 0 && (
            <div className="flex items-center gap-2 rounded-md bg-primary/5 px-4 py-2 text-sm">
              <span>
                At <strong>{php(ratePerSqft)}/sq ft</strong>
              </span>
              <strong className="ml-auto text-primary">
                = {php(calc.base)}
              </strong>
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="grid gap-2">
          <Label className="mb-1">Select Eyelet Position</Label>
          {EYELETS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setEyelet(o.value)}
              className={cn(
                "flex items-center gap-3 rounded-lg border p-3 text-left",
                eyelet === o.value
                  ? "border-primary ring-1 ring-primary"
                  : "hover:bg-accent"
              )}
            >
              <div className="flex-1">
                <p className="text-sm font-semibold">{o.value}</p>
                <p className="text-xs text-muted-foreground">{o.desc}</p>
              </div>
              <span className="text-xs font-bold text-muted-foreground">
                {o.value === "No Eyelet" ? "NONE" : "INCLUDED"}
              </span>
            </button>
          ))}
        </div>
      )}

      {step === 3 && (
        <div className="grid gap-5">
          <ToggleCard
            label="Rush Order?"
            selected={rush}
            onSelect={setRush}
            offTitle="Standard — No Rush"
            offSub="Normal production timeline"
            onTitle="Rush Order"
            onSub="Priority production — additional fee applies"
            onValue={`+${php(rushFee)}`}
          />
          <ToggleCard
            label="Design Fee?"
            selected={design}
            onSelect={setDesign}
            offTitle="No Design Needed"
            offSub="Customer provides the ready-to-print file"
            onTitle="Needs Design"
            onSub="We create the layout — design fee applies"
            onValue={`+${php(designFee)}`}
          />
          <div className="grid gap-1.5">
            <Label htmlFor="tw-notes">
              Special Instructions{" "}
              <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="tw-notes"
              rows={3}
              placeholder="Layout details, color notes, delivery, special requests…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="grid gap-4">
          <ReviewRow label="Client" value={client.customerName} />
          {client.contactNumber && (
            <ReviewRow label="Contact" value={client.contactNumber} />
          )}
          <ReviewRow
            label="Tarpaulin"
            value={`${calc.wFt.toFixed(2)} × ${calc.hFt.toFixed(2)} ft × ${calc.q} pc (${calc.totalSqft.toFixed(2)} sqft)`}
          />
          <ReviewRow label="Eyelet" value={eyelet} />
          <ReviewRow label="Rush" value={rush ? `Yes (+${php(rushFee)})` : "No"} />
          <ReviewRow
            label="Design"
            value={design ? `Yes (+${php(designFee)})` : "No"}
          />
          <div className="mt-2 flex items-center justify-between border-t pt-4">
            <span className="text-base font-semibold">Total</span>
            <span className="text-2xl font-bold text-primary tabular-nums">
              {php(calc.total)}
            </span>
          </div>

          <div className="border-t pt-4">
            <QuoteTypePicker
              type={quoteType}
              poNumber={poNumber}
              onType={setQuoteType}
              onPoNumber={setPoNumber}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Creates a DRAFT quotation — it does not become a Job Order yet. It
            must be submitted for supervisor approval first. Tax and payment
            terms are editable afterwards.
          </p>
        </div>
      )}
    </WizardShell>
  );
}

function ToggleCard({
  label,
  selected,
  onSelect,
  offTitle,
  offSub,
  onTitle,
  onSub,
  onValue,
}: {
  label: string;
  selected: boolean;
  onSelect: (v: boolean) => void;
  offTitle: string;
  offSub: string;
  onTitle: string;
  onSub: string;
  onValue: string;
}) {
  return (
    <div className="grid gap-2">
      <Label className="mb-1">{label}</Label>
      <button
        type="button"
        onClick={() => onSelect(false)}
        className={cn(
          "flex items-center gap-3 rounded-lg border p-3 text-left",
          !selected ? "border-primary ring-1 ring-primary" : "hover:bg-accent"
        )}
      >
        <div className="flex-1">
          <p className="text-sm font-semibold">{offTitle}</p>
          <p className="text-xs text-muted-foreground">{offSub}</p>
        </div>
        <span className="text-xs font-bold text-muted-foreground">
          {label.includes("Design") ? "FREE" : "STANDARD"}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onSelect(true)}
        className={cn(
          "flex items-center gap-3 rounded-lg border p-3 text-left",
          selected ? "border-primary ring-1 ring-primary" : "hover:bg-accent"
        )}
      >
        <div className="flex-1">
          <p className="text-sm font-semibold">{onTitle}</p>
          <p className="text-xs text-muted-foreground">{onSub}</p>
        </div>
        <span className="text-xs font-bold text-primary">{onValue}</span>
      </button>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
