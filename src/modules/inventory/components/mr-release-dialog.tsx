"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { sanitizeInteger } from "@/lib/form-numeric";
import { releaseMrAction } from "@/app/(app)/inventory/material-request-actions";
import { useInvalidateInventory } from "../hooks/use-inventory";
import type { MrDetailDto } from "../schemas/material-request";

export function MrReleaseDialog({
  mr,
  open,
  onOpenChange,
}: {
  mr: MrDetailDto;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const invalidate = useInvalidateInventory();
  // Releasable lines only (something still needed).
  const releasable = mr.lines.filter((l) => l.remaining > 0);
  const cap = (l: (typeof mr.lines)[number]) => Math.min(l.remaining, l.onHand);
  const [qtys, setQtys] = useState<Record<string, string>>(() =>
    Object.fromEntries(releasable.map((l) => [l.id, String(cap(l))]))
  );
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  const submit = () => {
    const lines = releasable.map((l) => ({ lineId: l.id, qty: Number(qtys[l.id] ?? "0") || 0 }));
    if (lines.every((l) => l.qty <= 0)) { toast.error("Enter a quantity to release on at least one line."); return; }
    if (!note.trim()) { toast.error("Release notes are required."); return; }
    startTransition(async () => {
      const result = await releaseMrAction({ id: mr.id, note: note.trim(), lines });
      if (!result.ok) { toast.error(result.error); return; }
      toast.success("Stock released.");
      invalidate();
      router.refresh();
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Release stock · {mr.number}</DialogTitle>
          <DialogDescription>
            Set the quantity to release per line. Each release posts an OUT movement to the stock ledger.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 rounded-lg border p-3">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span className="flex-1">Item</span>
            <span className="w-16 text-right">On hand</span>
            <span className="w-16 text-right">Needed</span>
            <span className="w-20 text-right">Release</span>
          </div>
          {releasable.map((l) => {
            const overStock = l.onHand < l.remaining;
            return (
              <div key={l.id} className="flex items-center gap-2 border-b pb-2 last:border-b-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="text-sm"><span className="font-mono font-medium">{l.code}</span> {l.name}</div>
                  {overStock && <div className="text-xs text-amber-600">only {l.onHand} on hand</div>}
                </div>
                <span className="w-16 text-right text-sm tabular-nums text-muted-foreground">{l.onHand.toLocaleString()}</span>
                <span className="w-16 text-right text-sm tabular-nums">{l.remaining.toLocaleString()}</span>
                <Input
                  inputMode="numeric"
                  value={qtys[l.id] ?? ""}
                  onChange={(e) => {
                    const clean = sanitizeInteger(e.target.value);
                    const capped = clean === "" ? "" : String(Math.min(parseInt(clean, 10), cap(l)));
                    setQtys((q) => ({ ...q, [l.id]: capped }));
                  }}
                  className="h-8 w-20 text-right tabular-nums"
                  aria-label={`Release quantity for ${l.code}`}
                />
              </div>
            );
          })}
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="mr-release-note">Release notes <span className="text-destructive">*</span></Label>
          <Textarea id="mr-release-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Who received / where it went…" />
        </div>

        <DialogFooter showCloseButton>
          <Button onClick={submit} disabled={pending}>{pending ? "Releasing…" : "Release stock"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
