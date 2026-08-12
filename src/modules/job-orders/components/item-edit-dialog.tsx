"use client";

import { useEffect, useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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
import { SuggestInput } from "@/components/suggest-input";
import { ItemStepsChecklist } from "./item-steps-checklist";
import { numericField } from "@/lib/form-numeric";
import { useLookupOptions } from "@/modules/shared/hooks/use-lookups";
import { useEmployeeOptions } from "@/modules/shared/hooks/use-employees";
import { setJoCaptureAction, updateItemAction } from "@/app/(app)/job-orders/actions";
import {
  itemEditInput,
  type ItemEditInput,
  type JobOrderItemRowDto,
} from "../schemas/job-order";
import {
  isDoneStatus,
  PRODUCTION_STATUS_SUGGESTIONS,
} from "../services/production-status";
import { composeJobDescription } from "../services/job-description";
import {
  useInvalidateJobOrders,
  useJoDeadlineHistory,
} from "../hooks/use-job-orders";

/** Legacy updateJORow modal: edits ONE line item — the board's Edit action. */
export function ItemEditDialog({
  row,
  onClose,
  onEditJo,
  canEdit = true,
}: {
  row: JobOrderItemRowDto | null;
  onClose: () => void;
  /** Opens the whole-JO editor (add/remove items, notes) instead. */
  onEditJo?: (jobOrderId: string) => void;
  /** Whether the viewer may tick production steps (default true — the dialog
   *  is only opened for users who can already edit the item). */
  canEdit?: boolean;
}) {
  const invalidate = useInvalidateJobOrders();
  const queryClient = useQueryClient();
  const statusLookups = useLookupOptions("JO_STATUS");
  const employees = useEmployeeOptions();
  const deadlineMoves = useJoDeadlineHistory(row?.jobOrderId ?? null);

  // Per-JO Capture toggle (adds/removes the Capture step on every item of the
  // JO). Local state re-synced whenever a different row opens (render-time, no
  // effect). Optimistic: reverts on failure.
  const [needsCapture, setNeedsCapture] = useState(false);
  const [captureRowId, setCaptureRowId] = useState<string | null>(null);
  const [captureBusy, startCapture] = useTransition();
  if (row && row.id !== captureRowId) {
    setCaptureRowId(row.id);
    setNeedsCapture(row.joNeedsCapture);
  }
  const toggleCapture = (value: boolean) => {
    if (!row) return;
    setNeedsCapture(value);
    startCapture(async () => {
      const result = await setJoCaptureAction({
        jobOrderId: row.jobOrderId,
        needsCapture: value,
      });
      if (!result.ok) {
        setNeedsCapture(!value);
        toast.error(result.error);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["item-steps"] });
      invalidate();
    });
  };

  const form = useForm<ItemEditInput>({
    resolver: zodResolver(itemEditInput),
    defaultValues: emptyValues(),
  });

  // Re-seed the form whenever a different row is opened.
  useEffect(() => {
    if (row) form.reset(rowToValues(row));
  }, [row, form]);

  const watchedStatus = useWatch({ control: form.control, name: "productionStatus" });
  const { errors, isSubmitting } = form.formState;

  const statusOptions = statusLookups.data?.length
    ? statusLookups.data.map((o) => o.label)
    : [...PRODUCTION_STATUS_SUGGESTIONS];
  const employeeOptions = (employees.data ?? []).map((e) => ({
    value: e.code,
    label: `${e.code} — ${e.name}${e.team ? ` (${e.team})` : ""}`,
  }));

  const statusChanged =
    !!row && (watchedStatus ?? "") !== (row.productionStatus ?? "");
  const willArchive = statusChanged && isDoneStatus(watchedStatus);

  // Quote-derived items carry a fixed unit price: the amount is qty × unit
  // price (not hand-editable), and the job description recomposes off the live
  // quantity. Manually-encoded items keep the free amount/description fields.
  const watchedQty = useWatch({ control: form.control, name: "qty" });
  const unitPrice = row ? parseFloat(row.unitPrice) || 0 : 0;
  const liveQty = Math.max(parseInt(watchedQty ?? "", 10) || 0, 0);
  const liveAmount = Math.round(liveQty * unitPrice * 100) / 100;
  const liveJobDescription = row
    ? composeJobDescription({
        productName: row.service,
        specs: row.specs,
        qty: liveQty,
        unitPrice: row.unitPrice,
        lineTotal: String(liveAmount),
        fallback: row.description,
      })
    : "";
  const pesoFmt = (n: number) =>
    n.toLocaleString("en-PH", { minimumFractionDigits: 2 });

  const onSubmit = form.handleSubmit(async (values) => {
    // Quote-derived amount is always qty × unit price (the field is read-only).
    const payload = row?.fromQuote
      ? {
          ...values,
          amount: (
            Math.round(Math.max(parseInt(values.qty, 10) || 0, 0) * unitPrice * 100) / 100
          ).toFixed(2),
        }
      : values;
    const result = await updateItemAction(payload);
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
            {/* Read-only everywhere: the description is fixed at JO creation and
                never edited here. Shown in full — never truncated. */}
            <div
              id="ie-desc"
              className="min-h-16 rounded-lg border bg-muted/40 p-3 text-sm whitespace-pre-line wrap-break-word"
            >
              {(row?.fromQuote ? liveJobDescription : row?.description) || "—"}
            </div>
            <p className="text-xs text-muted-foreground">
              {row?.fromQuote
                ? "Composed from the approved quotation — updates with quantity. Use Notes for changes."
                : "Set when the job order was created — not editable here. Use Notes for changes."}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="ie-qty">Qty</Label>
              <Input
                id="ie-qty"
                aria-invalid={!!errors.qty}
                {...numericField(form.register("qty"), "integer")}
              />
              <FieldError message={errors.qty?.message} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ie-amount">JO Amount{row?.fromQuote ? "" : " *"}</Label>
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">
                  ₱
                </span>
                {row?.fromQuote ? (
                  <Input
                    key="amount-locked"
                    id="ie-amount"
                    className="pl-7 bg-muted/50 text-muted-foreground"
                    readOnly
                    value={pesoFmt(liveAmount)}
                  />
                ) : (
                  <Input
                    key="amount-editable"
                    id="ie-amount"
                    className="pl-7"
                    aria-invalid={!!errors.amount}
                    {...numericField(form.register("amount"), "decimal")}
                  />
                )}
              </div>
              {row?.fromQuote ? (
                <p className="text-xs text-muted-foreground">
                  Auto: {liveQty} × ₱{pesoFmt(unitPrice)}
                </p>
              ) : (
                <FieldError message={errors.amount?.message} />
              )}
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

          {/* Category + LFP live only on the create form, matching the legacy
              updateJORow modal (which had neither). */}
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

          {/* Rush is carried over from the quotation (which holds the rush
              fee) — not toggled here; it shows in the job description. */}

          {row && canEdit && (
            <div className="flex items-start gap-3 rounded-lg border p-3">
              <Switch
                id="ie-capture"
                checked={needsCapture}
                onCheckedChange={toggleCapture}
                disabled={captureBusy}
              />
              <div className="grid gap-0.5">
                <Label htmlFor="ie-capture" className="font-normal">
                  Needs capture service
                </Label>
                <p className="text-xs text-muted-foreground">
                  Adds a Capture step (before DR) to every item in this job
                  order. Turn off to remove it where not yet done.
                </p>
              </div>
            </div>
          )}

          {row && (
            <div className="rounded-lg border p-3">
              <ItemStepsChecklist jobOrderItemId={row.id} canEdit={canEdit} />
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

          {/* Item-level status history replaced by per-step status updates
              (in the Production steps checklist above). */}

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
