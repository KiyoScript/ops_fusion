"use client";

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
import {
  useInvalidateJobOrders,
  useJoDeadlineHistory,
} from "../hooks/use-job-orders";
import { StatusHistoryTimeline } from "./status-history-timeline";

/** Legacy updateJORow modal: edits ONE line item — the board's Edit action. */
export function ItemEditDialog({
  row,
  onClose,
  onEditJo,
}: {
  row: JobOrderItemRowDto | null;
  onClose: () => void;
  /** Opens the whole-JO editor (add/remove items, notes) instead. */
  onEditJo?: (jobOrderId: string) => void;
}) {
  const invalidate = useInvalidateJobOrders();
  const statusLookups = useLookupOptions("JO_STATUS");
  const categoryLookups = useLookupOptions("JO_CATEGORY");
  const employees = useEmployeeOptions();
  const deadlineMoves = useJoDeadlineHistory(row?.jobOrderId ?? null);

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
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit Item</DialogTitle>
          <DialogDescription>
            {row ? `${row.lineItemId ?? row.joNumber} — ${row.customerName}` : ""}
          </DialogDescription>
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
              <Label htmlFor="ie-amount">JO Amount *</Label>
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">
                  ₱
                </span>
                <Input
                  id="ie-amount"
                  inputMode="decimal"
                  className="pl-7"
                  aria-invalid={!!errors.amount}
                  {...form.register("amount")}
                />
              </div>
              <FieldError message={errors.amount?.message} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ie-deadline">Deadline</Label>
              <Input id="ie-deadline" type="date" {...form.register("deadline")} />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ie-status">Team Status</Label>
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
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                {...form.register("isRush")}
              />
              🔥 Rush item
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

          <div className="grid gap-1 text-xs">
            <span className="font-medium">Deadline moves</span>
            {deadlineMoves.data && deadlineMoves.data.length > 0 ? (
              <ul className="grid max-h-24 gap-1 overflow-y-auto rounded-lg border p-2 text-muted-foreground">
                {deadlineMoves.data.map((move, i) => (
                  <li key={i}>
                    {move.dateDisplay} — {move.user}:{" "}
                    <span className="line-through">{move.oldDeadline}</span> →{" "}
                    <span className="font-medium text-foreground">
                      {move.newDeadline}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed px-3 py-2 text-muted-foreground italic">
                No deadline moves recorded for this JO.
              </p>
            )}
          </div>

          <StatusHistoryTimeline history={row?.statusHistory ?? null} />

          <div className="grid gap-2 rounded-lg bg-muted/50 p-3">
            <Label htmlFor="ie-remark" className="text-xs font-bold tracking-wide uppercase">
              Add new status update
            </Label>
            <Textarea
              id="ie-remark"
              rows={2}
              placeholder="e.g. Printing done, for lamination…"
              {...form.register("remark")}
            />
            <p className="text-xs text-muted-foreground">
              📅 Date &amp; time will be prepended automatically — e.g.{" "}
              <em>4/23 2:30 PM Ongoing</em>
            </p>
          </div>

          <DialogFooter className="sm:flex-col sm:items-stretch">
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save Changes"}
            </Button>
            <div className="flex items-center justify-between">
              {row && onEditJo ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => onEditJo(row.jobOrderId)}
                >
                  Edit whole JO (add/remove items)
                </Button>
              ) : (
                <span />
              )}
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
            </div>
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
    deadline: row.deadline ?? "",
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
