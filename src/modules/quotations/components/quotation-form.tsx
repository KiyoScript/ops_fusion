"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { CheckIcon, InboxIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { todayISO } from "@/components/validated-fields";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  createQuotationAction,
  updateQuotationAction,
} from "@/app/(app)/quotations/actions";
import {
  logInquiryDraftAction,
  updateInquiryDraftAction,
} from "@/app/(app)/inquiries/actions";
import {
  quotationCreateInput,
  type QuotationCreateInput,
} from "../schemas/quotation";
import { computeTotals } from "../services/totals";
import { useInvalidateQuotations } from "../hooks/use-quotations";
import { useInvalidateInquiries } from "../hooks/use-inquiries";
import { CustomerCombobox } from "@/modules/job-orders/components/customer-combobox";
import { CustomerCreateDialog } from "@/modules/customers/components/customer-create-dialog";
import { ContactField, isValidPhContact } from "@/components/validated-fields";
import {
  mergeGlobalAddons,
  useGlobalAddons,
  useProductOptions,
  type ProductRuleDto,
} from "@/modules/shared/hooks/use-products";
import { TarpCalculator } from "./tarp-calculator";
import { AreaCalculator } from "./area-calculator";
import { NewspaperCalculator } from "./newspaper-calculator";
import { VariantPicker, resolveTierPrice } from "./variant-picker";
import { ProductCombobox } from "./product-combobox";

// Products priced by the square foot get the dimension calculator (W × H →
// area × rate), not the plain variant picker. Tarpaulin has its own calculator.
const AREA_UNITS = new Set(["sqft", "sq in", "sq ft", "sqin"]);

// Legacy Payment Terms tab of the price DB (label ↔ downpayment fraction).
const PAYMENT_TERMS = [
  { label: "No Downpayment Required", rate: "0" },
  { label: "25% Downpayment", rate: "0.25" },
  { label: "50% Downpayment", rate: "0.5" },
  { label: "Full Payment", rate: "1" },
] as const;

const TAX_OPTIONS = [
  { value: "NON_VAT", label: "Non-VAT" },
  { value: "VAT_EXCLUSIVE", label: "VAT Exclusive (+12%)" },
  { value: "VAT_INCLUSIVE", label: "VAT Inclusive" },
] as const;

const QUOTE_TYPES = [
  { value: "SALES", label: "Sales Quotation", hint: "Standard quote → becomes a Job Order" },
  { value: "PO", label: "PO Quotation", hint: "Against a customer purchase order" },
] as const;

// How the customer reached out — only used when logging this as an inquiry
// (not a quotation). PORTAL is public-submission-only, so it's excluded here.
const INQUIRY_MEDIUMS = [
  { value: "WALK_IN", label: "Walk-in" },
  { value: "MESSENGER", label: "Messenger" },
  { value: "CALL", label: "Call" },
  { value: "EMAIL", label: "Email" },
  { value: "VIBER", label: "Viber" },
] as const;

const EMPTY_ITEM: QuotationCreateInput["items"][number] = {
  productId: "",
  description: "",
  qty: "1",
  unitPrice: "",
  discount: "",
};

export function QuotationForm({
  mode,
  quotationId,
  initialValues,
  inquiryId,
  initialMedium,
}: {
  // "edit-inquiry" = the full form editing an inquiry's draft (saves the
  // inquiry, does NOT create a quotation).
  mode: "create" | "edit" | "edit-inquiry";
  quotationId?: string;
  initialValues?: QuotationCreateInput;
  /** Set when drafting from / editing an inquiry. */
  inquiryId?: string;
  /** Current medium when editing an inquiry (edit-inquiry mode). */
  initialMedium?: string;
}) {
  const router = useRouter();
  const invalidateQuotations = useInvalidateQuotations();
  const invalidateInquiries = useInvalidateInquiries();
  // Medium — for "Log inquiry instead" (create) and the edit-inquiry form.
  const [medium, setMedium] = useState<string>(initialMedium ?? "WALK_IN");
  const [loggingInquiry, setLoggingInquiry] = useState(false);
  const [savingInquiry, setSavingInquiry] = useState(false);
  // Inline "create customer" from the customer picker (when not found).
  const [createCustomerOpen, setCreateCustomerOpen] = useState(false);
  const [createCustomerName, setCreateCustomerName] = useState("");
  const form = useForm<QuotationCreateInput>({
    resolver: zodResolver(quotationCreateInput),
    defaultValues: {
      ...(initialValues ?? {
        type: "SALES",
        poNumber: "",
        customerName: "",
        contactNumber: "",
        validUntil: "",
        taxType: "NON_VAT",
        paymentTermLabel: "50% Downpayment",
        downpaymentRate: "0.5",
        discount: "",
        notes: "",
        items: [EMPTY_ITEM],
      }),
      inquiryId: inquiryId ?? "",
    },
  });
  const items = useFieldArray({ control: form.control, name: "items" });
  const watched = useWatch({ control: form.control });
  const { errors, isSubmitting } = form.formState;

  const products = useProductOptions();
  const globalAddons = useGlobalAddons();
  const productById = new Map((products.data ?? []).map((p) => [p.id, p]));

  // Picking a catalog product prefills price/description without clobbering
  // anything the user already typed.
  const onProductChange = (index: number, productId: string) => {
    const current = form.getValues(`items.${index}`);
    // Was the description auto-filled from the PREVIOUS product? Then it's safe
    // to replace it on a product change; a hand-typed description is kept.
    const prevProduct = current.productId
      ? productById.get(current.productId)
      : undefined;
    const prevVariant = (current.specs as { variant?: string } | undefined)
      ?.variant;
    const prevDerived = prevProduct
      ? prevVariant
        ? `${prevProduct.name} — ${prevVariant}`
        : prevProduct.name
      : null;
    const descIsAuto =
      !current.description ||
      current.description === prevProduct?.name ||
      current.description === prevDerived;
    const setDesc = (text: string) => {
      if (descIsAuto) {
        form.setValue(`items.${index}.description`, text, { shouldValidate: true });
      }
    };

    form.setValue(`items.${index}.productId`, productId);
    const product = productById.get(productId);
    if (!product) return;
    // The old product's variant / add-on picks no longer apply — start fresh.
    form.setValue(`items.${index}.specs`, {});

    // Newspaper is priced from the Newspaper Pricing list (the picker), never
    // from a master base price.
    const isNewspaper = product.name === "Newspaper";
    const isTarp = product.name === "Tarpaulin";
    const isArea =
      !isTarp && !isNewspaper && AREA_UNITS.has(product.unit.toLowerCase());
    const variantLabels = [
      ...new Set(
        product.rules.filter((r) => r.type === "VARIANT").map((r) => r.label)
      ),
    ];
    // A plain product with exactly ONE variant (e.g. a tiered mug type) auto-
    // selects it, so its qty tier applies right away — the salesperson doesn't
    // have to click the lone variant card first. Multi-variant products still
    // wait for an explicit pick.
    if (!isNewspaper && !isTarp && !isArea && variantLabels.length === 1) {
      const label = variantLabels[0]!;
      const qty = parseInt(current.qty || "1", 10) || 1;
      const tier = resolveTierPrice(product.rules, label, qty);
      if (tier) {
        form.setValue(`items.${index}.specs`, { variant: label });
        applyFees(index, parseFloat(tier.price) || 0, []);
        setDesc(product.name);
        return;
      }
    }
    // Reset the unit price to the new product's base (calculators set their own).
    if (!isNewspaper && !isTarp && !isArea && parseFloat(product.basePrice) > 0) {
      form.setValue(`items.${index}.unitPrice`, product.basePrice, {
        shouldValidate: true,
      });
    }
    setDesc(product.name);
  };

  // Variant pick: price from the qty tier, variant recorded in specs, and
  // the description prefilled only while it still is the bare product name.
  const onVariantPick = (index: number, label: string, price: string) => {
    const current = form.getValues(`items.${index}`);
    const product = current.productId
      ? productById.get(current.productId)
      : undefined;
    // The variant tier price is the new base; re-fold any checked fees onto it.
    form.setValue(`items.${index}.specs`, {
      ...(current.specs ?? {}),
      variant: label,
    });
    const checked =
      (current.specs as { addons?: string[] } | undefined)?.addons ?? [];
    applyFees(index, parseFloat(price) || 0, checked);
    if (product && (!current.description || current.description === product.name)) {
      form.setValue(`items.${index}.description`, `${product.name} — ${label}`);
    }
  };

  // Optional add-on fees fold into the line: unit price = (base×qty + fees) ÷ qty,
  // matching the guided-wizard math. Base + checked labels live in specs so the
  // fold recomputes when qty, variant, or the checked set changes.
  const applyFees = (index: number, baseUnit: number, checkedLabels: string[]) => {
    const current = form.getValues(`items.${index}`);
    const product = current.productId
      ? productById.get(current.productId)
      : undefined;
    const qty = parseInt(current.qty || "1", 10) || 1;
    const fees = mergeGlobalAddons(product?.rules ?? [], globalAddons.data).filter(
      (r) => r.type === "ADDON"
    );
    const lineBase = baseUnit * qty;
    let addonTotal = 0;
    for (const a of fees) {
      if (!checkedLabels.includes(a.label)) continue;
      addonTotal += a.pct
        ? lineBase * (parseFloat(a.pct) / 100)
        : parseFloat(a.amount ?? "0");
    }
    const total = Math.round((lineBase + addonTotal) * 100) / 100;
    form.setValue(
      `items.${index}.unitPrice`,
      qty > 0 ? (total / qty).toFixed(2) : baseUnit.toFixed(2),
      { shouldValidate: true }
    );
    form.setValue(`items.${index}.specs`, {
      ...(current.specs ?? {}),
      baseUnit: baseUnit.toFixed(2),
      addons: checkedLabels,
    });
  };

  const refoldFees = (index: number) => {
    const current = form.getValues(`items.${index}`);
    const specs = (current.specs ?? {}) as {
      addons?: string[];
      baseUnit?: string;
      calculator?: string;
      variant?: string;
    };
    // Tarp/area calculators re-price themselves on qty change (their own effect
    // reruns), including the min-charge floor — don't double-compute here.
    if (specs.calculator) return;
    const product = current.productId
      ? productById.get(current.productId)
      : undefined;
    const qty = parseInt(current.qty || "1", 10) || 1;
    // A picked variant re-resolves its qty tier automatically, so the price
    // follows the quantity (e.g. Inner Color Mug: 5→₱190, 10→₱160). The new
    // tier becomes the base and any checked fees fold back onto it.
    if (specs.variant && product) {
      const tier = resolveTierPrice(product.rules, specs.variant, qty);
      if (tier) {
        applyFees(index, parseFloat(tier.price) || 0, specs.addons ?? []);
        return;
      }
    }
    if (!specs.addons?.length) return;
    const base =
      specs.baseUnit != null
        ? parseFloat(specs.baseUnit)
        : parseFloat(current.unitPrice || "0");
    applyFees(index, base || 0, specs.addons);
  };

  const applyCalculator = (
    index: number,
    result: {
      description: string;
      unitPrice: string;
      specs: Record<string, unknown>;
      // Newspaper: copies IS the quantity, so the calculator also drives qty.
      qty?: string;
    }
  ) => {
    form.setValue(`items.${index}.description`, result.description, {
      shouldValidate: true,
    });
    form.setValue(`items.${index}.unitPrice`, result.unitPrice, {
      shouldValidate: true,
    });
    if (result.qty != null) {
      form.setValue(`items.${index}.qty`, result.qty, { shouldValidate: true });
    }
    form.setValue(`items.${index}.specs`, result.specs);
  };

  // Whole-JO add-ons (delivery fee…): ONE fee line for the whole quotation,
  // toggled below the line items — never repeated per line item. A BOTH-scope
  // add-on is offered here AND on each line item; the user picks where it lands.
  // Sources: global add-ons AND any whole-JO/BOTH add-on defined on a product
  // that's on a line item (deduped by label; global wins).
  const wholeJoAddons = (() => {
    const seen = new Set<string>();
    const out: ProductRuleDto[] = [];
    const add = (a: ProductRuleDto) => {
      if (a.type !== "ADDON") return;
      if (a.scope !== "WHOLE_JO" && a.scope !== "BOTH") return;
      const key = a.label.trim().toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(a);
    };
    for (const a of globalAddons.data ?? []) add(a);
    for (const it of watched.items ?? []) {
      const p = it?.productId ? productById.get(it.productId) : undefined;
      if (p) for (const r of p.rules) add(r);
    }
    return out;
  })();
  const wholeJoChecked = (label: string) =>
    (watched.items ?? []).some(
      (it) =>
        (it?.specs as { wholeJoAddon?: string } | undefined)?.wholeJoAddon ===
        label
    );
  const toggleWholeJo = (addon: (typeof wholeJoAddons)[number]) => {
    const all = form.getValues("items");
    const idx = all.findIndex(
      (it) =>
        (it?.specs as { wholeJoAddon?: string } | undefined)?.wholeJoAddon ===
        addon.label
    );
    if (idx >= 0) {
      items.remove(idx);
      return;
    }
    let amount = addon.amount ? parseFloat(addon.amount) || 0 : 0;
    if (!amount && addon.pct) {
      const base = all.reduce((s, it) => {
        if ((it?.specs as { wholeJoAddon?: string } | undefined)?.wholeJoAddon)
          return s;
        const q = parseInt(it?.qty || "0", 10) || 0;
        const up = parseFloat(it?.unitPrice || "0") || 0;
        const disc = parseFloat(it?.discount || "0") || 0;
        return s + Math.max(0, q * up - disc);
      }, 0);
      amount = Math.round(base * ((parseFloat(addon.pct) || 0) / 100) * 100) / 100;
    }
    items.append({
      productId: "",
      description: addon.label,
      qty: "1",
      unitPrice: amount.toFixed(2),
      discount: "",
      specs: { wholeJoAddon: addon.label },
    });
  };

  // Live preview with the SAME math the service uses on save.
  const totals = computeTotals({
    items: (watched.items ?? []).map((item) => ({
      qty: parseInt(item?.qty || "0", 10) || 0,
      unitPrice: parseFloat(item?.unitPrice || "0") || 0,
      discount: parseFloat(item?.discount || "0") || 0,
    })),
    discount: parseFloat(watched.discount || "0") || 0,
    taxType: (watched.taxType as QuotationCreateInput["taxType"]) ?? "NON_VAT",
    downpaymentRate: parseFloat(watched.downpaymentRate || "0.5") || 0,
  });

  // A selected variant can carry a MINIMUM order qty — its smallest tier
  // (e.g. Mug "Inner Color Mug" starts at 5). Ordering below it is invalid.
  const variantMinQty = (
    productId: string | null | undefined,
    variantLabel: string | undefined
  ): number => {
    if (!productId || !variantLabel) return 1;
    const p = productById.get(productId);
    if (!p) return 1;
    const mins = p.rules
      .filter((r) => r.type === "VARIANT" && r.label === variantLabel && r.minQty > 0)
      .map((r) => r.minQty);
    return mins.length ? Math.min(...mins) : 1;
  };
  const findQtyBelowMin = (): { variant: string; min: number } | null => {
    for (const it of form.getValues().items ?? []) {
      const variant = (it?.specs as { variant?: string } | undefined)?.variant;
      if (!variant) continue;
      const min = variantMinQty(it?.productId, variant);
      const qty = parseInt(it?.qty ?? "", 10) || 0;
      if (min > 1 && qty > 0 && qty < min) return { variant, min };
    }
    return null;
  };

  const onSubmit = form.handleSubmit(async (values) => {
    // Enforce variant minimum-order quantities (not expressible in the static
    // Zod schema — the threshold depends on the picked variant's tiers).
    const below = findQtyBelowMin();
    if (below) {
      toast.error(`"${below.variant}" needs a minimum quantity of ${below.min}.`);
      return;
    }
    const result =
      mode === "create"
        ? await createQuotationAction(values)
        : await updateQuotationAction({ ...values, id: quotationId });

    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(
      mode === "create"
        ? `Quotation ${(result.data as { quoteNumber?: string }).quoteNumber ?? ""} created.`
        : "Quotation updated."
    );
    invalidateQuotations();
    router.push(`/quotations/${(result.data as { id: string }).id}`);
    router.refresh();
  });

  // "Log inquiry instead": save the same header as a lead (no pricing needed).
  // Services = the line-item descriptions; medium is the inquiry-only field.
  const logInquiry = async () => {
    const v = form.getValues();
    if (!v.customerName?.trim()) {
      toast.error("Enter the customer to log an inquiry.");
      return;
    }
    if (!isValidPhContact(v.contactNumber ?? "")) {
      toast.error("A valid mobile number is required to log an inquiry.");
      return;
    }
    const services = (v.items ?? [])
      .map((i) => i?.description?.trim())
      .filter(Boolean)
      .join(" · ");
    if (!services) {
      toast.error("Add at least one item — what is the customer asking for?");
      return;
    }
    setLoggingInquiry(true);
    // Store the WHOLE form as the inquiry's draft snapshot (items, specs, prices,
    // tax, terms) — restored verbatim on convert. It's an inquiry, not a quote.
    const res = await logInquiryDraftAction({
      customerName: v.customerName.trim(),
      contactNumber: (v.contactNumber ?? "").trim(),
      medium,
      servicesRequested: services,
      notes: v.notes?.trim() || undefined,
      draft: v,
    });
    setLoggingInquiry(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Inquiry logged — draft saved, nothing lost.");
    invalidateInquiries();
    router.push("/inquiries");
    router.refresh();
  };

  // Save an inquiry edited in the full form (edit-inquiry mode) — persists the
  // draft snapshot + simple fields; stays an inquiry (no quote created).
  const saveInquiry = async () => {
    const v = form.getValues();
    if (!v.customerName?.trim()) {
      toast.error("Enter the customer.");
      return;
    }
    if (!isValidPhContact(v.contactNumber ?? "")) {
      toast.error("A valid mobile number is required.");
      return;
    }
    const services = (v.items ?? [])
      .map((i) => i?.description?.trim())
      .filter(Boolean)
      .join(" · ");
    if (!services) {
      toast.error("Add at least one item — what is the customer asking for?");
      return;
    }
    setSavingInquiry(true);
    const res = await updateInquiryDraftAction({
      id: inquiryId,
      customerName: v.customerName.trim(),
      contactNumber: (v.contactNumber ?? "").trim(),
      medium,
      servicesRequested: services,
      notes: v.notes?.trim() || undefined,
      draft: v,
    });
    setSavingInquiry(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Inquiry updated.");
    invalidateInquiries();
    router.push("/inquiries");
    router.refresh();
  };

  return (
    <form
      onSubmit={
        mode === "edit-inquiry"
          ? (e) => {
              e.preventDefault();
              saveInquiry();
            }
          : onSubmit
      }
      className="grid gap-4 lg:grid-cols-[24rem_1fr]"
    >
      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Quotation details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label>Quotation type</Label>
            <Controller
              control={form.control}
              name="type"
              render={({ field }) => (
                <div
                  role="radiogroup"
                  aria-label="Quotation type"
                  className="grid gap-2 grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]"
                >
                  {QUOTE_TYPES.map((t) => {
                    const selected = field.value === t.value;
                    return (
                      <button
                        key={t.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => field.onChange(t.value)}
                        className={cn(
                          "flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors",
                          selected
                            ? "border-primary bg-primary/5 ring-1 ring-primary"
                            : "hover:bg-accent/40"
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                            selected ? "border-primary" : "border-muted-foreground/40"
                          )}
                        >
                          {selected && <span className="size-2 rounded-full bg-primary" />}
                        </span>
                        <span className="grid gap-0.5">
                          <span className="text-sm font-medium">{t.label}</span>
                          <span className="text-xs text-muted-foreground">{t.hint}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            />
          </div>

          {watched.type === "PO" && (
            <div className="grid gap-2">
              <Label htmlFor="po-number">
                PO Number <span className="text-destructive">*</span>
              </Label>
              <Input
                id="po-number"
                placeholder="Customer's PO reference"
                aria-invalid={!!errors.poNumber}
                {...form.register("poNumber")}
              />
              {errors.poNumber && (
                <p className="text-sm text-destructive">
                  {errors.poNumber.message}
                </p>
              )}
            </div>
          )}

          <Separator />

          <div className="grid gap-2">
            <Label htmlFor="customer-name">Customer</Label>
            <Controller
              control={form.control}
              name="customerName"
              render={({ field }) => (
                <CustomerCombobox
                  id="customer-name"
                  value={field.value}
                  onChange={field.onChange}
                  // Returning customer auto-fills their contact number.
                  onPick={(c) => {
                    field.onChange(c.name);
                    if (c.contactNumber) {
                      form.setValue("contactNumber", c.contactNumber, {
                        shouldValidate: true,
                      });
                    }
                  }}
                  // Not found → open the inline create flow, prefilled.
                  onCreateNew={(query) => {
                    setCreateCustomerName(query);
                    setCreateCustomerOpen(true);
                  }}
                  invalid={!!errors.customerName}
                />
              )}
            />
            {errors.customerName && (
              <p className="text-sm text-destructive">
                {errors.customerName.message}
              </p>
            )}
            <CustomerCreateDialog
              open={createCustomerOpen}
              initialName={createCustomerName}
              onOpenChange={setCreateCustomerOpen}
              onCreated={(c) => {
                form.setValue("customerName", c.name, { shouldValidate: true });
                if (c.contactNumber) {
                  form.setValue("contactNumber", c.contactNumber, {
                    shouldValidate: true,
                  });
                }
              }}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="contact-number">
              Contact number <span className="text-destructive">*</span>
            </Label>
            <Controller
              control={form.control}
              name="contactNumber"
              render={({ field }) => (
                <ContactField
                  id="contact-number"
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  aria-invalid={!!errors.contactNumber}
                />
              )}
            />
            {errors.contactNumber && (
              <p className="text-sm text-destructive">
                {errors.contactNumber.message}
              </p>
            )}
          </div>

          {mode === "edit-inquiry" && (
            <div className="grid gap-2">
              <Label>Medium</Label>
              <div
                role="radiogroup"
                aria-label="Inquiry medium"
                className="flex flex-wrap gap-2"
              >
                {INQUIRY_MEDIUMS.map((m) => {
                  const selected = medium === m.value;
                  return (
                    <button
                      key={m.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setMedium(m.value)}
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "hover:bg-accent"
                      )}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <Separator />

          <div className="grid gap-2">
            <Label htmlFor="valid-until">Valid until</Label>
            <Input
              id="valid-until"
              type="date"
              min={todayISO()}
              {...form.register("validUntil")}
            />
            <p className="text-xs text-muted-foreground">
              Leave blank for no expiry.
            </p>
          </div>

          <div className="grid gap-2">
            <Label>Tax</Label>
            <Controller
              control={form.control}
              name="taxType"
              render={({ field }) => (
                <div role="radiogroup" aria-label="Tax type" className="grid gap-2 grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
                  {TAX_OPTIONS.map((o) => {
                    const selected = field.value === o.value;
                    return (
                      <button
                        key={o.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => field.onChange(o.value)}
                        className={cn(
                          "flex items-center gap-2.5 rounded-lg border p-3 text-left text-sm transition-colors",
                          selected
                            ? "border-primary bg-primary/5 ring-1 ring-primary"
                            : "hover:bg-accent/40"
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center rounded-full border",
                            selected ? "border-primary" : "border-muted-foreground/40"
                          )}
                        >
                          {selected && <span className="size-2 rounded-full bg-primary" />}
                        </span>
                        <span className="font-medium">{o.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            />
          </div>

          <div className="grid gap-2">
            <Label>Downpayment</Label>
            <Controller
              control={form.control}
              name="downpaymentRate"
              render={({ field }) => {
                const current = String(parseFloat(field.value || "0.5"));
                return (
                  <div
                    role="radiogroup"
                    aria-label="Downpayment"
                    className="grid gap-2 grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]"
                  >
                    {PAYMENT_TERMS.map((t) => {
                      const selected = current === t.rate;
                      return (
                        <button
                          key={t.rate}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => {
                            field.onChange(t.rate);
                            form.setValue("paymentTermLabel", t.label);
                          }}
                          className={cn(
                            "flex items-center gap-2.5 rounded-lg border p-3 text-left text-sm transition-colors",
                            selected
                              ? "border-primary bg-primary/5 ring-1 ring-primary"
                              : "hover:bg-accent/40"
                          )}
                        >
                          <span
                            className={cn(
                              "flex size-4 shrink-0 items-center justify-center rounded-full border",
                              selected ? "border-primary" : "border-muted-foreground/40"
                            )}
                          >
                            {selected && <span className="size-2 rounded-full bg-primary" />}
                          </span>
                          <span className="font-medium">{t.label}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              }}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="header-discount">Discount (₱)</Label>
            <Input
              id="header-discount"
              inputMode="decimal"
              placeholder="0.00"
              aria-invalid={!!errors.discount}
              {...form.register("discount")}
            />
            {errors.discount && (
              <p className="text-sm text-destructive">{errors.discount.message}</p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              rows={3}
              placeholder="Special instructions, lead time…"
              {...form.register("notes")}
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Line items</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {typeof errors.items?.message === "string" && (
              <p className="text-sm text-destructive">{errors.items.message}</p>
            )}
            {items.fields.map((field, index) => {
              const watchedItem = watched.items?.[index];
              // Whole-JO fee lines are managed in "Quotation add-ons" below, not
              // shown among the product line items.
              if (
                (watchedItem?.specs as { wholeJoAddon?: string } | undefined)
                  ?.wholeJoAddon
              ) {
                return null;
              }
              const product = watchedItem?.productId
                ? productById.get(watchedItem.productId)
                : undefined;
              const isTarp = product?.name === "Tarpaulin";
              const isNewspaper = product?.name === "Newspaper";
              const isArea =
                !isTarp &&
                !isNewspaper &&
                !!product &&
                AREA_UNITS.has(product.unit.toLowerCase());
              // The unit price is computed (not hand-typed) when a variant is
              // selected or a calculator prices the line — lock the field so it
              // can only change via the qty/variant/calculator.
              const variantLabel = (
                watchedItem?.specs as { variant?: string } | undefined
              )?.variant;
              const hasVariant = !!variantLabel;
              const priceLocked = hasVariant || isTarp || isArea || isNewspaper;
              // Variant minimum-order qty (e.g. 5+) — flag a qty below it.
              const lineMinQty = variantMinQty(watchedItem?.productId, variantLabel);
              const liveLineQty = parseInt(watchedItem?.qty ?? "", 10) || 0;
              const qtyBelowMin =
                lineMinQty > 1 && liveLineQty > 0 && liveLineQty < lineMinQty;
              return (
              <div key={field.id} className="grid gap-3 rounded-lg border p-3">
                <div className="grid gap-1 sm:max-w-96">
                  <Label htmlFor={`item-product-${index}`}>Product</Label>
                  <Controller
                    control={form.control}
                    name={`items.${index}.productId`}
                    render={({ field: pf }) => (
                      <ProductCombobox
                        id={`item-product-${index}`}
                        products={products.data ?? []}
                        value={pf.value ?? ""}
                        productName={product?.name ?? null}
                        onPick={(productId) => onProductChange(index, productId)}
                      />
                    )}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_5rem_7rem_7rem_auto]">
                <div className="grid gap-1">
                  <Label htmlFor={`item-desc-${index}`}>Description</Label>
                  <Input
                    id={`item-desc-${index}`}
                    placeholder="e.g. Tarpaulin 3×6 ft, 2 pcs, with eyelets"
                    aria-invalid={!!errors.items?.[index]?.description}
                    {...form.register(`items.${index}.description`)}
                  />
                  {errors.items?.[index]?.description && (
                    <p className="text-sm text-destructive">
                      {errors.items[index]?.description?.message}
                    </p>
                  )}
                </div>
                <div className="grid gap-1">
                  <Label htmlFor={`item-qty-${index}`}>Qty</Label>
                  <Input
                    id={`item-qty-${index}`}
                    inputMode="numeric"
                    aria-invalid={!!errors.items?.[index]?.qty || qtyBelowMin}
                    {...form.register(`items.${index}.qty`, {
                      onChange: () => refoldFees(index),
                    })}
                  />
                  {qtyBelowMin && (
                    <p className="text-xs text-destructive">
                      Min {lineMinQty} for {variantLabel}
                    </p>
                  )}
                </div>
                <div className="grid gap-1">
                  <Label htmlFor={`item-price-${index}`}>Unit price (₱)</Label>
                  <Input
                    id={`item-price-${index}`}
                    inputMode="decimal"
                    placeholder="0.00"
                    readOnly={priceLocked}
                    className={
                      priceLocked ? "bg-muted/50 text-muted-foreground" : undefined
                    }
                    title={
                      priceLocked
                        ? "Priced automatically — change the qty or variant to adjust."
                        : undefined
                    }
                    aria-invalid={!!errors.items?.[index]?.unitPrice}
                    {...form.register(`items.${index}.unitPrice`)}
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor={`item-discount-${index}`}>Less (₱)</Label>
                  <Input
                    id={`item-discount-${index}`}
                    inputMode="decimal"
                    placeholder="0.00"
                    aria-invalid={!!errors.items?.[index]?.discount}
                    {...form.register(`items.${index}.discount`)}
                  />
                </div>
                <div className="flex items-end justify-between gap-2 sm:flex-col sm:items-end">
                  <p className="pb-2 text-sm tabular-nums text-muted-foreground">
                    {php(totals.lineTotals[index] ?? 0)}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove item ${index + 1}`}
                    disabled={items.fields.length === 1}
                    onClick={() => items.remove(index)}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
                </div>
                {isTarp && (
                  <TarpCalculator
                    qty={parseInt(watchedItem?.qty || "1", 10) || 1}
                    defaultRate={parseFloat(product?.basePrice ?? "50") || 50}
                    rules={mergeGlobalAddons(
                      product?.rules ?? [],
                      globalAddons.data
                    )}
                    initialSpecs={watchedItem?.specs ?? null}
                    onApply={(result) => applyCalculator(index, result)}
                  />
                )}
                {isArea && product && (
                  <AreaCalculator
                    productName={product.name}
                    basePrice={parseFloat(product.basePrice ?? "0") || 0}
                    qty={parseInt(watchedItem?.qty || "1", 10) || 1}
                    rules={mergeGlobalAddons(
                      product.rules,
                      globalAddons.data
                    )}
                    initialSpecs={watchedItem?.specs ?? null}
                    onApply={(result) => applyCalculator(index, result)}
                  />
                )}
                {isNewspaper && (
                  <NewspaperCalculator
                    initialSpecs={watchedItem?.specs ?? null}
                    onApply={(result) => applyCalculator(index, result)}
                  />
                )}
                {!isTarp && !isArea && !isNewspaper && product && (
                  <VariantPicker
                    rules={product.rules}
                    qty={parseInt(watchedItem?.qty || "1", 10) || 1}
                    currentVariant={
                      (watchedItem?.specs as { variant?: string } | undefined)
                        ?.variant ?? null
                    }
                    currentUnitPrice={watchedItem?.unitPrice || ""}
                    onPick={(label, price) => onVariantPick(index, label, price)}
                  />
                )}
                {!isTarp && !isArea && product && (
                  <AddonPicker
                    addons={mergeGlobalAddons(
                      product.rules,
                      globalAddons.data
                    ).filter(
                      // per-line picker: line-scoped add-ons + BOTH-scope ones
                      (r) => r.type !== "ADDON" || r.scope !== "WHOLE_JO"
                    )}
                    checked={
                      (watchedItem?.specs as { addons?: string[] } | undefined)
                        ?.addons ?? []
                    }
                    onToggle={(label) => {
                      const current = form.getValues(`items.${index}`);
                      const specs = (current.specs ?? {}) as {
                        addons?: string[];
                        baseUnit?: string;
                      };
                      const checked = specs.addons ?? [];
                      const next = checked.includes(label)
                        ? checked.filter((l) => l !== label)
                        : [...checked, label];
                      const base =
                        specs.baseUnit != null
                          ? parseFloat(specs.baseUnit)
                          : parseFloat(current.unitPrice || "0");
                      applyFees(index, base || 0, next);
                    }}
                  />
                )}
              </div>
              );
            })}
            <Button
              type="button"
              variant="outline"
              className="w-fit"
              onClick={() => items.append(EMPTY_ITEM)}
            >
              <PlusIcon /> Add item
            </Button>
          </CardContent>
        </Card>

        {wholeJoAddons.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Quotation add-ons</CardTitle>
              <p className="text-sm text-muted-foreground">
                Fees applied once to the whole quotation — not per line item.
              </p>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {wholeJoAddons.map((a) => {
                const checked = wholeJoChecked(a.label);
                const feeLabel = a.pct
                  ? `${a.pct}%`
                  : php(parseFloat(a.amount ?? "0") || 0);
                return (
                  <button
                    key={a.label}
                    type="button"
                    onClick={() => toggleWholeJo(a)}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                      checked
                        ? "border-primary bg-primary/10"
                        : "hover:bg-accent"
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-4 place-items-center rounded border",
                        checked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input"
                      )}
                    >
                      {checked && <CheckIcon className="size-3" />}
                    </span>
                    {a.label}
                    <span className="text-muted-foreground">· {feeLabel}</span>
                  </button>
                );
              })}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Totals</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1.5 text-sm">
            <TotalRow label="Subtotal" value={php(totals.subtotal)} />
            {totals.discount > 0 && (
              <TotalRow label="Discount" value={`− ${php(totals.discount)}`} />
            )}
            {watched.taxType === "VAT_EXCLUSIVE" && (
              <TotalRow label="VAT (12%)" value={php(totals.taxAmount)} />
            )}
            {watched.taxType === "VAT_INCLUSIVE" && (
              <TotalRow
                label="VAT included (12%)"
                value={php(totals.taxAmount)}
                muted
              />
            )}
            <Separator className="my-1" />
            <TotalRow label="Total" value={php(totals.total)} strong />
            <TotalRow label="Downpayment" value={php(totals.downpayment)} />
            <TotalRow label="Balance" value={php(totals.balance)} />
          </CardContent>
        </Card>

        <div className="grid gap-3">
          <div className="flex items-center gap-2">
            {mode === "edit-inquiry" ? (
              <Button type="button" onClick={saveInquiry} disabled={savingInquiry}>
                {savingInquiry ? "Saving…" : "Save inquiry"}
              </Button>
            ) : (
              <Button type="submit" disabled={isSubmitting || loggingInquiry}>
                {isSubmitting
                  ? "Saving…"
                  : mode === "create"
                    ? "Create quotation"
                    : "Save changes"}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
              disabled={isSubmitting || loggingInquiry || savingInquiry}
            >
              Cancel
            </Button>
          </div>

          {/* Only on a FRESH quote. When drafting FROM an inquiry (inquiryId set)
              you're converting it — logging again would duplicate the inquiry,
              so hide this; "Create quotation" links the existing inquiry. */}
          {mode === "create" && !inquiryId && (
            <div className="grid gap-2 rounded-lg border border-dashed p-3">
              <p className="text-sm font-medium">
                Not ready to quote — just an inquiry?
              </p>
              <p className="text-xs text-muted-foreground">
                Log it as a lead instead. Uses the customer, contact, and item
                descriptions above — no pricing needed.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  How they reached you:
                </span>
                {INQUIRY_MEDIUMS.map((m) => {
                  const selected = medium === m.value;
                  return (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => setMedium(m.value)}
                      className={cn(
                        "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "hover:bg-accent"
                      )}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-fit"
                onClick={logInquiry}
                disabled={loggingInquiry || isSubmitting}
              >
                <InboxIcon />
                {loggingInquiry ? "Logging…" : "Log inquiry instead"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </form>
  );
}

function TotalRow({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between",
        strong && "text-base font-semibold",
        muted && "text-muted-foreground"
      )}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function php(n: number): string {
  return `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
}

// Optional add-on fees (product ADDON rules + global add-ons) as toggle cards —
// checking one folds its fee into the line price (see applyFees).
function AddonPicker({
  addons,
  checked,
  onToggle,
}: {
  addons: ProductRuleDto[];
  checked: string[];
  onToggle: (label: string) => void;
}) {
  const fees = addons.filter((r) => r.type === "ADDON");
  if (fees.length === 0) return null;
  return (
    <div className="grid gap-2 rounded-lg bg-muted/50 p-3">
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
              onClick={() => onToggle(f.label)}
              className={cn(
                "flex items-center justify-between gap-2 rounded-lg border bg-background p-3 text-left text-sm transition-colors",
                on ? "border-primary ring-1 ring-primary" : "hover:bg-accent/40"
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
  );
}
