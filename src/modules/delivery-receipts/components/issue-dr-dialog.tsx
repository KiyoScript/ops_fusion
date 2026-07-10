"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusIcon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/data-states";
import { Skeleton } from "@/components/ui/skeleton";
import { sanitizeInteger } from "@/lib/form-numeric";
import { useDebounce } from "@/modules/shared/hooks/use-debounce";
import { issueDrAction } from "@/app/(app)/delivery-receipts/actions";
import { useDeliverable, useInvalidateDrs } from "../hooks/use-delivery-receipts";

const peso = (v: string) => {
  const n = parseFloat(v);
  return isNaN(n) ? v : `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
};

export function IssueDrDialog() {
  const router = useRouter();
  const invalidate = useInvalidateDrs();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [jobOrderId, setJobOrderId] = useState<string | null>(null);
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();
  const debounced = useDebounce(search);

  // Search list of deliverable JOs (recent when blank); refetched on typing.
  const list = useDeliverable(open && !jobOrderId ? { q: debounced } : null);
  // Full item set for the chosen JO.
  const picked = useDeliverable(jobOrderId ? { jobOrderId } : null);
  const selected = picked.data?.[0] ?? null;

  const reset = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setSearch("");
      setJobOrderId(null);
      setQtys({});
      setNotes("");
    }
  };

  const pickJo = (id: string, items: { id: string; remaining: number }[]) => {
    setJobOrderId(id);
    // Prefill each line with its full remaining quantity (deliver-all default).
    setQtys(Object.fromEntries(items.map((i) => [i.id, String(i.remaining)])));
  };

  const submit = () => {
    if (!selected) return;
    const lines = selected.items
      .map((i) => ({ jobOrderItemId: i.id, qty: qtys[i.id] ?? "0" }))
      .filter((l) => parseInt(l.qty, 10) > 0);
    if (lines.length === 0) {
      toast.error("Enter a quantity to deliver on at least one line.");
      return;
    }
    startTransition(async () => {
      const result = await issueDrAction({
        jobOrderId: selected.jobOrderId,
        notes: notes.trim() || undefined,
        lines,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Delivery receipt issued.");
      invalidate();
      router.refresh();
      reset(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger render={<Button />}>
        <PlusIcon /> Issue DR
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Issue Delivery Receipt</DialogTitle>
          <DialogDescription>
            Find a completed job order, then set the quantity to deliver per
            line (partial allowed).
          </DialogDescription>
        </DialogHeader>

        {!selected ? (
          /* ── Step 1: search + pick a JO ── */
          <div className="grid gap-3">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search JO # or customer…"
                className="pl-8"
              />
            </div>
            <div className="grid max-h-80 gap-1 overflow-y-auto">
              {list.isPending ? (
                Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)
              ) : (list.data ?? []).length === 0 ? (
                <EmptyState
                  title="Nothing to deliver"
                  description="A JO's items appear here once they're marked done with undelivered quantity."
                />
              ) : (
                (list.data ?? []).map((g) => (
                  <button
                    key={g.jobOrderId}
                    type="button"
                    onClick={() => pickJo(g.jobOrderId, g.items)}
                    className="grid w-full gap-0.5 rounded-lg border px-3 py-2 text-left hover:bg-muted/50"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium">{g.joNumber}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {g.items.length} item{g.items.length !== 1 ? "s" : ""} to deliver
                      </span>
                    </div>
                    <span className="text-xs font-medium wrap-break-word">
                      {g.customerName}
                    </span>
                    {/* item descriptions so same-customer JOs are distinguishable */}
                    <ul className="mt-0.5 grid gap-0.5 text-xs text-muted-foreground">
                      {g.items.map((it) => (
                        <li key={it.id} className="wrap-break-word">
                          • {it.description.replace(/\s*\n\s*/g, " / ")}{" "}
                          <span className="whitespace-nowrap">
                            ({it.remaining} pc{it.remaining !== 1 ? "s" : ""})
                          </span>
                        </li>
                      ))}
                    </ul>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          /* ── Step 2: set quantities ── */
          <div className="grid gap-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-medium">{selected.joNumber}</div>
                <div className="text-xs text-muted-foreground">{selected.customerName}</div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setJobOrderId(null);
                  setQtys({});
                }}
              >
                ← Change JO
              </Button>
            </div>

            <div className="grid gap-2 rounded-lg border p-3">
              {selected.items.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center gap-3 border-b pb-2 last:border-b-0 last:pb-0"
                >
                  <div className="min-w-40 flex-1">
                    <div className="text-sm wrap-break-word whitespace-pre-line">
                      {item.description}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {item.lineItemId} · ordered {item.qty} · delivered {item.qtyDelivered} ·{" "}
                      {peso(item.unitPrice)}/pc
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor={`dr-qty-${item.id}`} className="text-xs">Deliver</Label>
                    <Input
                      id={`dr-qty-${item.id}`}
                      inputMode="numeric"
                      value={qtys[item.id] ?? ""}
                      onChange={(e) => {
                        const clean = sanitizeInteger(e.target.value);
                        const capped =
                          clean === ""
                            ? ""
                            : String(Math.min(parseInt(clean, 10), item.remaining));
                        setQtys((q) => ({ ...q, [item.id]: capped }));
                      }}
                      className="h-8 w-20"
                    />
                    <span className="text-xs text-muted-foreground">/ {item.remaining} left</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="dr-notes">Notes</Label>
              <Textarea id="dr-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        )}

        <DialogFooter showCloseButton>
          <Button onClick={submit} disabled={pending || !selected}>
            {pending ? "Issuing…" : "Issue DR"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
