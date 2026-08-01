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
import { sanitizeInteger } from "@/lib/form-numeric";
import { createCycleCountAction } from "@/app/(app)/inventory/actions";
import { useInvalidateInventory } from "../hooks/use-inventory";
import { MaterialSearchAdd } from "./material-search-add";
import type { MaterialDto } from "../schemas/material";

type Line = {
  materialId: string;
  code: string;
  name: string;
  unit: string;
  systemQty: number;
  countedQty: string;
};

export function CycleCountFormDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const invalidate = useInvalidateInventory();
  const [location, setLocation] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [pending, startTransition] = useTransition();

  const reset = (next: boolean) => {
    onOpenChange(next);
    if (!next) { setLocation(""); setNote(""); setLines([]); }
  };

  const addMaterial = (m: MaterialDto) =>
    setLines((ls) => [...ls, { materialId: m.id, code: m.code, name: m.name, unit: m.unit, systemQty: m.onHand, countedQty: "" }]);
  const patch = (id: string, countedQty: string) =>
    setLines((ls) => ls.map((l) => (l.materialId === id ? { ...l, countedQty } : l)));
  const remove = (id: string) => setLines((ls) => ls.filter((l) => l.materialId !== id));

  const submit = () => {
    const payloadLines = lines
      .filter((l) => l.countedQty.trim() !== "")
      .map((l) => ({ materialId: l.materialId, countedQty: Number(l.countedQty) }));
    if (payloadLines.length === 0) { toast.error("Add at least one item with a counted quantity."); return; }
    startTransition(async () => {
      const result = await createCycleCountAction({ location: location.trim() || undefined, note: note.trim() || undefined, lines: payloadLines });
      if (!result.ok) { toast.error(result.error); return; }
      toast.success("Cycle count created.");
      invalidate();
      router.refresh();
      reset(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New cycle count</DialogTitle>
          <DialogDescription>
            Enter the physical count per item. System stock is snapshotted now; approval sets stock to your count.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="cc-location">Location / scope (optional)</Label>
            <Input id="cc-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Storeroom, Shelf A, …" />
          </div>

          <MaterialSearchAdd onPick={addMaterial} excludeIds={lines.map((l) => l.materialId)} />

          {lines.length > 0 && (
            <div className="grid gap-2 rounded-lg border p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <span className="flex-1">Item</span>
                <span className="w-16 text-right">System</span>
                <span className="w-20 text-right">Counted</span>
                <span className="w-16 text-right">Variance</span>
                <span className="w-8" />
              </div>
              {lines.map((l) => {
                const variance = l.countedQty.trim() === "" ? null : Number(l.countedQty) - l.systemQty;
                return (
                  <div key={l.materialId} className="flex items-center gap-2 border-b pb-2 last:border-b-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm"><span className="font-mono font-medium">{l.code}</span> {l.name}</div>
                    </div>
                    <span className="w-16 text-right text-sm tabular-nums text-muted-foreground">{l.systemQty.toLocaleString()}</span>
                    <Input inputMode="numeric" value={l.countedQty} onChange={(e) => patch(l.materialId, sanitizeInteger(e.target.value))} className="h-8 w-20 text-right tabular-nums" aria-label={`Counted quantity for ${l.code}`} />
                    <span className={`w-16 text-right text-sm font-medium tabular-nums ${variance === null ? "text-muted-foreground" : variance < 0 ? "text-destructive" : variance > 0 ? "text-emerald-600" : ""}`}>
                      {variance === null ? "—" : variance > 0 ? `+${variance}` : variance}
                    </span>
                    <Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => remove(l.materialId)}><XIcon className="size-4" /></Button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="cc-note">Note</Label>
            <Textarea id="cc-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>

        <DialogFooter showCloseButton>
          <Button onClick={submit} disabled={pending}><PlusIcon /> {pending ? "Saving…" : "Create count"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
