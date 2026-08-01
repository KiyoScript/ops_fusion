"use client";

import { useTransition } from "react";
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
import { ErrorState } from "@/components/data-states";
import { Skeleton } from "@/components/ui/skeleton";
import {
  approveCycleCountAction,
  cancelCycleCountAction,
  submitCycleCountAction,
} from "@/app/(app)/inventory/actions";
import { useCycleCountDetail, useInvalidateInventory } from "../hooks/use-inventory";

function StatusBadge({ status }: { status: string }) {
  if (status === "APPROVED") return <Badge variant="secondary">Approved</Badge>;
  if (status === "COMPLETED") return <Badge variant="outline">Awaiting approval</Badge>;
  if (status === "CANCELLED") return <Badge variant="destructive">Cancelled</Badge>;
  return <Badge variant="outline">Draft</Badge>;
}

export function CycleCountDetailDialog({
  id,
  canApprove,
  canManage,
  onClose,
}: {
  id: string | null;
  canApprove: boolean;
  canManage: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const invalidate = useInvalidateInventory();
  const query = useCycleCountDetail(id);
  const [pending, startTransition] = useTransition();
  const cc = query.data;

  const run = (label: string, fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) { toast.error(result.error ?? "Failed."); return; }
      toast.success(label);
      invalidate();
      router.refresh();
      onClose();
    });

  return (
    <Dialog open={id !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        {query.isPending ? (
          <div className="grid gap-3 py-4"><Skeleton className="h-6 w-48" /><Skeleton className="h-24 w-full" /></div>
        ) : query.isError ? (
          <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
        ) : cc ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{cc.number}</span>
                <StatusBadge status={cc.status} />
              </DialogTitle>
              <DialogDescription>{cc.location ? `Scope: ${cc.location}` : "Physical count"}</DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-muted-foreground">Counted by</span> {cc.countedByName}</div>
              <div><span className="text-muted-foreground">On</span> {format(new Date(cc.countedAt), "M/d/yyyy h:mma")}</div>
              {cc.approvedByName && (
                <>
                  <div><span className="text-muted-foreground">Approved by</span> {cc.approvedByName}</div>
                  <div><span className="text-muted-foreground">On</span> {cc.approvedAt && format(new Date(cc.approvedAt), "M/d/yyyy h:mma")}</div>
                </>
              )}
            </div>
            {cc.note && <p className="rounded-lg bg-muted/50 p-3 text-sm whitespace-pre-line">{cc.note}</p>}

            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">System</TableHead>
                    <TableHead className="text-right">Counted</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cc.lines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell>
                        <span className="font-mono text-sm font-medium">{l.code}</span>
                        <span className="ml-2 text-sm wrap-break-word">{l.name}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{l.systemQty.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{l.countedQty.toLocaleString()}</TableCell>
                      <TableCell className={`text-right font-medium tabular-nums ${l.variance < 0 ? "text-destructive" : l.variance > 0 ? "text-emerald-600" : "text-muted-foreground"}`}>
                        {l.variance > 0 ? `+${l.variance}` : l.variance}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {(cc.status === "DRAFT" || cc.status === "COMPLETED") && (
              <div className="flex flex-wrap gap-2">
                {cc.status === "DRAFT" && canManage && (
                  <Button onClick={() => run("Count submitted for approval.", () => submitCycleCountAction({ id: cc.id }))} disabled={pending}>
                    Submit for approval
                  </Button>
                )}
                {cc.status === "COMPLETED" && canApprove && (
                  <Button onClick={() => run("Count approved — stock set to the physical count.", () => approveCycleCountAction({ id: cc.id }))} disabled={pending}>
                    Approve & post variances
                  </Button>
                )}
                {canManage && (
                  <Button variant="outline" className="text-destructive" onClick={() => run("Count cancelled.", () => cancelCycleCountAction({ id: cc.id }))} disabled={pending}>
                    Cancel count
                  </Button>
                )}
              </div>
            )}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
