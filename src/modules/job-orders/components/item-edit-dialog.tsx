"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SuggestInput } from "@/components/suggest-input";
import { useLookupOptions } from "@/modules/shared/hooks/use-lookups";
import { useEmployeeOptions } from "@/modules/shared/hooks/use-employees";
import { updateItemAction } from "@/app/(app)/job-orders/actions";
import {
  itemEditInput,
  type ItemEditInput,
  type JobOrderItemRowDto,
} from "../schemas/job-order";
import {
  isDoneStatus,
  PRODUCTION_STATUS_SUGGESTIONS,
} from "../services/production-status";
import { useInvalidateJobOrders } from "../hooks/use-job-orders";

/** Legacy updateJORow modal: edit one line item's fields and status. */
export function ItemEditDialog({
  row,
  onClose,
}: {
  row: JobOrderItemRowDto | null;
  onClose: () => void;
}) {
  const invalidate = useInvalidateJobOrders();
  const statusLookups = useLookupOptions("JO_STATUS");
  const categoryLookups = useLookupOptions("JO_CATEGORY");
  const employees = useEmployeeOptions();

  const form = useForm<ItemEditInput>({
    resolver: zodResolver(itemEditInput),
    defaultValues: emptyValues(),
  });

  // Re-seed the form whenever a different row is opened.
  useEffect(() => {
    if (row) form.reset(rowToValues(row));
  }, [row, form]);

  const watchedStatus = useWatch({ control: form.control, name: "productionStatus" });
  const watchedLFP = useWatch({ control: form.control, name: "isLFP" });
  const { errors, isSubmitting } = form.formState;

  const statusOptions = statusLookups.data?.length
    ? statusLookups.data.map((o) => o.label)
    : [...PRODUCTION_STATUS_SUGGESTIONS];
  const categoryOptions = categoryLookups.data?.map((o) => o.label) ?? [];
  const employeeOptions = (employees.data ?? []).map((e) => ({
    value: e.code,
    label: `${e.code} — ${e.name}${e.team ? ` (${e.team})` : ""}`,
  }));

  const statusChanged =
    !!row && (watchedStatus ?? "") !== (row.productionStatus ?? "");
  const willArchive = statusChanged && isDoneStatus(watchedStatus);

  const onSubmit = form.handleSubmit(async (values) => {
    const result = await updateItemAction(values);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Item updated.");
    invalidate();
    onClose();
  });

  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            Edit item — {row?.joNumber}
            {row?.lineItemId ? ` (${row.lineItemId})` : ""}
          </DialogTitle>
          <DialogDescription>{row?.customerName}</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-2">
            <Label htmlFor="ie-desc">Job description</Label>
            <Textarea
              id="ie-desc"
              rows={2}
              aria-invalid={!!errors.description}
              {...form.register("description")}
            />
            <FieldError message={errors.description?.message} />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="ie-qty">Qty</Label>
              <Input
                id="ie-qty"
                inputMode="numeric"
                aria-invalid={!!errors.qty}
                {...form.register("qty")}
              />
              <FieldError message={errors.qty?.message} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ie-amount">JO Amount (₱)</Label>
              <Input
                id="ie-amount"
                inputMode="decimal"
                aria-invalid={!!errors.amount}
                {...form.register("amount")}
              />
              <FieldError message={errors.amount?.message} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ie-deadline">Deadline</Label>
              <Input id="ie-deadline" type="date" {...form.register("deadline")} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="ie-status">Status</Label>
              <Controller
                control={form.control}
                name="productionStatus"
                render={({ field }) => (
                  <SuggestInput
                    id="ie-status"
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    options={statusOptions}
                    placeholder="e.g. Ongoing - Printing"
                  />
                )}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ie-remark">Remark (goes to history)</Label>
              <Input
                id="ie-remark"
                placeholder="Optional"
                {...form.register("remark")}
              />
            </div>
          </div>

          {willArchive && (
            <p className="rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
              Status is marked as <strong>Done</strong> — this item will be
              auto-archived and removed from the active list upon saving.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="ie-assigned">Assigned to</Label>
              <Controller
                control={form.control}
                name="assignedTo"
                render={({ field }) => (
                  <SuggestInput
                    id="ie-assigned"
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    options={employeeOptions}
                    multiple
                  />
                )}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ie-category">Category</Label>
              <Controller
                control={form.control}
                name="category"
                render={({ field }) => (
                  <SuggestInput
                    id="ie-category"
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    options={categoryOptions}
                  />
                )}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-6">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                {...form.register("isRush")}
              />
              Rush
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                {...form.register("isLFP")}
              />
              LFP (large format)
            </label>
          </div>

          {watchedLFP && (
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="ie-lfpw">Width</Label>
                <Input
                  id="ie-lfpw"
                  aria-invalid={!!errors.lfpWidth}
                  {...form.register("lfpWidth")}
                />
                <FieldError message={errors.lfpWidth?.message} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ie-lfph">Height</Label>
                <Input id="ie-lfph" {...form.register("lfpHeight")} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ie-lfpu">Unit</Label>
                <Input id="ie-lfpu" placeholder="ft" {...form.register("lfpUnit")} />
              </div>
            </div>
          )}

          {row?.statusHistory && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Status history
              </summary>
              <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-sans text-muted-foreground">
                {row.statusHistory}
              </pre>
            </details>
          )}

          <DialogFooter showCloseButton className="sm:justify-between">
            {row && (
              <Button
                type="button"
                variant="ghost"
                nativeButton={false}
                render={<Link href={`/job-orders/${row.jobOrderId}/edit`} />}
                className="text-muted-foreground"
              >
                Full JO edit (items, notes)
              </Button>
            )}
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function emptyValues(): ItemEditInput {
  return {
    id: "",
    jobOrderId: "",
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
}

function rowToValues(row: JobOrderItemRowDto): ItemEditInput {
  return {
    id: row.id,
    jobOrderId: row.jobOrderId,
    description: row.description,
    qty: String(row.qty),
    amount: row.lineTotal,
    deadline: row.deadline?.slice(0, 10) ?? "",
    productionStatus: row.productionStatus ?? "",
    remark: "",
    assignedTo: row.assignedTo ?? "",
    category: row.category ?? "",
    isLFP: row.isLFP,
    lfpWidth: row.lfpWidth ?? "",
    lfpHeight: row.lfpHeight ?? "",
    lfpUnit: row.lfpUnit ?? "ft",
    isRush: row.isRush,
  };
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}
