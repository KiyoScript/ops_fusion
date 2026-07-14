"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { NumberField } from "@/components/validated-fields";
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
import { TaxPicker, applyTax, type TaxType } from "./tax-picker";

// Signage per-product wizard — 1:1 with legacy Index.html (7 steps):
// Client Info → Signage Type → Dimensions → Mounting → Add-ons → Design →
// Quotation. Pricing mirrors the legacy math:
//   base = max(sqft × rate, minCharge)
//   + mounting fee + complexity surcharges (% of base or flat) + add-ons

const STEPS = [
  { label: "Client Info", sub: "Name, contact & delivery location" },
  { label: "Signage Type", sub: "Type & material" },
  { label: "Dimensions", sub: "Width × height → sq ft auto-computed" },
  { label: "Mounting", sub: "Installation & mounting option" },
  { label: "Add-ons", sub: "Complexity, electrical & transport" },
  { label: "Design", sub: "Artwork & rush service" },
  { label: "Quotation", sub: "Full breakdown & downpayment" },
] as const;

const UNITS = [
  { value: "ft", label: "Feet", toFt: 1 },
  { value: "m", label: "Meters", toFt: 3.28084 },
  { value: "cm", label: "cm", toFt: 1 / 30.48 },
  { value: "in", label: "Inches", toFt: 1 / 12 },
] as const;

const round2 = (n: number) => Math.round(n * 100) / 100;
const php = (n: number) =>
  `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;

type Variant = { label: string; rate: number; minCharge: number };
type Addon = { label: string; amount: number; pct: number };

export function SignageWizard({
  product,
  inquiryId,
}: {
  product: ProductOptionDto;
  inquiryId?: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // Split the product's rules into the wizard's building blocks.
  const { variants, mountings, complexity, designFee, rushFee, elec, transport } =
    useMemo(() => {
      const variants: Variant[] = product.rules
        .filter((r) => r.type === "VARIANT" && r.unitPrice)
        .map((r) => ({
          label: r.label,
          rate: parseFloat(r.unitPrice!),
          minCharge: parseFloat(r.minCharge ?? "0") || 0,
        }));
      const addon = (pattern: RegExp): Addon | undefined => {
        const r = product.rules.find(
          (x) => x.type === "ADDON" && pattern.test(x.label)
        );
        return r
          ? {
              label: r.label,
              amount: parseFloat(r.amount ?? "0") || 0,
              pct: parseFloat(r.pct ?? "0") || 0,
            }
          : undefined;
      };
      const byPrefix = (prefix: string): Addon[] =>
        product.rules
          .filter((r) => r.type === "ADDON" && r.label.startsWith(prefix))
          .map((r) => ({
            label: r.label.replace(prefix, "").trim(),
            amount: parseFloat(r.amount ?? "0") || 0,
            pct: parseFloat(r.pct ?? "0") || 0,
          }));
      return {
        variants,
        mountings: byPrefix("Mounting:"),
        complexity: byPrefix("Complexity:"),
        designFee: addon(/^Design/i)?.amount ?? 250,
        rushFee: addon(/^Rush/i)?.amount ?? 250,
        elec: addon(/^Electrical/i)?.amount ?? 0,
        transport: addon(/^Transport/i)?.amount ?? 0,
      };
    }, [product.rules]);

  const [client, setClient] = useState<ClientInfo>(EMPTY_CLIENT);
  const [address, setAddress] = useState("");
  const [variantIdx, setVariantIdx] = useState<number | null>(null);
  const [material, setMaterial] = useState("");
  const [unit, setUnit] = useState("ft");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [mountIdx, setMountIdx] = useState<number>(
    mountings.length ? 0 : -1
  );
  const [checkedComplexity, setCheckedComplexity] = useState<Set<number>>(
    new Set()
  );
  const [useElec, setUseElec] = useState(false);
  const [useTransport, setUseTransport] = useState(false);
  const [design, setDesign] = useState(false);
  const [rush, setRush] = useState(false);
  const [notes, setNotes] = useState("");
  const [quoteType, setQuoteType] = useState<QuoteType>("SALES");
  const [poNumber, setPoNumber] = useState("");
  const [taxType, setTaxType] = useState<TaxType>("NON_VAT");

  const variant = variantIdx !== null ? variants[variantIdx] : undefined;

  const calc = useMemo(() => {
    const toFt = UNITS.find((u) => u.value === unit)?.toFt ?? 1;
    const wFt = (parseFloat(width) || 0) * toFt;
    const hFt = (parseFloat(height) || 0) * toFt;
    const sqft = round2(wFt * hFt);
    const rate = variant?.rate ?? 0;
    const minCharge = variant?.minCharge ?? 0;
    const base = round2(Math.max(sqft * rate, minCharge));
    const minChargeApplied = sqft * rate < minCharge && base > 0;
    const mountFee = mountIdx >= 0 ? (mountings[mountIdx]?.amount ?? 0) : 0;
    let complexitySurcharge = 0;
    for (const i of checkedComplexity) {
      const c = complexity[i];
      if (!c) continue;
      complexitySurcharge += c.pct ? base * (c.pct / 100) : c.amount;
    }
    complexitySurcharge = round2(complexitySurcharge);
    const addons =
      (design ? designFee : 0) +
      (rush ? rushFee : 0) +
      (useElec ? elec : 0) +
      (useTransport ? transport : 0);
    const total = round2(base + mountFee + complexitySurcharge + addons);
    return {
      wFt,
      hFt,
      sqft,
      rate,
      base,
      minChargeApplied,
      mountFee,
      complexitySurcharge,
      addons,
      total,
    };
  }, [
    unit, width, height, variant, mountIdx, mountings, checkedComplexity,
    complexity, design, designFee, rush, rushFee, useElec, elec,
    useTransport, transport,
  ]);

  const taxed = applyTax(calc.total, taxType);

  const stepValid = (i: number): boolean => {
    if (i === 0) return isClientValid(client);
    if (i === 1) return variantIdx !== null;
    if (i === 2) return calc.sqft > 0;
    return true;
  };

  const next = () => {
    if (!stepValid(step)) {
      toast.error(
        step === 0
          ? "Client name is required."
          : step === 1
            ? "Pick a signage type."
            : "Enter width and height."
      );
      return;
    }
    if (step < STEPS.length - 1) setStep(step + 1);
    else submit();
  };

  const toggleComplexity = (i: number) => {
    setCheckedComplexity((prev) => {
      const nextSet = new Set(prev);
      if (nextSet.has(i)) nextSet.delete(i);
      else nextSet.add(i);
      return nextSet;
    });
  };

  const submit = () => {
    if (quoteType === "PO" && !poNumber.trim()) {
      toast.error("PO number is required for a PO quotation.");
      return;
    }
    setSubmitting(true);
    const chosenComplexity = [...checkedComplexity]
      .map((i) => complexity[i]?.label)
      .filter(Boolean);
    const descParts = [
      `Signage — ${variant!.label}`,
      `${calc.wFt.toFixed(2)} × ${calc.hFt.toFixed(2)} ft (${calc.sqft.toFixed(2)} sqft)`,
    ];
    if (material) descParts.push(`Material: ${material}`);
    if (mountIdx >= 0 && mountings[mountIdx])
      descParts.push(`Mount: ${mountings[mountIdx]!.label}`);
    if (chosenComplexity.length)
      descParts.push(`Complexity: ${chosenComplexity.join(", ")}`);
    if (useElec) descParts.push("Electrical");
    if (useTransport) descParts.push("Transport");
    if (design) descParts.push("With design");
    if (rush) descParts.push("Rush");

    const noteLines = [
      client.contactNumber && `Contact: ${client.contactNumber}`,
      client.email && `Email: ${client.email}`,
      address && `Address: ${address}`,
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
        taxType,
        paymentTermLabel: "50% Downpayment",
        downpaymentRate: "0.5",
        notes: noteLines.join("\n"),
        inquiryId,
        items: [
          {
            productId: product.id,
            description: descParts.join(" · "),
            qty: "1",
            unitPrice: calc.total.toFixed(2),
            specs: {
              calculator: "signage",
              type: variant!.label,
              material,
              width: calc.wFt,
              height: calc.hFt,
              unit: "ft",
              sqft: calc.sqft,
              rate: calc.rate,
              base: calc.base,
              mounting: mountIdx >= 0 ? mountings[mountIdx]?.label : null,
              mountFee: calc.mountFee,
              complexity: chosenComplexity,
              complexitySurcharge: calc.complexitySurcharge,
              electrical: useElec,
              transport: useTransport,
              design,
              rush,
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
          NEW SIGNAGE <span className="text-primary">QUOTATION</span>
        </span>
      }
      subtitle="Complete each step to generate a client quotation."
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
      {step === 0 && (
        <div className="grid gap-5">
          <ClientInfoStep value={client} onChange={setClient} />
          <div className="grid gap-1.5">
            <Label htmlFor="sg-address">Delivery / Installation Location</Label>
            <Input
              id="sg-address"
              placeholder="Same as address, or specify a different location"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="grid gap-3">
          <Label className="mb-1">
            Signage Type <span className="text-destructive">*</span>
          </Label>
          {variants.map((v, i) => (
            <button
              key={v.label}
              type="button"
              onClick={() => setVariantIdx(i)}
              className={cn(
                "flex items-center justify-between gap-3 rounded-lg border p-3 text-left",
                variantIdx === i
                  ? "border-primary ring-1 ring-primary"
                  : "hover:bg-accent"
              )}
            >
              <div>
                <p className="text-sm font-semibold">{v.label}</p>
                <p className="text-xs text-muted-foreground">
                  Min charge {php(v.minCharge)}
                </p>
              </div>
              <span className="text-sm font-bold text-primary tabular-nums">
                {php(v.rate)}/sqft
              </span>
            </button>
          ))}
          <div className="mt-2 grid gap-1.5">
            <Label htmlFor="sg-material">Material / notes (optional)</Label>
            <Input
              id="sg-material"
              placeholder="e.g. GI frame, acrylic 3mm"
              value={material}
              onChange={(e) => setMaterial(e.target.value)}
            />
          </div>
        </div>
      )}

      {step === 2 && (
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
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="sg-w">
                Width ({unit}) <span className="text-destructive">*</span>
              </Label>
              <NumberField
                id="sg-w"
                decimal
                placeholder="0"
                value={width}
                onChange={setWidth}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sg-h">
                Height ({unit}) <span className="text-destructive">*</span>
              </Label>
              <NumberField
                id="sg-h"
                decimal
                placeholder="0"
                value={height}
                onChange={setHeight}
              />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border bg-muted/40 p-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Billable Area
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {calc.wFt ? calc.wFt.toFixed(2) : "?"} ×{" "}
                {calc.hFt ? calc.hFt.toFixed(2) : "?"} ft
              </p>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold text-primary tabular-nums">
                {calc.sqft > 0 ? calc.sqft.toFixed(2) : "—"}
              </p>
              <p className="text-xs text-muted-foreground">sq ft</p>
            </div>
          </div>
          {calc.base > 0 && (
            <div className="grid gap-1.5 rounded-md bg-primary/5 px-4 py-2 text-sm">
              <div className="flex items-center gap-2">
                <span>
                  At <strong>{php(calc.rate)}/sq ft</strong>
                </span>
                <strong className="ml-auto text-primary">
                  = {php(calc.base)}
                </strong>
              </div>
              {calc.minChargeApplied && (
                <p className="text-xs text-primary">
                  Minimum charge applies — billed whichever is higher.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="grid gap-3">
          <Label className="mb-1">Installation & Mounting</Label>
          {mountings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No mounting options configured.
            </p>
          ) : (
            mountings.map((m, i) => (
              <button
                key={m.label}
                type="button"
                onClick={() => setMountIdx(i)}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-lg border p-3 text-left",
                  mountIdx === i
                    ? "border-primary ring-1 ring-primary"
                    : "hover:bg-accent"
                )}
              >
                <span className="text-sm font-semibold">{m.label}</span>
                <span className="text-sm font-bold text-primary tabular-nums">
                  {m.amount > 0 ? `+${php(m.amount)}` : "FREE"}
                </span>
              </button>
            ))
          )}
        </div>
      )}

      {step === 4 && (
        <div className="grid gap-5">
          <div className="grid gap-2">
            <Label className="mb-1">
              Complexity Surcharges{" "}
              <span className="text-muted-foreground">(select all that apply)</span>
            </Label>
            {complexity.length === 0 ? (
              <p className="text-sm text-muted-foreground">None configured.</p>
            ) : (
              complexity.map((c, i) => (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => toggleComplexity(i)}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-lg border p-3 text-left",
                    checkedComplexity.has(i)
                      ? "border-primary ring-1 ring-primary"
                      : "hover:bg-accent"
                  )}
                >
                  <span className="text-sm font-semibold">{c.label}</span>
                  <span className="text-sm font-bold text-primary">
                    {c.pct ? `+${c.pct}%` : `+${php(c.amount)}`}
                  </span>
                </button>
              ))
            )}
          </div>
          {elec > 0 && (
            <ToggleRow
              title="Electrical & lighting"
              sub="Wiring, transformer, LED modules"
              value={`+${php(elec)}`}
              on={useElec}
              onToggle={setUseElec}
            />
          )}
          {transport > 0 && (
            <ToggleRow
              title="Transport & delivery"
              sub="Haul and deliver to site"
              value={`+${php(transport)}`}
              on={useTransport}
              onToggle={setUseTransport}
            />
          )}
        </div>
      )}

      {step === 5 && (
        <div className="grid gap-5">
          <ToggleRow
            title="Needs design"
            sub="We create the layout — design fee applies"
            value={`+${php(designFee)}`}
            on={design}
            onToggle={setDesign}
          />
          <ToggleRow
            title="Rush order"
            sub="Priority production — additional fee applies"
            value={`+${php(rushFee)}`}
            on={rush}
            onToggle={setRush}
          />
          <div className="grid gap-1.5">
            <Label htmlFor="sg-notes">
              Artwork / special instructions{" "}
              <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="sg-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
      )}

      {step === 6 && (
        <div className="grid gap-2.5">
          <ReviewRow label="Client" value={client.customerName} />
          <ReviewRow label="Type" value={variant?.label ?? "—"} />
          <ReviewRow
            label="Size"
            value={`${calc.wFt.toFixed(2)} × ${calc.hFt.toFixed(2)} ft (${calc.sqft.toFixed(2)} sqft)`}
          />
          <div className="mt-1 grid gap-1.5 border-t pt-3 text-sm">
            <BreakdownRow label={`Base (${php(calc.rate)}/sqft)`} value={php(calc.base)} />
            {calc.mountFee > 0 && (
              <BreakdownRow label="Mounting" value={php(calc.mountFee)} />
            )}
            {calc.complexitySurcharge > 0 && (
              <BreakdownRow
                label="Complexity"
                value={php(calc.complexitySurcharge)}
              />
            )}
            {calc.addons > 0 && (
              <BreakdownRow label="Add-ons" value={php(calc.addons)} />
            )}
          </div>
          <div className="border-t pt-3">
            <TaxPicker taxType={taxType} onChange={setTaxType} />
          </div>
          <div className="grid gap-1 border-t pt-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="tabular-nums">{php(calc.total)}</span>
            </div>
            {taxType === "VAT_EXCLUSIVE" && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">VAT (12%)</span>
                <span className="tabular-nums">{php(taxed.taxAmount)}</span>
              </div>
            )}
            {taxType === "VAT_INCLUSIVE" && (
              <div className="flex items-center justify-between text-muted-foreground">
                <span>VAT (12% incl.)</span>
                <span className="tabular-nums">{php(taxed.taxAmount)}</span>
              </div>
            )}
            <div className="mt-1 flex items-center justify-between border-t pt-2">
              <span className="text-base font-semibold">Total</span>
              <span className="text-2xl font-bold text-primary tabular-nums">
                {php(taxed.total)}
              </span>
            </div>
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
            must be submitted for supervisor approval first.
          </p>
        </div>
      )}
    </WizardShell>
  );
}

function ToggleRow({
  title,
  sub,
  value,
  on,
  onToggle,
}: {
  title: string;
  sub: string;
  value: string;
  on: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(!on)}
      className={cn(
        "flex items-center gap-3 rounded-lg border p-3 text-left",
        on ? "border-primary ring-1 ring-primary" : "hover:bg-accent"
      )}
    >
      <div className="flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </div>
      <span
        className={cn(
          "text-sm font-bold",
          on ? "text-primary" : "text-muted-foreground"
        )}
      >
        {on ? value : "OFF"}
      </span>
    </button>
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

function BreakdownRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
