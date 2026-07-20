"use client";

import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { todayISO } from "@/components/validated-fields";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  createQuotationAction,
  updateQuotationAction,
} from "@/app/(app)/quotations/actions";
import {
  quotationCreateInput,
  type QuotationCreateInput,
} from "../schemas/quotation";
import { computeTotals } from "../services/totals";
import { CustomerCombobox } from "@/modules/job-orders/components/customer-combobox";
import {
  mergeGlobalAddons,
  useGlobalAddons,
  useProductOptions,
} from "@/modules/shared/hooks/use-products";
import { TarpCalculator } from "./tarp-calculator";
import { VariantPicker } from "./variant-picker";
import { ProductCombobox } from "./product-combobox";

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
}: {
  mode: "create" | "edit";
  quotationId?: string;
  initialValues?: QuotationCreateInput;
  /** Set when drafting from an inquiry — the create links Inquiry → quote. */
  inquiryId?: string;
}) {
  const router = useRouter();
  const form = useForm<QuotationCreateInput>({
    resolver: zodResolver(quotationCreateInput),
    defaultValues: {
      ...(initialValues ?? {
        type: "SALES",
        poNumber: "",
        customerName: "",
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
    form.setValue(`items.${index}.productId`, productId);
    const product = productById.get(productId);
    if (!product) return;
    const current = form.getValues(`items.${index}`);
    if (!current.unitPrice && parseFloat(product.basePrice) > 0) {
      form.setValue(`items.${index}.unitPrice`, product.basePrice);
    }
    if (!current.description) {
      form.setValue(`items.${index}.description`, product.name);
    }
  };

  // Variant pick: price from the qty tier, variant recorded in specs, and
  // the description prefilled only while it still is the bare product name.
  const onVariantPick = (index: number, label: string, price: string) => {
    const current = form.getValues(`items.${index}`);
    const product = current.productId
      ? productById.get(current.productId)
      : undefined;
    form.setValue(`items.${index}.unitPrice`, price, { shouldValidate: true });
    form.setValue(`items.${index}.specs`, {
      ...(current.specs ?? {}),
      variant: label,
    });
    if (product && (!current.description || current.description === product.name)) {
      form.setValue(`items.${index}.description`, `${product.name} — ${label}`);
    }
  };

  const applyCalculator = (
    index: number,
    result: { description: string; unitPrice: string; specs: Record<string, unknown> }
  ) => {
    form.setValue(`items.${index}.description`, result.description, {
      shouldValidate: true,
    });
    form.setValue(`items.${index}.unitPrice`, result.unitPrice, {
      shouldValidate: true,
    });
    form.setValue(`items.${index}.specs`, result.specs);
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

  const onSubmit = form.handleSubmit(async (values) => {
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
    router.push(`/quotations/${(result.data as { id: string }).id}`);
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} className="grid gap-4 lg:grid-cols-[24rem_1fr]">
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
                <Select
                  value={field.value}
                  onValueChange={(v) => field.onChange(v ?? "SALES")}
                >
                  <SelectTrigger aria-label="Quotation type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SALES">Sales Quotation</SelectItem>
                    <SelectItem value="PO">PO Quotation</SelectItem>
                    <SelectItem value="NON_JO">Non-JO Quotation</SelectItem>
                  </SelectContent>
                </Select>
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
                  invalid={!!errors.customerName}
                />
              )}
            />
            {errors.customerName && (
              <p className="text-sm text-destructive">
                {errors.customerName.message}
              </p>
            )}
          </div>

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
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger aria-label="Tax type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TAX_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="grid gap-2">
            <Label>Payment term</Label>
            <Controller
              control={form.control}
              name="downpaymentRate"
              render={({ field }) => (
                <Select
                  value={String(parseFloat(field.value || "0.5"))}
                  onValueChange={(rate) => {
                    field.onChange(rate);
                    form.setValue(
                      "paymentTermLabel",
                      PAYMENT_TERMS.find((t) => t.rate === rate)?.label ?? ""
                    );
                  }}
                >
                  <SelectTrigger aria-label="Payment term">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_TERMS.map((t) => (
                      <SelectItem key={t.rate} value={t.rate}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
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
              const product = watchedItem?.productId
                ? productById.get(watchedItem.productId)
                : undefined;
              const isTarp = product?.name === "Tarpaulin";
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
                    aria-invalid={!!errors.items?.[index]?.qty}
                    {...form.register(`items.${index}.qty`)}
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor={`item-price-${index}`}>Unit price (₱)</Label>
                  <Input
                    id={`item-price-${index}`}
                    inputMode="decimal"
                    placeholder="0.00"
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
                {!isTarp && product && (
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

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? "Saving…"
              : mode === "create"
                ? "Create quotation"
                : "Save changes"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
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
