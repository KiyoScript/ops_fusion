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
      isPO: false,
      isNonJo: false,
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
  const lfpCategories = new Set(
    (categoryLookups.data ?? [])
      .filter((o) => o.isLFP)
      .map((o) => o.label.toLowerCase())
  );

  const onSubmit = form.handleSubmit(async (values) => {
    const result =
      mode === "create"
        ? await createJobOrderAction(values)
        : await updateJobOrderAction({ ...values, id: jobOrderId });

    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(
      mode === "create"
        ? `${values.joNumber?.trim() || "Job order"} created.`
        : "Job order updated."
    );
    if (mode === "create") {
      // open the printable right away (says "THIS IS FOR APPROVAL" until the
      // customer approves)
      window.open(
        `/api/job-orders/${(result.data as { id: string }).id}/pdf`,
        "_blank",
        "noopener"
      );
    }
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
              <span className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    disabled={mode === "edit"}
                    {...form.register("isPO", {
                      onChange: (e) => {
                        if (e.target.checked) form.setValue("isNonJo", false);
                      },
                    })}
                  />
                  PO
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    disabled={mode === "edit"}
                    {...form.register("isNonJo", {
                      onChange: (e) => {
                        if (e.target.checked) form.setValue("isPO", false);
                      },
                    })}
                  />
                  Non-JO
                </label>
              </span>
            </div>
            <Input
              id="joNumber"
              placeholder={
                watchedIsPO
                  ? "Type the customer's PO number"
                  : watchedIsNonJo
                    ? "Type the reference number"
                    : "Auto-generated (R-AD…)"
              }
              disabled={mode === "edit" || (!watchedIsPO && !watchedIsNonJo)}
              aria-invalid={!!errors.joNumber}
              {...form.register("joNumber")}
            />
            <FieldError message={errors.joNumber?.message ?? errors.isPO?.message} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="customerName">Customer</Label>
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
          </div>
          <div className="grid gap-2">
            <Label htmlFor="planDateStart">Plan start</Label>
            <Input id="planDateStart" type="date" {...form.register("planDateStart")} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="planDateEnd">Plan end</Label>
            <Input id="planDateEnd" type="date" {...form.register("planDateEnd")} />
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
                  aria-invalid={!!errors.items?.[index]?.description}
                  {...form.register(`items.${index}.description`)}
                />
                <FieldError
                  message={errors.items?.[index]?.description?.message}
                />
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
                  <Input
                    id={`item-amount-${index}`}
                    aria-invalid={!!errors.items?.[index]?.amount}
                    {...numericField(
                      form.register(`items.${index}.amount`),
                      "decimal"
                    )}
                  />
                  <FieldError message={errors.items?.[index]?.amount?.message} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`item-deadline-${index}`}>Deadline</Label>
                  <Input
                    id={`item-deadline-${index}`}
                    type="date"
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
                          onChange={(value) => {
                            field.onChange(value);
                            // Legacy OPSServices "LF" rule: LFP categories flip
                            // the large-format flag automatically.
                            if (lfpCategories.has(value.trim().toLowerCase())) {
                              form.setValue(`items.${index}.isLFP`, true);
                            }
                          }}
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

              <div className="flex flex-wrap items-center gap-6">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    {...form.register(`items.${index}.isRush`)}
                  />
                  Rush
                </label>
                {mode === "create" && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      {...form.register(`items.${index}.isLFP`)}
                    />
                    LFP (large format)
                  </label>
                )}
              </div>

              {mode === "create" && watchedItems?.[index]?.isLFP && (
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="grid gap-2">
                    <Label htmlFor={`item-lfpw-${index}`}>Width</Label>
                    <Input
                      id={`item-lfpw-${index}`}
                      aria-invalid={!!errors.items?.[index]?.lfpWidth}
                      {...form.register(`items.${index}.lfpWidth`)}
                    />
                    <FieldError
                      message={errors.items?.[index]?.lfpWidth?.message}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor={`item-lfph-${index}`}>Height</Label>
                    <Input
                      id={`item-lfph-${index}`}
                      {...form.register(`items.${index}.lfpHeight`)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor={`item-lfpu-${index}`}>Unit</Label>
                    <Input
                      id={`item-lfpu-${index}`}
                      placeholder="ft"
                      {...form.register(`items.${index}.lfpUnit`)}
                    />
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Bottom placement + full width, like the legacy "+ Add Item to
              List" button — always visible after the last item. */}
          <Button
            type="button"
            className="w-full"
            onClick={() => items.append(EMPTY_ITEM)}
          >
            <PlusIcon /> Add Item to List
          </Button>
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
