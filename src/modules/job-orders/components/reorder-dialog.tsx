"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { CheckIcon, RotateCcwIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CustomerCombobox } from "./customer-combobox";
import { useCreateReorder, useReorderItems } from "../hooks/use-job-orders";
import type { ReorderItemDto } from "../schemas/job-order";

type RowState = { include: boolean; qty: string; price: string };

const plusDays = (days: number) =>
  format(new Date(Date.now() + days * 86_400_000), "yyyy-MM-dd");

// A row's editable state before the user touches it — carried from its last
// order. Kept as a pure derivation (no effect) so state seeds during render.
const defaultRow = (item: ReorderItemDto): RowState => ({
  include: false,
  qty: String(item.lastQty),
  price: item.unitPrice,
});

/** "Reorder" — build a new JO from a customer's past items instead of
 *  re-searching the whole catalog. Pick the customer, tick the items they've
 *  ordered before (qty + price editable), set a needed-by date, and create.
 *  The JO lands in "For review": it needs the customer's sign-off AND an admin
 *  review before it enters production. */
export function ReorderDialog() {
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [deadline, setDeadline] = useState(plusDays(7));
  const [sel, setSel] = useState<Record<string, RowState>>({});

  const items = useReorderItems(open ? customerId : null);
  const create = useCreateReorder();

  const reset = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setCustomerId(null);
      setCustomerName("");
      setDeadline(plusDays(7));
      setSel({});
    }
  };

  const chosenCount = useMemo(
    () => Object.values(sel).filter((r) => r.include).length,
    [sel]
  );

  const setRow = (key: string, next: RowState) =>
    setSel((s) => ({ ...s, [key]: next }));

  const submit = () => {
    if (!customerId) return void toast.error("Pick a customer first.");
    const rows = (items.data ?? []).filter((it) => sel[it.key]?.include);
    if (rows.length === 0) return void toast.error("Tick at least one item.");
    const payloadItems = rows.map((it) => {
      const r = sel[it.key]!;
      return {
        description: it.description,
        qty: r.qty,
        unitPrice: r.price,
        productId: it.productId,
        category: it.category,
        isLFP: it.isLFP,
        lfpWidth: it.lfpWidth,
        lfpHeight: it.lfpHeight,
        lfpUnit: it.lfpUnit,
        specs: it.specs ?? undefined,
      };
    });
    create.mutate(
      { customerId, deadline, items: payloadItems },
      {
        onSuccess: () => {
          toast.success("Reorder JO created — sent for customer + admin approval.");
          reset(false);
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "Could not create the reorder."),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger render={<Button variant="outline" />}>
        <RotateCcwIcon /> Reorder
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Reorder — new JO from history</DialogTitle>
          <DialogDescription>
            Pick a customer, then tick what they&apos;ve ordered before. The new
            JO goes out <strong>for customer + admin approval</strong> before
            production.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5 sm:max-w-sm">
            <Label htmlFor="reorder-customer">Customer</Label>
            <CustomerCombobox
              id="reorder-customer"
              value={customerName}
              onChange={(v) => {
                setCustomerName(v);
                // Free-typed text isn't a known customer — clear the id so the
                // picker only proceeds for an existing customer with history.
                setCustomerId(null);
              }}
              onPick={(c) => {
                setCustomerName(c.name);
                setCustomerId(c.id);
                setSel({});
              }}
            />
            {customerName.trim().length >= 2 && !customerId && (
              <p className="text-xs text-muted-foreground">
                Pick an existing customer from the list to load their past orders.
              </p>
            )}
          </div>

          {customerId && (
            <ReorderItemList
              query={items}
              sel={sel}
              onRow={setRow}
            />
          )}

          {customerId && (items.data?.length ?? 0) > 0 && (
            <div className="grid gap-1.5 sm:max-w-xs">
              <Label htmlFor="reorder-deadline">Needed by</Label>
              <Input
                id="reorder-deadline"
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => reset(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!customerId || chosenCount === 0 || create.isPending}
          >
            {create.isPending
              ? "Creating…"
              : `Create reorder JO${chosenCount ? ` (${chosenCount})` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReorderItemList({
  query,
  sel,
  onRow,
}: {
  query: ReturnType<typeof useReorderItems>;
  sel: Record<string, RowState>;
  onRow: (key: string, next: RowState) => void;
}) {
  if (query.isPending) {
    return <p className="text-sm text-muted-foreground">Loading past orders…</p>;
  }
  if (query.isError) {
    return <p className="text-sm text-destructive">Could not load past orders.</p>;
  }
  const data = query.data ?? [];
  if (data.length === 0) {
    return (
      <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
        No previous orders for this customer yet — nothing to reorder.
      </p>
    );
  }
  return (
    <div className="max-h-[46vh] overflow-y-auto rounded-lg border">
      <ul className="divide-y">
        {data.map((it) => (
          <ReorderRow
            key={it.key}
            item={it}
            state={sel[it.key] ?? defaultRow(it)}
            onRow={onRow}
          />
        ))}
      </ul>
    </div>
  );
}

function ReorderRow({
  item,
  state,
  onRow,
}: {
  item: ReorderItemDto;
  state: RowState;
  onRow: (key: string, next: RowState) => void;
}) {
  const on = state.include;
  const lastOrdered = format(new Date(item.lastOrderedAt), "MMM d, yyyy");
  return (
    <li className={cn("grid gap-2 p-3 sm:grid-cols-[1fr_auto] sm:items-start", on && "bg-primary/5")}>
      <button
        type="button"
        role="checkbox"
        aria-checked={on}
        onClick={() => onRow(item.key, { ...state, include: !on })}
        className="flex items-start gap-2 text-left"
      >
        <span
          className={cn(
            "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border",
            on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
          )}
        >
          {on && <CheckIcon className="size-3" />}
        </span>
        <span className="grid gap-0.5">
          <span className="text-sm font-medium">{item.jobDescription}</span>
          <span className="text-xs text-muted-foreground">
            Last: {item.lastQty}× @ ₱{item.unitPrice} · {lastOrdered} · {item.lastJoNumber}
            {item.timesOrdered > 1 ? ` · ordered ${item.timesOrdered}×` : ""}
          </span>
        </span>
      </button>
      <div className="flex items-end gap-2 sm:justify-self-end">
        <label className="grid gap-1 text-xs text-muted-foreground">
          Qty
          <Input
            inputMode="numeric"
            value={state.qty}
            onChange={(e) => onRow(item.key, { ...state, qty: e.target.value })}
            disabled={!on}
            className="h-8 w-20 tabular-nums"
            aria-label={`Quantity for ${item.description}`}
          />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Unit price
          <Input
            inputMode="decimal"
            value={state.price}
            onChange={(e) => onRow(item.key, { ...state, price: e.target.value })}
            disabled={!on}
            className="h-8 w-24 tabular-nums"
            aria-label={`Unit price for ${item.description}`}
          />
        </label>
      </div>
    </li>
  );
}
