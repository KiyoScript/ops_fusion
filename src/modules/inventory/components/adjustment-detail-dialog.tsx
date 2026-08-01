"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ErrorState } from "@/components/data-states";
import { Skeleton } from "@/components/ui/skeleton";
import {
  approveAdjustmentAction,
  rejectAdjustmentAction,
} from "@/app/(app)/inventory/actions";
import { useAdjustmentDetail, useInvalidateInventory } from "../hooks/use-inventory";

const peso = (v: string) => {
  const n = parseFloat(v);
  return isNaN(n) ? v : `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
};

function StatusBadge({ status }: { status: string }) {
  if (status === "APPROVED") return <Badge variant="secondary">Approved</Badge>;
  if (status === "REJECTED") return <Badge variant="destructive">Rejected</Badge>;
  return <Badge variant="outline">Pending</Badge>;
}

export function AdjustmentDetailDialog({
  id,
  canApprove,
  onClose,
}: {
  id: string | null;
  canApprove: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const invalidate = useInvalidateInventory();
  const query = useAdjustmentDetail(id);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const adj = query.data;

  const decide = (action: "approve" | "reject") => {
    if (!adj) return;
    startTransition(async () => {
      const fn = action === "approve" ? approveAdjustmentAction : rejectAdjustmentAction;
      const result = await fn({ id: adj.id, note: note.trim() || undefined });
      if (!result.ok) { toast.error(result.error); return; }
      toast.success(action === "approve" ? "Adjustment approved — stock updated." : "Adjustment rejected.");
      setNote("");
      invalidate();
      router.refresh();
      onClose();
    });
  };

  return (
    <Dialog open={id !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        {query.isPending ? (
          <div className="grid gap-3 py-4"><Skeleton className="h-6 w-48" /><Skeleton className="h-24 w-full" /></div>
        ) : query.isError ? (
          <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
        ) : adj ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{adj.number}</span>
                <StatusBadge status={adj.status} />
              </DialogTitle>
              <DialogDescription className="wrap-break-word">{adj.reason}</DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-muted-foreground">Requested by</span> {adj.requestedByName}</div>
              <div><span className="text-muted-foreground">On</span> {format(new Date(adj.requestedAt), "M/d/yyyy h:mma")}</div>
              {adj.decidedByName && (
                <>
                  <div><span className="text-muted-foreground">Decided by</span> {adj.decidedByName}</div>
                  <div><span className="text-muted-foreground">On</span> {adj.decidedAt && format(new Date(adj.decidedAt), "M/d/yyyy h:mma")}</div>
                </>
              )}
            </div>
            {adj.note && <p className="rounded-lg bg-muted/50 p-3 text-sm whitespace-pre-line">{adj.note}</p>}
            {adj.decisionNote && <p className="text-sm text-muted-foreground">Decision note: {adj.decisionNote}</p>}

            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Change</TableHead>
                    <TableHead className="text-right">Unit cost</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {adj.lines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell>
                        <span className="font-mono text-sm font-medium">{l.code}</span>
                        <span className="ml-2 text-sm wrap-break-word">{l.name}</span>
                      </TableCell>
                      <TableCell className={`text-right font-medium tabular-nums ${l.qtyDelta < 0 ? "text-destructive" : "text-emerald-600"}`}>
                        {l.qtyDelta > 0 ? `+${l.qtyDelta}` : l.qtyDelta} {l.unit}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{peso(l.unitCost)}</TableCell>
                      <TableCell className="text-right tabular-nums">{peso(l.lineValue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {canApprove && adj.status === "PENDING" && (
              <div className="grid gap-2 rounded-lg border p-3">
                <Label htmlFor="adj-decision-note">Decision note (optional)</Label>
                <Textarea id="adj-decision-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="flex gap-2">
                  <Button onClick={() => decide("approve")} disabled={pending}>
                    {pending ? "Working…" : "Approve & post"}
                  </Button>
                  <Button variant="outline" className="text-destructive" onClick={() => decide("reject")} disabled={pending}>
                    Reject
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
