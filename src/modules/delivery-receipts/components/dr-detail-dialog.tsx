"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { toast } from "sonner";
import { CheckIcon, FileTextIcon, PencilIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ErrorState } from "@/components/data-states";
import { Skeleton } from "@/components/ui/skeleton";
import {
  cancelDrAction,
  editDrAction,
} from "@/app/(app)/delivery-receipts/actions";
import {
  useDrDetail,
  useDrEditOptions,
  useInvalidateDrs,
  useJoPayment,
} from "../hooks/use-delivery-receipts";

const peso = (v: string) => {
  const n = parseFloat(v);
  return isNaN(n) ? v : `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
};

export function DrDetailDialog({
  drId,
  canCancel,
  canEdit,
  onClose,
}: {
  drId: string | null;
  canCancel: boolean;
  canEdit: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const invalidate = useInvalidateDrs();
  const detail = useDrDetail(drId);
  const dr = detail.data;
  // The DR is connected to the JO's sales balance — show what's paid / owed.
  const payment = useJoPayment(dr?.jobOrder.id ?? null);
  const [pending, startTransition] = useTransition();

  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");

  // Leave edit mode whenever a different DR is opened (reset-on-prop-change
  // during render — the pattern React recommends over an effect).
  const [shownDrId, setShownDrId] = useState(drId);
  if (drId !== shownDrId) {
    setShownDrId(drId);
    setEditing(false);
  }

  const options = useDrEditOptions(editing && dr ? dr.id : null);

  // Seed the checkbox selection from the DR's current items, once per edit.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (editing && options.data && seededFor !== drId) {
    setSeededFor(drId);
    setSelected(
      new Set(
        options.data.items.filter((i) => i.inThisDr).map((i) => i.jobOrderItemId)
      )
    );
  }

  const isCancelled = dr?.status === "CANCELLED";
  const editable = canEdit && !!dr && !isCancelled;

  const items = options.data?.items ?? [];
  const undoneCount = items.filter((i) => !i.deliverable).length;
  // Full ⟺ every one of the JO's line items is selected on this DR.
  const previewFull =
    items.length > 0 && items.every((i) => selected.has(i.jobOrderItemId));

  const startEdit = () => {
    if (!dr) return;
    setNotes(dr.notes ?? "");
    setSeededFor(null); // force a re-seed from freshly fetched options
    setEditing(true);
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const cancel = () => {
    if (!dr) return;
    startTransition(async () => {
      const result = await cancelDrAction({ id: dr.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${dr.drNumber} cancelled — quantities returned.`);
      invalidate();
      router.refresh();
      onClose();
    });
  };

  const save = () => {
    if (!dr) return;
    if (selected.size === 0) {
      toast.error("Select at least one item — or cancel the DR instead.");
      return;
    }
    startTransition(async () => {
      const result = await editDrAction({
        id: dr.id,
        jobOrderItemIds: [...selected],
        notes: notes.trim() || undefined,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${dr.drNumber} updated — marked ${previewFull ? "Full" : "Partial"}.`);
      setEditing(false);
      invalidate();
      router.refresh();
    });
  };

  return (
    <Dialog open={drId !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8">
            {dr ? dr.drNumber : "Delivery Receipt"}
            {isCancelled && <Badge variant="destructive">Cancelled</Badge>}
            {dr && (
              <Badge variant="outline">
                {(editing ? previewFull : dr.isFullDelivery)
                  ? "Full delivery"
                  : "Partial delivery"}
              </Badge>
            )}
            {dr && !editing && (
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                className="ml-auto"
                render={
                  <a
                    href={`/api/delivery-receipts/${dr.id}/pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                }
              >
                <FileTextIcon /> PDF
              </Button>
            )}
          </DialogTitle>
          <DialogDescription>
            {dr ? `${dr.jobOrder.joNumber} · ${dr.customer.name}` : "Loading…"}
          </DialogDescription>
        </DialogHeader>

        {detail.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : detail.isError ? (
          <ErrorState message={detail.error.message} onRetry={() => detail.refetch()} />
        ) : dr ? (
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              <Field label="Issued" value={format(new Date(dr.issuedAt), "MMM d, yyyy h:mm a")} />
              <Field label="Prepared by" value={dr.createdByName} />
              <Field label="Total" value={peso(dr.amount)} />
              {!editing && dr.notes && (
                <div className="sm:col-span-3">
                  <Field label="Notes" value={dr.notes} />
                </div>
              )}
            </div>

            {/* Payment position of the DR's job order — the DR is connected to
                the sales / collection balance, not just the JO. */}
            {payment.data && (
              <div className="grid gap-2 rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    Payment · {dr.jobOrder.joNumber}
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      payment.data.status === "PAID" &&
                        "border-green-500/40 text-green-700 dark:text-green-300",
                      payment.data.status === "PARTIAL" &&
                        "border-amber-500/40 text-amber-700 dark:text-amber-300"
                    )}
                  >
                    {payment.data.status === "PAID"
                      ? "Fully paid"
                      : payment.data.status === "PARTIAL"
                        ? "Partial"
                        : "Unpaid"}
                  </Badge>
                </div>
                <div className="grid grid-cols-3 gap-x-6 text-sm">
                  <Field label="Invoiced" value={peso(payment.data.total)} />
                  <Field label="Paid" value={peso(payment.data.paid)} />
                  <Field label="Balance" value={peso(payment.data.balance)} />
                </div>
              </div>
            )}

            {editing ? (
              /* ── Edit mode: pick which JO line items this DR delivers ── */
              <div className="grid gap-4 rounded-lg border bg-muted/30 p-4">
                <div className="grid gap-1">
                  <Label>Items delivered on this DR</Label>
                  <p className="text-xs text-muted-foreground">
                    Tick every line item that goes on this receipt. All items ={" "}
                    <span className="font-medium">Full delivery</span>; some items
                    = <span className="font-medium">Partial</span> (balance to
                    follow).
                  </p>
                </div>

                {options.isPending ? (
                  <div className="grid gap-2">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ) : options.isError ? (
                  <ErrorState
                    message={options.error.message}
                    onRetry={() => options.refetch()}
                  />
                ) : (
                  <div className="grid gap-2">
                    {items.map((it) => (
                      <ItemCheckRow
                        key={it.jobOrderItemId}
                        checked={selected.has(it.jobOrderItemId)}
                        disabled={!it.deliverable}
                        onToggle={() => toggle(it.jobOrderItemId)}
                        lineItemId={it.lineItemId}
                        description={it.description}
                        meta={
                          it.deliverable
                            ? ` · qty ${it.qty}`
                            : " · in production — not yet deliverable"
                        }
                      />
                    ))}
                    {undoneCount > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {undoneCount} item{undoneCount !== 1 ? "s" : ""} still in
                        production — a Full delivery needs every item done.
                      </p>
                    )}
                  </div>
                )}

                <div className="grid gap-2">
                  <Label htmlFor="dr-edit-notes">Notes</Label>
                  <Textarea
                    id="dr-edit-notes"
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              </div>
            ) : (
              /* ── Read-only: the delivered lines ── */
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dr.lines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell>
                        <div className="text-sm wrap-break-word whitespace-pre-line">
                          {l.description}
                        </div>
                        <div className="text-xs text-muted-foreground">{l.lineItemId}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{l.qty}</TableCell>
                      <TableCell className="text-right tabular-nums">{peso(l.unitPrice)}</TableCell>
                      <TableCell className="text-right tabular-nums">{peso(l.lineTotal)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {/* TODO(SALES): advance-payment applied + remaining balance here */}

            {editing ? (
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setEditing(false)}
                  disabled={pending}
                >
                  Discard
                </Button>
                <Button onClick={save} disabled={pending || options.isPending}>
                  {pending ? "Saving…" : "Save changes"}
                </Button>
              </div>
            ) : (
              (editable || (canCancel && !isCancelled)) && (
                <div className="flex flex-wrap justify-end gap-2">
                  {editable && (
                    <Button variant="outline" onClick={startEdit} disabled={pending}>
                      <PencilIcon /> Edit
                    </Button>
                  )}
                  {canCancel && !isCancelled && (
                    <Button variant="destructive" onClick={cancel} disabled={pending}>
                      {pending ? "Cancelling…" : "Cancel DR (return quantities)"}
                    </Button>
                  )}
                </div>
              )
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ItemCheckRow({
  checked,
  disabled,
  onToggle,
  lineItemId,
  description,
  meta,
}: {
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
  lineItemId: string;
  description: string;
  meta: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      aria-pressed={checked}
      className={cn(
        "flex w-full items-start gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
        disabled
          ? "cursor-not-allowed opacity-60"
          : checked
            ? "border-primary bg-primary/10"
            : "hover:bg-muted/50"
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border",
          checked ? "border-primary bg-primary text-primary-foreground" : "bg-background"
        )}
      >
        {checked && <CheckIcon className="size-3.5" />}
      </span>
      <span className="grid gap-0.5">
        <span className="text-sm wrap-break-word whitespace-pre-line">
          {description}
        </span>
        <span className="text-xs text-muted-foreground">
          {lineItemId}
          {meta}
        </span>
      </span>
    </button>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="whitespace-pre-wrap">{value}</span>
    </div>
  );
}
