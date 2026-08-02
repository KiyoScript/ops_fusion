"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusIcon, SearchIcon, XIcon, TriangleAlertIcon } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { sanitizeInteger } from "@/lib/form-numeric";
import { useDebounce } from "@/modules/shared/hooks/use-debounce";
import { submitMrAction, editMrAction } from "@/app/(app)/inventory/material-request-actions";
import {
  useDuplicateJoHint,
  useInvalidateInventory,
  useJobOrderSearch,
} from "../hooks/use-inventory";
import { MaterialSearchAdd } from "./material-search-add";
import type { MaterialDto } from "../schemas/material";
import type { MrDetailDto } from "../schemas/material-request";

type Line = { materialId: string; code: string; name: string; unit: string; qty: string };

export function MrFormDialog({
  open,
  onOpenChange,
  mr,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mr?: MrDetailDto | null;
}) {
  const router = useRouter();
  const invalidate = useInvalidateInventory();
  const isEdit = !!mr;

  const [jobOrderId, setJobOrderId] = useState<string | null>(null);
  const [joLabel, setJoLabel] = useState("");
  const [joSearch, setJoSearch] = useState("");
  const [purpose, setPurpose] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [pending, startTransition] = useTransition();

  // Seed from the MR when editing a rejected request (render-time sync).
  const formKey = open ? (mr?.id ?? "new") : "closed";
  const [syncedKey, setSyncedKey] = useState(formKey);
  if (formKey !== syncedKey) {
    setSyncedKey(formKey);
    if (open) {
      setJobOrderId(mr?.jobOrder?.id ?? null);
      setJoLabel(mr?.jobOrder?.joNumber ?? "");
      setJoSearch("");
      setPurpose(mr?.purpose ?? "");
      setLines(
        (mr?.lines ?? []).map((l) => ({
          materialId: l.materialId, code: l.code, name: l.name, unit: l.unit, qty: String(l.qtyNeeded),
        }))
      );
    }
  }

  const debouncedJo = useDebounce(joSearch);
  const joQuery = useJobOrderSearch(debouncedJo, open && jobOrderId === null);
  const dupHint = useDuplicateJoHint(open && jobOrderId ? jobOrderId : null);

  const reset = (next: boolean) => {
    onOpenChange(next);
    if (!next) { setJobOrderId(null); setJoLabel(""); setJoSearch(""); setPurpose(""); setLines([]); }
  };

  const addMaterial = (m: MaterialDto) =>
    setLines((ls) => [...ls, { materialId: m.id, code: m.code, name: m.name, unit: m.unit, qty: "" }]);
  const patchQty = (id: string, qty: string) =>
    setLines((ls) => ls.map((l) => (l.materialId === id ? { ...l, qty } : l)));
  const remove = (id: string) => setLines((ls) => ls.filter((l) => l.materialId !== id));

  const submit = () => {
    const payloadLines = lines
      .filter((l) => l.qty.trim() !== "" && Number(l.qty) > 0)
      .map((l) => ({ materialId: l.materialId, qtyNeeded: Number(l.qty) }));
    if (payloadLines.length === 0) { toast.error("Add at least one item with a quantity."); return; }
    startTransition(async () => {
      const result = isEdit
        ? await editMrAction({ id: mr!.id, jobOrderId, purpose: purpose.trim() || undefined, lines: payloadLines })
        : await submitMrAction({ jobOrderId, purpose: purpose.trim() || undefined, lines: payloadLines });
      if (!result.ok) { toast.error(result.error); return; }
      toast.success(isEdit ? "Request updated and resubmitted." : "Material request submitted.");
      invalidate();
      router.refresh();
      reset(false);
    });
  };

  const dupes = dupHint.data?.existing.filter((e) => e.number !== mr?.number) ?? [];

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit request ${mr!.number}` : "New material request"}</DialogTitle>
          <DialogDescription>
            Request materials against a job order. It goes to a supervisor for approval before any stock is released.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {/* JO picker */}
          <div className="grid gap-1.5">
            <Label>Job order <span className="font-normal text-muted-foreground">(optional)</span></Label>
            {jobOrderId ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                <span className="text-sm font-medium">{joLabel || jobOrderId}</span>
                <Button variant="ghost" size="sm" onClick={() => { setJobOrderId(null); setJoLabel(""); }}>Change</Button>
              </div>
            ) : (
              <div className="grid gap-1.5">
                <div className="relative">
                  <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={joSearch} onChange={(e) => setJoSearch(e.target.value)} placeholder="Search JO # or customer… (or leave blank for shop use)" className="pl-8" />
                </div>
                {joSearch.trim() !== "" && (
                  <div className="grid max-h-40 gap-1 overflow-y-auto rounded-lg border p-1">
                    {joQuery.isPending ? (
                      Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)
                    ) : (joQuery.data ?? []).length === 0 ? (
                      <p className="px-2 py-3 text-center text-sm text-muted-foreground">No matching job orders.</p>
                    ) : (
                      (joQuery.data ?? []).map((j) => (
                        <button key={j.id} type="button"
                          onClick={() => { setJobOrderId(j.id); setJoLabel(j.joNumber); setJoSearch(""); }}
                          className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left hover:bg-muted">
                          <span className="text-sm font-medium">{j.joNumber}</span>
                          <span className="truncate text-xs text-muted-foreground">{j.customerName}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
            {dupes.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
                <span>This JO already has {dupes.length} request(s): {dupes.map((e) => e.number).join(", ")}. You can still proceed.</span>
              </div>
            )}
          </div>

          {!jobOrderId && (
            <div className="grid gap-1.5">
              <Label htmlFor="mr-purpose">Purpose <span className="font-normal text-muted-foreground">(for non-JO / shop use)</span></Label>
              <Input id="mr-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. office supplies, machine maintenance" />
            </div>
          )}

          <MaterialSearchAdd onPick={addMaterial} excludeIds={lines.map((l) => l.materialId)} />

          {lines.length > 0 && (
            <div className="grid gap-2 rounded-lg border p-3">
              {lines.map((l) => (
                <div key={l.materialId} className="flex flex-wrap items-center gap-2 border-b pb-2 last:border-b-0 last:pb-0">
                  <div className="min-w-40 flex-1">
                    <div className="text-sm"><span className="font-mono font-medium">{l.code}</span> {l.name}</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor={`mr-qty-${l.materialId}`} className="text-xs">Need</Label>
                    <Input id={`mr-qty-${l.materialId}`} inputMode="numeric" value={l.qty}
                      onChange={(e) => patchQty(l.materialId, sanitizeInteger(e.target.value))}
                      className="h-8 w-20 text-right tabular-nums" />
                    <span className="text-xs text-muted-foreground">{l.unit}</span>
                  </div>
                  <Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => remove(l.materialId)}><XIcon className="size-4" /></Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter showCloseButton>
          <Button onClick={submit} disabled={pending}>
            <PlusIcon /> {pending ? "Saving…" : isEdit ? "Resubmit request" : "Submit request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
