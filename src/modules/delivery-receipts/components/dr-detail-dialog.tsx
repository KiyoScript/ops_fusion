"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { toast } from "sonner";
import { FileTextIcon } from "lucide-react";
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
import { cancelDrAction } from "@/app/(app)/delivery-receipts/actions";
import { useDrDetail, useInvalidateDrs } from "../hooks/use-delivery-receipts";

const peso = (v: string) => {
  const n = parseFloat(v);
  return isNaN(n) ? v : `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
};

export function DrDetailDialog({
  drId,
  canCancel,
  onClose,
}: {
  drId: string | null;
  canCancel: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const invalidate = useInvalidateDrs();
  const detail = useDrDetail(drId);
  const dr = detail.data;
  const [pending, startTransition] = useTransition();

  const cancel = () => {
    if (!dr) return;
    startTransition(async () => {
      const result = await cancelDrAction({ id: dr.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${dr.drNumber} cancelled — quantities returned.`);
      invalidate();
      router.refresh();
      onClose();
    });
  };

  return (
    <Dialog open={drId !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8">
            {dr ? dr.drNumber : "Delivery Receipt"}
            {dr?.status === "CANCELLED" && (
              <Badge variant="destructive">Cancelled</Badge>
            )}
            {dr && (
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                className="ml-auto"
                render={
                  <a
                    href={`/api/delivery-receipts/${dr.id}/pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                }
              >
                <FileTextIcon /> PDF
              </Button>
            )}
          </DialogTitle>
          <DialogDescription>
            {dr ? `${dr.jobOrder.joNumber} · ${dr.customer.name}` : "Loading…"}
          </DialogDescription>
        </DialogHeader>

        {detail.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : detail.isError ? (
          <ErrorState message={detail.error.message} onRetry={() => detail.refetch()} />
        ) : dr ? (
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              <Field label="Issued" value={format(new Date(dr.issuedAt), "MMM d, yyyy h:mm a")} />
              <Field label="Prepared by" value={dr.createdByName} />
              <Field label="Total" value={peso(dr.amount)} />
              {dr.notes && (
                <div className="sm:col-span-3">
                  <Field label="Notes" value={dr.notes} />
                </div>
              )}
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dr.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <div className="text-sm">{l.description}</div>
                      <div className="text-xs text-muted-foreground">{l.lineItemId}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{l.qty}</TableCell>
                    <TableCell className="text-right tabular-nums">{peso(l.unitPrice)}</TableCell>
                    <TableCell className="text-right tabular-nums">{peso(l.lineTotal)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* TODO(SALES): advance-payment applied + remaining balance here */}

            {canCancel && dr.status !== "CANCELLED" && (
              <div className="flex justify-end">
                <Button variant="destructive" onClick={cancel} disabled={pending}>
                  {pending ? "Cancelling…" : "Cancel DR (return quantities)"}
                </Button>
              </div>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="whitespace-pre-wrap">{value}</span>
    </div>
  );
}
