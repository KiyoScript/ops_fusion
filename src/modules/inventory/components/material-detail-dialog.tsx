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
import { ErrorState } from "@/components/data-states";
import { Skeleton } from "@/components/ui/skeleton";
import { archiveMaterialAction } from "@/app/(app)/inventory/actions";
import { useMaterialDetail, useInvalidateInventory } from "../hooks/use-inventory";
import { MaterialFormDialog } from "./material-form-dialog";

const peso = (v: string) => {
  const n = parseFloat(v);
  return isNaN(n) ? v : `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
};

export function MaterialDetailDialog({
  id,
  canMaintain,
  onClose,
}: {
  id: string | null;
  canMaintain: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const invalidate = useInvalidateInventory();
  const query = useMaterialDetail(id);
  const [editing, setEditing] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [pending, startTransition] = useTransition();
  const m = query.data;

  const archive = () => {
    if (!m) return;
    startTransition(async () => {
      const result = await archiveMaterialAction({ id: m.id });
      if (!result.ok) {
        toast.error(result.error);
        setConfirmArchive(false);
        return;
      }
      toast.success("Item archived.");
      invalidate();
      router.refresh();
      onClose();
    });
  };

  return (
    <>
      <Dialog open={id !== null && !editing} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          {query.isPending ? (
            <div className="grid gap-3 py-4">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : query.isError ? (
            <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
          ) : m ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{m.code}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="wrap-break-word">{m.name}</span>
                  {m.status === "INACTIVE" && <Badge variant="outline">Inactive</Badge>}
                  {m.belowReorder && <Badge variant="destructive">Low stock</Badge>}
                </DialogTitle>
                <DialogDescription>
                  {[m.category, m.location, m.area].filter(Boolean).join(" · ") || "Item master detail"}
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="On hand" value={`${m.onHand.toLocaleString()} ${m.unit}`} strong />
                <Stat label="Stock value" value={peso(m.stockValue)} />
                <Stat label="Unit cost / pc" value={peso(m.unitCost)} />
                <Stat label="Reorder level" value={m.reorderLevel ? `${m.reorderLevel} ${m.unit}` : "—"} />
                <Stat label="Pack size" value={m.packSize ? `${m.packSize} pcs/bundle` : "by piece"} />
                <Stat label="Price / bundle" value={m.unitPrice ? peso(m.unitPrice) : "—"} />
                <Stat label="Supplier" value={m.supplier?.name ?? "—"} />
                <Stat label="Added" value={format(new Date(m.createdAt), "M/d/yyyy")} />
              </div>

              {m.notes && (
                <p className="rounded-lg bg-muted/50 p-3 text-sm whitespace-pre-line">{m.notes}</p>
              )}

              <div>
                <h3 className="mb-1.5 text-sm font-semibold">Stock movements</h3>
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">In</TableHead>
                        <TableHead className="text-right">Out</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                        <TableHead>Note</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>By</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {m.movements.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                            No movements yet.
                          </TableCell>
                        </TableRow>
                      ) : (
                        m.movements.map((mv) => (
                          <TableRow key={mv.id}>
                            <TableCell><Badge variant="secondary">{mv.type}</Badge></TableCell>
                            <TableCell className="text-right tabular-nums text-emerald-600">
                              {mv.qtyIn ? `+${mv.qtyIn}` : ""}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-destructive">
                              {mv.qtyOut ? `−${mv.qtyOut}` : ""}
                            </TableCell>
                            <TableCell className="text-right font-medium tabular-nums">{mv.balance}</TableCell>
                            <TableCell className="max-w-48 text-sm text-muted-foreground wrap-break-word">{mv.note ?? ""}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{format(new Date(mv.occurredAt), "M/d/yyyy")}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{mv.createdByName}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {canMaintain && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" onClick={() => setEditing(true)}>Edit item</Button>
                  {confirmArchive ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Archive this item?</span>
                      <Button variant="destructive" size="sm" onClick={archive} disabled={pending}>
                        {pending ? "Archiving…" : "Confirm"}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmArchive(false)}>Cancel</Button>
                    </div>
                  ) : (
                    <Button variant="ghost" className="text-destructive" onClick={() => setConfirmArchive(true)}>
                      Archive
                    </Button>
                  )}
                </div>
              )}
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <MaterialFormDialog
        open={editing}
        onOpenChange={(o) => {
          setEditing(o);
          if (!o) invalidate();
        }}
        material={m ?? null}
      />
    </>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={strong ? "text-lg font-semibold tabular-nums" : "text-sm tabular-nums"}>{value}</span>
    </div>
  );
}
