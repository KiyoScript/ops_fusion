"use client";

import { useState } from "react";
import { FileTextIcon, ReceiptTextIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorState } from "@/components/data-states";
import type { JobOrderCreateInput, JobOrderDetailDto } from "../schemas/job-order";
import { useInvalidateJobOrders, useJoDetail } from "../hooks/use-job-orders";
import { ReceivePaymentDialog } from "@/modules/sales-audit/components/receive-payment-dialog";
import { JobOrderForm } from "./job-order-form";
import { ArchiveJobOrderButton } from "./archive-job-order-button";
import { CustomerApprovalSection } from "./customer-approval-section";

/** The one-stop JO edit modal: whole JO (customer, dates, notes), every item
 *  with status + remark, add/remove items, delete — no page navigation.
 *  Receive Payment issues a receipt against this JO (Sales & Audit). */
export function JoEditDialog({
  jobOrderId,
  canDelete,
  canReceivePayment = false,
  onClose,
}: {
  jobOrderId: string | null;
  canDelete: boolean;
  canReceivePayment?: boolean;
  onClose: () => void;
}) {
  const invalidate = useInvalidateJobOrders();
  const detail = useJoDetail(jobOrderId);
  const jo = detail.data;
  const [payingJoId, setPayingJoId] = useState<string | null>(null);

  const done = () => {
    invalidate();
    onClose();
  };

  return (
    <Dialog open={jobOrderId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-2 pr-8">
            <DialogTitle>
              {jo ? `Edit ${jo.joNumber}` : "Edit Job Order"}
            </DialogTitle>
            <span className="flex items-center gap-2">
              {jo && canReceivePayment && (
                <Button
                  size="sm"
                  onClick={() => setPayingJoId(jo.id)}
                >
                  <ReceiptTextIcon /> Receive Payment
                </Button>
              )}
              {jo && (
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={
                    <a
                      href={`/api/job-orders/${jo.id}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                >
                  <FileTextIcon /> PDF
                </Button>
              )}
              {jo && canDelete && (
                <ArchiveJobOrderButton
                  id={jo.id}
                  joNumber={jo.joNumber}
                  onArchived={done}
                />
              )}
            </span>
          </div>
          <DialogDescription>
            {jo
              ? `${jo.customer.name} · ${jo.items.length} item(s)`
              : "Loading…"}
          </DialogDescription>
        </DialogHeader>

        {detail.isPending ? (
          <div className="grid gap-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : detail.isError ? (
          <ErrorState
            message={detail.error.message}
            onRetry={() => detail.refetch()}
          />
        ) : jo ? (
          <div className="grid gap-4">
            <CustomerApprovalSection jo={jo} onChanged={invalidate} />
            <JobOrderForm
              mode="edit"
              jobOrderId={jo.id}
              initialValues={detailToFormValues(jo)}
              onSuccess={done}
              onCancel={onClose}
            />
          </div>
        ) : null}
      </DialogContent>

      <ReceivePaymentDialog
        jobOrderId={payingJoId}
        onClose={() => {
          setPayingJoId(null);
          invalidate();
        }}
      />
    </Dialog>
  );
}

function detailToFormValues(jo: JobOrderDetailDto): JobOrderCreateInput {
  return {
    joNumber: jo.joNumber,
    isPO: jo.isPO,
    isNonJo: jo.isNonJo,
    customerName: jo.customer.name,
    notes: jo.notes ?? "",
    planDateStart: jo.planDateStart ?? "",
    planDateEnd: jo.planDateEnd ?? "",
    items: jo.items.map((item) => ({
      id: item.id,
      description: item.description,
      qty: String(item.qty),
      amount: item.lineTotal,
      deadline: item.deadline ?? "",
      productionStatus: item.productionStatus ?? "",
      remark: "",
      assignedTo: item.assignedTo ?? "",
      category: item.category ?? "",
      isLFP: item.isLFP,
      lfpWidth: item.lfpWidth ?? "",
      lfpHeight: item.lfpHeight ?? "",
      lfpUnit: item.lfpUnit ?? "ft",
      isRush: item.isRush,
    })),
  };
}
