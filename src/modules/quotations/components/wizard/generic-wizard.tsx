"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { NumberField } from "@/components/validated-fields";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { submitWizardQuotation } from "./submit-helpers";
import type {
  ProductOptionDto,
  ProductRuleDto,
} from "@/modules/shared/hooks/use-products";
import { WizardShell } from "./wizard-shell";
import {
  ClientInfoStep,
  EMPTY_CLIENT,
  isClientValid,
  type ClientInfo,
} from "./client-info-step";
import { QuoteTypePicker, type QuoteType } from "./quote-type-picker";
import { TaxPicker, applyTax, type TaxType } from "./tax-picker";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";

// One finished line item held in the wizard cart.
type CartItem = {
  productId: string;
  description: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  specs: Record<string, unknown>;
};

// Generic product wizard — auto-adapts to any product's price rules, so a
// single component gives EVERY catalog product a guided flow (Mug, Frame,
// Sticker, T-shirt, Acrylics, …). Tarpaulin and Signage keep their own
// special wizards; everything else routes here.
//
// Steps: Client Info → Specs → Add-ons → Quotation. The Add-ons step is
// skipped automatically when the product has no ADDON rules.

const UNITS = [
  { value: "ft", label: "Feet", toArea: 1 },
  { value: "in", label: "Inches", toArea: 1 / 12 },
  { value: "cm", label: "cm", toArea: 1 / 30.48 },
  { value: "m", label: "Meters", toArea: 3.28084 },
] as const;

const round2 = (n: number) => Math.round(n * 100) / 100;
const php = (n: number) =>
  `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;

type VariantGroup = {
  label: string;
  tiers: { minQty: number; price: number; minCharge: number }[];
};

function groupVariants(rules: ProductRuleDto[]): VariantGroup[] {
  const byLabel = new Map<string, VariantGroup>();
  for (const r of rules) {
    if (r.type !== "VARIANT" || !r.unitPrice) continue;
    const g = byLabel.get(r.label) ?? { label: r.label, tiers: [] };
    g.tiers.push({
      minQty: r.minQty,
      price: parseFloat(r.unitPrice),
      minCharge: parseFloat(r.minCharge ?? "0") || 0,
    });
    byLabel.set(r.label, g);
  }
  for (const g of byLabel.values()) g.tiers.sort((a, b) => a.minQty - b.minQty);
  return [...byLabel.values()];
}

/** Highest tier the qty satisfies (else the lowest). */
function tierFor(g: VariantGroup, qty: number) {
  const eligible = g.tiers.filter((t) => qty >= t.minQty);
  return eligible.length ? eligible[eligible.length - 1]! : g.tiers[0]!;
}

export function GenericWizard({
  product,
  inquiryId,
}: {
  product: ProductOptionDto;
  inquiryId?: string;
}) {
  const router = useRouter();

  const variants = useMemo(() => groupVariants(product.rules), [product.rules]);
  const addons = useMemo(
    () =>
      product.rules
        .filter((r) => r.type === "ADDON")
        .map((r) => ({
          label: r.label,
          amount: parseFloat(r.amount ?? "0") || 0,
          pct: parseFloat(r.pct ?? "0") || 0,
        })),
    [product.rules]
  );
  const isArea = product.unit === "sqft" || product.unit === "sq in";
  const hasVariants = variants.length > 0;
  const hasAddons = addons.length > 0;
  const basePrice = parseFloat(product.basePrice) || 0;

  // Build the step list dynamically (skip Add-ons when there are none).
  const steps = useMemo(() => {
    const s = [
      { label: "Client Info", sub: "Name, contact & date needed" },
      {
        label: "Specs",
        sub: isArea ? "Size & quantity" : "Options & quantity",
      },
    ];
    if (hasAddons) s.push({ label: "Add-ons", sub: "Optional fees" });
    s.push({ label: "Quotation", sub: "Review & create" });
    return s;
  }, [isArea, hasAddons]);
  const specsStep = 1;
  const addonsStep = hasAddons ? 2 : -1;
  const reviewStep = steps.length - 1;

  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [client, setClient] = useState<ClientInfo>(EMPTY_CLIENT);
  const [variantIdx, setVariantIdx] = useState<number>(hasVariants ? 0 : -1);
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState("ft");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [checkedAddons, setCheckedAddons] = useState<Set<number>>(new Set());
  const [notes, setNotes] = useState("");
  const [quoteType, setQuoteType] = useState<QuoteType>("SALES");
  const [poNumber, setPoNumber] = useState("");
  const [taxType, setTaxType] = useState<TaxType>("NON_VAT");
  const [cart, setCart] = useState<CartItem[]>([]);

  const q = Math.max(parseInt(qty, 10) || 0, 0);
  const variant = variantIdx >= 0 ? variants[variantIdx] : undefined;

  const calc = useMemo(() => {
    // Area products: unit price = rate/area unit (× billable area). Discrete
    // products: unit price = the qty-tier price.
    let unitPrice = 0;
    let minCharge = 0;
    let area = 0;
    if (isArea) {
      const toArea = UNITS.find((u) => u.value === unit)?.toArea ?? 1;
      const w = (parseFloat(width) || 0) * toArea;
      const h = (parseFloat(height) || 0) * toArea;
      area = round2(w * h);
      const rate = variant ? variant.tiers[0]!.price : basePrice;
      minCharge = variant ? variant.tiers[0]!.minCharge : 0;
      unitPrice = rate;
    } else if (variant) {
      const t = tierFor(variant, q);
      unitPrice = t.price;
      minCharge = t.minCharge;
    } else {
      unitPrice = basePrice;
    }

    const lineBase = isArea
      ? round2(Math.max(area * unitPrice * q, minCharge))
      : round2(Math.max(unitPrice * q, minCharge));

    let addonTotal = 0;
    for (const i of checkedAddons) {
      const a = addons[i];
      if (!a) continue;
      addonTotal += a.pct ? lineBase * (a.pct / 100) : a.amount;
    }
    addonTotal = round2(addonTotal);
    const total = round2(lineBase + addonTotal);
    return { area, unitPrice, minCharge, lineBase, addonTotal, total, q };
  }, [isArea, unit, width, height, variant, basePrice, q, checkedAddons, addons]);

  const stepValid = (i: number): boolean => {
    if (i === 0) return isClientValid(client);
    if (i === specsStep) {
      if (q < 1) return false;
      if (isArea) return calc.area > 0;
      if (hasVariants) return variantIdx >= 0;
      return basePrice > 0 || calc.total > 0;
    }
    return true;
  };

  const next = () => {
    if (!stepValid(step)) {
      toast.error(
        step === 0
          ? "Client name is required."
          : isArea
            ? "Enter size and quantity."
            : "Pick an option and quantity."
      );
      return;
    }
    if (step < reviewStep) setStep(step + 1);
    else submit(false);
  };

  const toggleAddon = (i: number) =>
    setCheckedAddons((prev) => {
      const s = new Set(prev);
      if (s.has(i)) s.delete(i);
      else s.add(i);
      return s;
    });

  /** Freeze the current spec inputs into a finished cart line. */
  const buildCurrentItem = (): CartItem => {
    const descParts = [product.name];
    if (variant) descParts.push(variant.label);
    descParts.push(
      isArea
        ? `${calc.area.toFixed(2)} ${product.unit} × ${calc.q}`
        : `${calc.q} ${product.unit}`
    );
    for (const i of checkedAddons) {
      const a = addons[i];
      if (a) descParts.push(a.label);
    }
    return {
      productId: product.id,
      description: descParts.join(" · "),
      qty: calc.q || 1,
      unitPrice: round2(calc.total / (calc.q || 1)),
      lineTotal: calc.total,
      specs: {
        calculator: "generic",
        product: product.name,
        variant: variant?.label ?? null,
        unit: product.unit,
        area: isArea ? calc.area : null,
        addons: [...checkedAddons].map((i) => addons[i]?.label),
      },
    };
  };

  /** Reset the spec inputs so the next item starts blank. */
  const resetSpecs = () => {
    setVariantIdx(hasVariants ? 0 : -1);
    setQty("1");
    setWidth("");
    setHeight("");
    setCheckedAddons(new Set());
  };

  /** "Add another item": push the current line, clear specs, jump back. */
  const addAnotherItem = () => {
    if (!stepValid(specsStep)) {
      toast.error("Finish this item first.");
      return;
    }
    setCart((c) => [...c, buildCurrentItem()]);
    resetSpecs();
    setStep(specsStep);
    toast.success("Item added — enter the next one.");
  };

  const removeCartItem = (index: number) =>
    setCart((c) => c.filter((_, i) => i !== index));

  const cartTotal = cart.reduce((s, it) => s + it.lineTotal, 0);
  const grandTotal = round2(cartTotal + calc.total);
  const taxed = applyTax(grandTotal, taxType);

  const submit = (logInquiry = false) => {
    if (quoteType === "PO" && !poNumber.trim()) {
      toast.error("PO number is required for a PO quotation.");
      return;
    }
    setSubmitting(true);

    const items = [...cart, buildCurrentItem()];
    const noteLines = [
      client.contactNumber && `Contact: ${client.contactNumber}`,
      client.email && `Email: ${client.email}`,
      client.dateNeeded && `Date needed: ${client.dateNeeded}`,
      notes,
    ].filter(Boolean);

    startCreate();

    async function startCreate() {
      const data = await submitWizardQuotation(
        {
          type: quoteType,
          poNumber: quoteType === "PO" ? poNumber.trim() : undefined,
          customerName: client.customerName,
          contactNumber: client.contactNumber,
          email: client.email,
          validUntil: "",
          taxType,
          paymentTermLabel: "50% Downpayment",
          downpaymentRate: "0.5",
          notes: noteLines.join("\n"),
          items: items.map((it) => ({
            productId: it.productId,
            description: it.description,
            qty: String(it.qty),
            unitPrice: it.unitPrice.toFixed(2),
            specs: it.specs,
          })),
        },
        logInquiry && !inquiryId
          ? {
              inquiry: {
                customerName: client.customerName,
                contactNumber: client.contactNumber,
                email: client.email,
                servicesRequested: items[0]?.description ?? product.name,
              },
            }
          : { existingInquiryId: inquiryId }
      );
      setSubmitting(false);
      if (!data) return;
      toast.success(
        logInquiry
          ? `Inquiry logged and quotation ${data.quoteNumber} created.`
          : `Quotation ${data.quoteNumber} created.`
      );
      router.push(`/quotations/${data.id}`);
      router.refresh();
    }
  };

  return (
    <WizardShell
      title={
        <span>
          {product.name.toUpperCase()}{" "}
          <span className="text-primary">QUOTATION</span>
        </span>
      }
      subtitle="Complete each step to generate a quotation."
      badge={basePrice > 0 ? `₱${product.basePrice}/${product.unit}` : undefined}
      steps={steps}
      current={step}
      onJump={setStep}
      onBack={() => setStep(Math.max(step - 1, 0))}
      onNext={next}
      nextDisabled={submitting}
      secondaryLabel={inquiryId ? undefined : "Log inquiry + quote"}
      onSecondary={() => submit(true)}
      nextLabel={
        submitting
          ? "Creating…"
          : step === reviewStep
            ? cart.length > 0
              ? `Create quotation (${cart.length + 1} items)`
              : "Create quotation"
            : undefined
      }
    >
      {step === 0 && <ClientInfoStep value={client} onChange={setClient} />}

      {step === specsStep && (
        <div className="grid gap-5">
          {hasVariants && (
            <div className="grid gap-2">
              <Label className="mb-1">Option</Label>
              {variants.map((v, i) => {
                const t = tierFor(v, q);
                return (
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
                      {v.tiers.length > 1 && (
                        <p className="text-xs text-muted-foreground">
                          {v.tiers
                            .map(
                              (x) =>
                                `${php(x.price)}${x.minQty > 1 ? ` @${x.minQty}+` : ""}`
                            )
                            .join(" · ")}
                        </p>
                      )}
                    </div>
                    <span className="text-sm font-bold text-primary tabular-nums">
                      {php(t.price)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {isArea && (
            <div className="grid gap-3">
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
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="gw-w">Width ({unit})</Label>
                  <NumberField
                    id="gw-w"
                    decimal
                    value={width}
                    onChange={setWidth}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="gw-h">Height ({unit})</Label>
                  <NumberField
                    id="gw-h"
                    decimal
                    value={height}
                    onChange={setHeight}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-1.5 sm:max-w-40">
            <Label htmlFor="gw-qty">
              Quantity ({product.unit}){" "}
              <span className="text-destructive">*</span>
            </Label>
            <NumberField id="gw-qty" value={qty} onChange={setQty} maxDigits={6} />
          </div>

          {calc.lineBase > 0 && (
            <div className="flex items-center justify-between rounded-md bg-primary/5 px-4 py-2 text-sm">
              <span>Subtotal</span>
              <strong className="text-primary">{php(calc.lineBase)}</strong>
            </div>
          )}
        </div>
      )}

      {step === addonsStep && (
        <div className="grid gap-2">
          <Label className="mb-1">Optional fees</Label>
          {addons.map((a, i) => (
            <button
              key={a.label}
              type="button"
              onClick={() => toggleAddon(i)}
              className={cn(
                "flex items-center justify-between gap-3 rounded-lg border p-3 text-left",
                checkedAddons.has(i)
                  ? "border-primary ring-1 ring-primary"
                  : "hover:bg-accent"
              )}
            >
              <span className="text-sm font-semibold">{a.label}</span>
              <span className="text-sm font-bold text-primary">
                {a.pct ? `+${a.pct}%` : `+${php(a.amount)}`}
              </span>
            </button>
          ))}
        </div>
      )}

      {step === reviewStep && (
        <div className="grid gap-4">
          <ReviewRow label="Client" value={client.customerName} />
          {client.contactNumber && (
            <ReviewRow label="Contact" value={client.contactNumber} />
          )}

          {/* already-added items */}
          {cart.length > 0 && (
            <div className="grid gap-2 rounded-lg border p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Added items ({cart.length})
              </p>
              {cart.map((it, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {it.description}
                  </span>
                  <span className="tabular-nums">{php(it.lineTotal)}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove item ${i + 1}`}
                    onClick={() => removeCartItem(i)}
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* current item */}
          <div className="grid gap-2 rounded-lg border p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">
              {cart.length > 0 ? `Item ${cart.length + 1}` : "This item"}
            </p>
            <ReviewRow label="Product" value={product.name} />
            {variant && <ReviewRow label="Option" value={variant.label} />}
            {isArea && (
              <ReviewRow
                label="Size"
                value={`${calc.area.toFixed(2)} ${product.unit}`}
              />
            )}
            <ReviewRow label="Quantity" value={`${calc.q} ${product.unit}`} />
            {calc.addonTotal > 0 && (
              <ReviewRow label="Add-ons" value={php(calc.addonTotal)} />
            )}
            <ReviewRow label="Line total" value={php(calc.total)} />
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={addAnotherItem}
          >
            <PlusIcon /> Add another item
          </Button>

          <div className="grid gap-1.5">
            <Label htmlFor="gw-notes">
              Notes <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="gw-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="border-t pt-4">
            <TaxPicker taxType={taxType} onChange={setTaxType} />
          </div>

          <div className="grid gap-1 border-t pt-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                {cart.length > 0 ? "Items subtotal" : "Subtotal"}
              </span>
              <span className="tabular-nums">{php(grandTotal)}</span>
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
            must be submitted for supervisor approval first. Tax and payment
            terms are editable afterwards.
          </p>
        </div>
      )}
    </WizardShell>
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
