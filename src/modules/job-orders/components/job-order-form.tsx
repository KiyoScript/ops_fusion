"use client";

import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { todayISO } from "@/components/validated-fields";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  createJobOrderAction,
  updateJobOrderAction,
} from "@/app/(app)/job-orders/actions";
import {
  jobOrderCreateInput,
  jobOrderEditFormInput,
  type JobOrderCreateInput,
} from "../schemas/job-order";
import {
  isDoneStatus,
  PRODUCTION_STATUS_SUGGESTIONS,
} from "../services/production-status";
import { SuggestInput } from "@/components/suggest-input";
import { numericField } from "@/lib/form-numeric";
import { useLookupOptions } from "@/modules/shared/hooks/use-lookups";
import { useEmployeeOptions } from "@/modules/shared/hooks/use-employees";
import { CustomerCombobox } from "./customer-combobox";

const EMPTY_ITEM: JobOrderCreateInput["items"][number] = {
  fromQuote: false,
  description: "",
  qty: "1",
  amount: "",
  deadline: "",
  productionStatus: "",
  remark: "",
  assignedTo: "",
  category: "",
  isLFP: false,
  lfpWidth: "",
  lfpHeight: "",
  lfpUnit: "ft",
  isRush: false,
};

export function JobOrderForm({
  mode,
  jobOrderId,
  initialValues,
  onSuccess,
  onCancel,
  twoColumn = false,
}: {
  mode: "create" | "edit";
  jobOrderId?: string;
  initialValues?: JobOrderCreateInput;
  /** When set (modal usage), called after save instead of navigating. */
  onSuccess?: () => void;
  onCancel?: () => void;
  /** Page layout: JO details on the left, line items on the right. */
  twoColumn?: boolean;
}) {
  const router = useRouter();
  const form = useForm<JobOrderCreateInput>({
    // Create enforces the legacy per-item deadline rule; edit stays lax so
    // imported items with blank deadlines remain saveable.
    resolver: zodResolver(
      mode === "create" ? jobOrderCreateInput : jobOrderEditFormInput
    ),
    defaultValues: initialValues ?? {
      joNumber: "",
      // Quotation-first (ruling 2026-07-15): production JOs and POs are born
      // by CONVERTING a quotation — direct entry here is for walk-in Non-JO
      // counter jobs only (xerox, photocopies, supplies).
      isPO: false,
      isNonJo: true,
      customerName: "",
      notes: "",
      planDateStart: "",
      planDateEnd: "",
      items: [EMPTY_ITEM],
    },
  });
  const items = useFieldArray({ control: form.control, name: "items" });
  const watchedItems = useWatch({ control: form.control, name: "items" });
  const watchedIsPO = useWatch({ control: form.control, name: "isPO" });
  const watchedIsNonJo = useWatch({ control: form.control, name: "isNonJo" });
  const { errors, isSubmitting } = form.formState;

  // Maintained dropdown lists (Maintenance → Job Orders). Statuses fall back
  // to the built-in defaults until the list is maintained.
  const statusLookups = useLookupOptions("JO_STATUS");
  const employees = useEmployeeOptions();
  const categoryLookups = useLookupOptions("JO_CATEGORY");
  const statusOptions = statusLookups.data?.length
    ? statusLookups.data.map((o) => o.label)
    : [...PRODUCTION_STATUS_SUGGESTIONS];
  // Shows "CODE — Name (Team)" but stores the CODE, like legacy EMPDATABASE.
  const employeeOptions = (employees.data ?? []).map((e) => ({
    value: e.code,
    label: `${e.code} — ${e.name}${e.team ? ` (${e.team})` : ""}`,
  }));
  const categoryOptions = categoryLookups.data?.map((o) => o.label) ?? [];

  const onSubmit = form.handleSubmit(async (values) => {
    // Quote-derived items keep a locked amount = qty × unit price (the field is
    // read-only), so recompute it here in case the qty changed.
    const payload = {
      ...values,
      items: values.items.map((it) =>
        it.fromQuote
          ? { ...it, amount: lockedAmount(it.qty, it.unitPrice).toFixed(2) }
          : it
      ),
    };
    const result =
      mode === "create"
        ? await createJobOrderAction(payload)
        : await updateJobOrderAction({ ...payload, id: jobOrderId });

    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(
      mode === "create"
        ? `${values.joNumber?.trim() || "Job order"} created.`
        : "Job order updated."
    );
    if (onSuccess) {
      onSuccess();
      router.refresh();
      return;
    }
    router.push("/job-orders");
    router.refresh();
  });

  return (
    <form
      onSubmit={onSubmit}
      className={
        twoColumn
          ? "grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
          : "grid max-w-3xl gap-6"
      }
      noValidate
    >
      <Card
        className={twoColumn ? "lg:col-start-1 lg:row-start-1" : undefined}
      >
        <CardHeader>
          <CardTitle>Job order details</CardTitle>
        </CardHeader>
        <CardContent
          className={
            twoColumn ? "grid gap-4" : "grid gap-4 sm:grid-cols-2"
          }
        >
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="joNumber">
                {watchedIsPO
                  ? "PO Number"
                  : watchedIsNonJo
                    ? "Reference #"
                    : "JO Number"}
              </Label>
              {mode === "create" && (
                // Quotation-first: only walk-in Non-JO counter jobs are
                // encoded directly — JOs/POs arrive by converting a quotation.
                <span
                  className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
                  title="Walk-in counter job — xerox, photocopies, supplies. Production JOs and POs are created by converting a quotation."
                >
                  Non-JO · walk-in
                </span>
              )}
            </div>
            <Input
              id="joNumber"
              placeholder={
                watchedIsPO
                  ? "Type the customer's PO number"
                  : watchedIsNonJo
                    ? "Type the reference number"
                    : "Auto-generated (JO-ORM-…)"
              }
              disabled={mode === "edit" || (!watchedIsPO && !watchedIsNonJo)}
              aria-invalid={!!errors.joNumber}
              {...form.register("joNumber")}
            />
            <FieldError message={errors.joNumber?.message ?? errors.isPO?.message} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="customerName">Customer</Label>
            {mode === "edit" ? (
              <>
                {/* Locked on edit — the customer comes from the quotation and
                    doesn't change once the JO exists. */}
                <Input
                  id="customerName"
                  readOnly
                  value={form.getValues("customerName")}
                  className="bg-muted/50 text-muted-foreground"
                />
                <p className="text-xs text-muted-foreground">
                  Locked — set from the quotation.
                </p>
              </>
            ) : (
              <>
                <Controller
                  control={form.control}
                  name="customerName"
                  render={({ field }) => (
                    <CustomerCombobox
                      id="customerName"
                      value={field.value}
                      onChange={field.onChange}
                      invalid={!!errors.customerName}
                    />
                  )}
                />
                <FieldError message={errors.customerName?.message} />
              </>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="planDateStart">Plan start</Label>
            <Input
              id="planDateStart"
              type="date"
              min={mode === "create" ? todayISO() : undefined}
              {...form.register("planDateStart")}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="planDateEnd">Plan end</Label>
            <Input
              id="planDateEnd"
              type="date"
              min={mode === "create" ? todayISO() : undefined}
              {...form.register("planDateEnd")}
            />
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" rows={2} {...form.register("notes")} />
          </div>
        </CardContent>
      </Card>

      <Card
        className={
          twoColumn ? "lg:col-start-2 lg:row-span-2 lg:row-start-1" : undefined
        }
      >
        <CardHeader>
          <CardTitle>Line items ({items.fields.length})</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6">
          {typeof errors.items?.message === "string" && (
            <FieldError message={errors.items.message} />
          )}
          {items.fields.map((field, index) => (
            <div key={field.id} className="grid gap-4">
              {index > 0 && <Separator />}
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-muted-foreground">
                  Item {index + 1}
                </p>
                {items.fields.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove item ${index + 1}`}
                    onClick={() => items.remove(index)}
                  >
                    <Trash2Icon />
                  </Button>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor={`item-desc-${index}`}>Job description</Label>
                <Textarea
                  id={`item-desc-${index}`}
                  rows={2}
                  readOnly={field.fromQuote}
                  aria-invalid={!!errors.items?.[index]?.description}
                  className={
                    field.fromQuote ? "bg-muted/50 text-muted-foreground" : undefined
                  }
                  {...form.register(`items.${index}.description`)}
                />
                {field.fromQuote ? (
                  <p className="text-xs text-muted-foreground">
                    Locked — copied from the approved quotation. Use the JO notes
                    for extra requirements.
                  </p>
                ) : (
                  <FieldError
                    message={errors.items?.[index]?.description?.message}
                  />
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="grid gap-2">
                  <Label htmlFor={`item-qty-${index}`}>Qty</Label>
                  <Input
                    id={`item-qty-${index}`}
                    aria-invalid={!!errors.items?.[index]?.qty}
                    {...numericField(
                      form.register(`items.${index}.qty`),
                      "integer"
                    )}
                  />
                  <FieldError message={errors.items?.[index]?.qty?.message} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`item-amount-${index}`}>JO Amount (₱)</Label>
                  {field.fromQuote ? (
                    <ReadonlyAmount
                      index={index}
                      unitPrice={field.unitPrice ?? "0"}
                      qty={watchedItems?.[index]?.qty}
                    />
                  ) : (
                    <>
                      <Input
                        id={`item-amount-${index}`}
                        aria-invalid={!!errors.items?.[index]?.amount}
                        {...numericField(
                          form.register(`items.${index}.amount`),
                          "decimal"
                        )}
                      />
                      <FieldError message={errors.items?.[index]?.amount?.message} />
                    </>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`item-deadline-${index}`}>Deadline</Label>
                  <Input
                    id={`item-deadline-${index}`}
                    type="date"
                    min={mode === "create" ? todayISO() : undefined}
                    {...form.register(`items.${index}.deadline`)}
                  />
                </div>
                {/* Category + LFP appear on create only, matching the legacy
                    forms (updateJORow had neither). */}
                {mode === "create" && (
                  <div className="grid gap-2">
                    <Label htmlFor={`item-category-${index}`}>Category</Label>
                    <Controller
                      control={form.control}
                      name={`items.${index}.category`}
                      render={({ field }) => (
                        <SuggestInput
                          id={`item-category-${index}`}
                          value={field.value ?? ""}
                          onChange={field.onChange}
                          options={categoryOptions}
                          placeholder="Tarpaulin, Photocopy…"
                        />
                      )}
                    />
                  </div>
                )}
                <div className="grid gap-2">
                  <Label htmlFor={`item-status-${index}`}>
                    {mode === "create" ? "Initial status" : "Status"}
                  </Label>
                  <Controller
                    control={form.control}
                    name={`items.${index}.productionStatus`}
                    render={({ field }) => (
                      <SuggestInput
                        id={`item-status-${index}`}
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        options={statusOptions}
                        placeholder="e.g. Ongoing - Printing"
                      />
                    )}
                  />
                </div>
                {mode === "edit" && watchedItems?.[index]?.id && (
                  <div className="grid gap-2">
                    <Label htmlFor={`item-remark-${index}`}>
                      Remark (goes to history)
                    </Label>
                    <Input
                      id={`item-remark-${index}`}
                      placeholder="Optional"
                      {...form.register(`items.${index}.remark`)}
                    />
                  </div>
                )}
                <div className="grid gap-2">
                  <Label htmlFor={`item-assigned-${index}`}>Assigned to</Label>
                  <Controller
                    control={form.control}
                    name={`items.${index}.assignedTo`}
                    render={({ field }) => (
                      <SuggestInput
                        id={`item-assigned-${index}`}
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        options={employeeOptions}
                        multiple
                      />
                    )}
                  />
                </div>
              </div>

              {isDoneStatus(watchedItems?.[index]?.productionStatus) &&
                (mode === "create" ||
                  watchedItems?.[index]?.productionStatus !==
                    initialValues?.items[index]?.productionStatus) && (
                  <p className="rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
                    Status is marked as <strong>Done</strong> — this item will
                    be auto-archived and removed from the active list upon
                    saving.
                  </p>
                )}

              {/* LFP is a Product attribute now (fixed-standard production) —
                  Non-JO walk-ins (xerox/photocopy/supplies) are never large
                  format, so no manual LFP flag/dimensions here. Production JOs
                  inherit LFP from the quotation's products. */}
            </div>
          ))}

          {/* Adding items only makes sense on direct/walk-in entry (create).
              An existing JO gets its items from the approved quotation, so the
              editor doesn't offer "Add Item" (ruling 2026-07-24). */}
          {mode === "create" && (
            <Button
              type="button"
              className="w-full"
              onClick={() => items.append(EMPTY_ITEM)}
            >
              <PlusIcon /> Add Item to List
            </Button>
          )}
        </CardContent>
      </Card>

      <div
        className={
          twoColumn
            ? "flex flex-col gap-2 lg:col-start-1 lg:row-start-2 lg:self-start"
            : "flex items-center gap-2"
        }
      >
        <Button
          type="submit"
          disabled={isSubmitting}
          className={twoColumn ? "w-full" : undefined}
        >
          {isSubmitting
            ? "Saving…"
            : mode === "create"
              ? "Create Job Order"
              : "Save changes"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => (onCancel ? onCancel() : router.back())}
          disabled={isSubmitting}
          className={twoColumn ? "w-full" : undefined}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}

/** Locked line total for a quote-derived item: qty × unit price. */
function lockedAmount(qty: string | undefined, unitPrice: string | undefined): number {
  const q = Math.max(parseInt(qty ?? "", 10) || 0, 0);
  const up = parseFloat(unitPrice ?? "0") || 0;
  return Math.round(q * up * 100) / 100;
}

const pesoFmt = (n: number) =>
  n.toLocaleString("en-PH", { minimumFractionDigits: 2 });

/** Read-only JO Amount for quote-derived items — auto = qty × unit price. */
function ReadonlyAmount({
  index,
  unitPrice,
  qty,
}: {
  index: number;
  unitPrice: string;
  qty?: string;
}) {
  const q = Math.max(parseInt(qty ?? "", 10) || 0, 0);
  const up = parseFloat(unitPrice) || 0;
  return (
    <>
      <Input
        id={`item-amount-${index}`}
        readOnly
        className="bg-muted/50 text-muted-foreground"
        value={pesoFmt(lockedAmount(qty, unitPrice))}
      />
      <p className="text-xs text-muted-foreground">
        Auto: {q} × ₱{pesoFmt(up)}
      </p>
    </>
  );
}
