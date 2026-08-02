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
  approveMrAction,
  cancelMrAction,
  rejectMrAction,
} from "@/app/(app)/inventory/material-request-actions";
import { useMaterialRequestDetail, useInvalidateInventory } from "../hooks/use-inventory";
import { MrReleaseDialog } from "./mr-release-dialog";
import { MrFormDialog } from "./mr-form-dialog";

const peso = (v: string) => {
  const n = parseFloat(v);
  return isNaN(n) ? v : `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
};

export function MrStatusBadge({ status }: { status: string }) {
  if (status === "RELEASED") return <Badge variant="secondary">Released</Badge>;
  if (status === "PARTIALLY_RELEASED") return <Badge variant="outline">Partially released</Badge>;
  if (status === "APPROVED") return <Badge variant="outline">Approved</Badge>;
  if (status === "REJECTED") return <Badge variant="destructive">Rejected</Badge>;
  if (status === "CANCELLED") return <Badge variant="destructive">Cancelled</Badge>;
  return <Badge variant="outline">Pending</Badge>;
}

export function MrDetailDialog({
  id,
  canApprove,
  canRelease,
  canCreate,
  onClose,
}: {
  id: string | null;
  canApprove: boolean;
  canRelease: boolean;
  canCreate: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const invalidate = useInvalidateInventory();
  const query = useMaterialRequestDetail(id);
  const [note, setNote] = useState("");
  const [releasing, setReleasing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const mr = query.data;

  const run = (label: string, fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) { toast.error(result.error ?? "Failed."); return; }
      toast.success(label);
      setNote("");
      invalidate();
      router.refresh();
      onClose();
    });

  const canDecide = canApprove && mr?.status === "PENDING";
  const canDoRelease = canRelease && (mr?.status === "APPROVED" || mr?.status === "PARTIALLY_RELEASED");
  const canEdit = canCreate && mr?.status === "REJECTED";
  const canCancel = canCreate && (mr?.status === "PENDING" || mr?.status === "APPROVED");

  return (
    <>
      <Dialog open={id !== null && !releasing && !editing} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          {query.isPending ? (
            <div className="grid gap-3 py-4"><Skeleton className="h-6 w-48" /><Skeleton className="h-24 w-full" /></div>
          ) : query.isError ? (
            <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
          ) : mr ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{mr.number}</span>
                  <MrStatusBadge status={mr.status} />
                </DialogTitle>
                <DialogDescription>
                  {mr.jobOrder ? `For JO ${mr.jobOrder.joNumber}` : mr.purpose ? `Purpose: ${mr.purpose}` : "Shop-use request"}
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                <div><span className="text-muted-foreground">Requested by</span><br />{mr.requestedByName}</div>
                <div><span className="text-muted-foreground">On</span><br />{format(new Date(mr.requestedAt), "M/d/yyyy h:mma")}</div>
                <div><span className="text-muted-foreground">Cost of materials</span><br /><span className="font-medium tabular-nums">{peso(mr.costOfMaterials)}</span></div>
                {mr.decidedByName && (
                  <div><span className="text-muted-foreground">Decided by</span><br />{mr.decidedByName}{mr.decidedAt ? ` · ${format(new Date(mr.decidedAt), "M/d/yyyy")}` : ""}</div>
                )}
                {mr.releasedByName && (
                  <div><span className="text-muted-foreground">Last released by</span><br />{mr.releasedByName}{mr.lastReleasedAt ? ` · ${format(new Date(mr.lastReleasedAt), "M/d/yyyy")}` : ""}</div>
                )}
              </div>
              {mr.decisionNote && <p className="text-sm text-muted-foreground">Note: {mr.decisionNote}</p>}
              {mr.releaseNote && <p className="text-sm text-muted-foreground">Release: {mr.releaseNote}</p>}

              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Needed</TableHead>
                      <TableHead className="text-right">Released</TableHead>
                      <TableHead className="text-right">On hand</TableHead>
                      <TableHead className="text-right">Unit cost</TableHead>
                      <TableHead className="text-right">Line cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mr.lines.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell>
                          <span className="font-mono text-sm font-medium">{l.code}</span>
                          <span className="ml-2 text-sm wrap-break-word">{l.name}</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{l.qtyNeeded} {l.unit}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {l.qtyReleased}{l.remaining > 0 && l.qtyReleased > 0 ? <span className="text-xs text-muted-foreground"> ({l.remaining} left)</span> : ""}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{l.onHand.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{peso(l.unitCost)}</TableCell>
                        <TableCell className="text-right tabular-nums">{peso(l.lineCost)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {canDecide && (
                <div className="grid gap-2 rounded-lg border p-3">
                  <Label htmlFor="mr-decision-note">Decision note (optional)</Label>
                  <Textarea id="mr-decision-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                  <div className="flex gap-2">
                    <Button onClick={() => run("Request approved.", () => approveMrAction({ id: mr.id, note: note.trim() || undefined }))} disabled={pending}>Approve</Button>
                    <Button variant="outline" className="text-destructive" onClick={() => run("Request rejected.", () => rejectMrAction({ id: mr.id, note: note.trim() || undefined }))} disabled={pending}>Reject</Button>
                  </div>
                </div>
              )}

              {(canDoRelease || canEdit || canCancel) && (
                <div className="flex flex-wrap gap-2">
                  {canDoRelease && <Button onClick={() => setReleasing(true)}>Release stock</Button>}
                  {canEdit && <Button variant="outline" onClick={() => setEditing(true)}>Edit &amp; resubmit</Button>}
                  {canCancel && (
                    <Button variant="ghost" className="text-destructive" onClick={() => run("Request cancelled.", () => cancelMrAction({ id: mr.id }))} disabled={pending}>Cancel request</Button>
                  )}
                </div>
              )}
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {mr && <MrReleaseDialog mr={mr} open={releasing} onOpenChange={(o) => { setReleasing(o); if (!o) invalidate(); }} />}
      <MrFormDialog open={editing} onOpenChange={(o) => { setEditing(o); if (!o) { invalidate(); onClose(); } }} mr={mr ?? null} />
    </>
  );
}
