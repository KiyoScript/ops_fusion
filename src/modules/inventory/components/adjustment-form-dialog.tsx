"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusIcon, XIcon } from "lucide-react";
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
import { sanitizeDecimal, sanitizeInteger } from "@/lib/form-numeric";
import { requestAdjustmentAction } from "@/app/(app)/inventory/actions";
import { useInvalidateInventory } from "../hooks/use-inventory";
import { MaterialSearchAdd } from "./material-search-add";
import type { MaterialDto } from "../schemas/material";

type Line = {
  materialId: string;
  code: string;
  name: string;
  unit: string;
  onHand: number;
  dir: "add" | "remove";
  qty: string;
  unitCost: string;
};

export function AdjustmentFormDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const invalidate = useInvalidateInventory();
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [pending, startTransition] = useTransition();

  const reset = (next: boolean) => {
    onOpenChange(next);
    if (!next) { setReason(""); setNote(""); setLines([]); }
  };

  const addMaterial = (m: MaterialDto) =>
    setLines((ls) => [
      ...ls,
      { materialId: m.id, code: m.code, name: m.name, unit: m.unit, onHand: m.onHand, dir: "add", qty: "", unitCost: m.unitCost },
    ]);
  const patch = (id: string, p: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.materialId === id ? { ...l, ...p } : l)));
  const remove = (id: string) => setLines((ls) => ls.filter((l) => l.materialId !== id));

  const submit = () => {
    const payloadLines = lines
      .filter((l) => l.qty.trim() !== "" && Number(l.qty) > 0)
      .map((l) => ({
        materialId: l.materialId,
        qtyDelta: l.dir === "remove" ? -Number(l.qty) : Number(l.qty),
        unitCost: l.unitCost.trim() ? Number(l.unitCost) : undefined,
      }));
    if (!reason.trim()) { toast.error("Enter a reason for the adjustment."); return; }
    if (payloadLines.length === 0) { toast.error("Add at least one item with a quantity."); return; }
    startTransition(async () => {
      const result = await requestAdjustmentAction({ reason: reason.trim(), note: note.trim() || undefined, lines: payloadLines });
      if (!result.ok) { toast.error(result.error); return; }
      toast.success("Adjustment submitted for approval.");
      invalidate();
      router.refresh();
      reset(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New stock adjustment</DialogTitle>
          <DialogDescription>
            Submit a correction for approval. It posts to stock only once a supervisor approves it.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="adj-reason">Reason</Label>
            <Input id="adj-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Damaged stock, count correction, …" />
          </div>

          <MaterialSearchAdd onPick={addMaterial} excludeIds={lines.map((l) => l.materialId)} />

          {lines.length > 0 && (
            <div className="grid gap-2 rounded-lg border p-3">
              {lines.map((l) => (
                <div key={l.materialId} className="flex flex-wrap items-center gap-2 border-b pb-2 last:border-b-0 last:pb-0">
                  <div className="min-w-40 flex-1">
                    <div className="text-sm"><span className="font-mono font-medium">{l.code}</span> {l.name}</div>
                    <div className="text-xs text-muted-foreground">on hand {l.onHand.toLocaleString()} {l.unit}</div>
                  </div>
                  <div className="flex overflow-hidden rounded-md border">
                    <button type="button" onClick={() => patch(l.materialId, { dir: "add" })}
                      className={`px-2 py-1 text-xs ${l.dir === "add" ? "bg-emerald-600 text-white" : "text-muted-foreground"}`}>+ Add</button>
                    <button type="button" onClick={() => patch(l.materialId, { dir: "remove" })}
                      className={`px-2 py-1 text-xs ${l.dir === "remove" ? "bg-destructive text-white" : "text-muted-foreground"}`}>− Remove</button>
                  </div>
                  <Input inputMode="numeric" value={l.qty} onChange={(e) => patch(l.materialId, { qty: sanitizeInteger(e.target.value) })} className="h-8 w-20 text-right tabular-nums" placeholder="qty" aria-label={`Quantity for ${l.code}`} />
                  <Input inputMode="decimal" value={l.unitCost} onChange={(e) => patch(l.materialId, { unitCost: sanitizeDecimal(e.target.value) })} className="h-8 w-24 text-right tabular-nums" aria-label={`Unit cost for ${l.code}`} />
                  <Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => remove(l.materialId)}><XIcon className="size-4" /></Button>
                </div>
              ))}
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="adj-note">Note</Label>
            <Textarea id="adj-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>

        <DialogFooter showCloseButton>
          <Button onClick={submit} disabled={pending}>
            <PlusIcon /> {pending ? "Submitting…" : "Submit for approval"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
