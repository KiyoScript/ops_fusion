"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ClipboardListIcon, HourglassIcon, ReceiptTextIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorState } from "@/components/data-states";
import type { JobOrderCreateInput, JobOrderDetailDto } from "../schemas/job-order";
import {
  useInvalidateJobOrders,
  useJoDetail,
  useReviewJo,
} from "../hooks/use-job-orders";
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
  canReview = false,
  canResubmit = false,
  onClose,
}: {
  jobOrderId: string | null;
  canDelete: boolean;
  canReceivePayment?: boolean;
  canReview?: boolean;
  canResubmit?: boolean;
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
                      href={`/api/job-orders/${jo.id}/production-pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                >
                  <ClipboardListIcon /> Production
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
            {canReview && jo.status === "PENDING_REVIEW" && (
              <ReorderReviewSection jo={jo} onReviewed={done} />
            )}
            {canResubmit && jo.status === "DRAFT" && (
              <ReorderResubmitSection jo={jo} onResubmitted={done} />
            )}
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

/** Admin gate for a reorder JO awaiting review. Approve releases it into
 *  production (requires the customer's sign-off to be recorded first); reject
 *  cancels it with an optional reason. */
function ReorderReviewSection({
  jo,
  onReviewed,
}: {
  jo: JobOrderDetailDto;
  onReviewed: () => void;
}) {
  const review = useReviewJo();
  const [reason, setReason] = useState("");
  const custOk = jo.isApprovedByCustomer;

  const act = (action: "approve" | "reject") =>
    review.mutate(
      {
        joId: jo.id,
        action,
        reason: action === "reject" ? reason.trim() || undefined : undefined,
      },
      {
        onSuccess: () => {
          toast.success(
            action === "approve"
              ? "Reorder approved — released to production."
              : "Sent back to draft for edits."
          );
          onReviewed();
        },
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "Could not update the review."
          ),
      }
    );

  return (
    <div className="grid gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <HourglassIcon className="size-4" /> For review — reorder awaiting admin approval
      </div>
      <p className="text-xs text-muted-foreground">
        Customer approval:{" "}
        {custOk ? (
          <span className="font-medium text-foreground">recorded ✓</span>
        ) : (
          "pending — record it below before approving."
        )}
      </p>
      <Textarea
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (required only when rejecting)…"
        className="text-sm"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!custOk || review.isPending}
          title={custOk ? undefined : "Record the customer's approval first."}
          onClick={() => act("approve")}
        >
          Approve → production
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={review.isPending}
          title="Send back to the creator to edit and resubmit — the JO is kept, not cancelled."
          onClick={() => act("reject")}
        >
          Send back for edits
        </Button>
      </div>
    </div>
  );
}

/** Shown on a reorder that was sent back for edits (status DRAFT). The creator
 *  adjusts the items in the form below, then resubmits it for review. */
function ReorderResubmitSection({
  jo,
  onResubmitted,
}: {
  jo: JobOrderDetailDto;
  onResubmitted: () => void;
}) {
  const review = useReviewJo();
  return (
    <div className="grid gap-2 rounded-lg border border-sky-500/40 bg-sky-500/5 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <HourglassIcon className="size-4" /> Draft — sent back for edits
      </div>
      <p className="text-xs text-muted-foreground">
        Adjust the items below, then resubmit for the admin review.
      </p>
      <div>
        <Button
          size="sm"
          disabled={review.isPending}
          onClick={() =>
            review.mutate(
              { joId: jo.id, action: "resubmit" },
              {
                onSuccess: () => {
                  toast.success("Resubmitted for review.");
                  onResubmitted();
                },
                onError: (err) =>
                  toast.error(
                    err instanceof Error ? err.message : "Could not resubmit."
                  ),
              }
            )
          }
        >
          Resubmit for review
        </Button>
      </div>
    </div>
  );
}

function detailToFormValues(jo: JobOrderDetailDto): JobOrderCreateInput {
  return {
    joNumber: jo.joNumber,
    isPO: jo.isPO,
    customerName: jo.customer.name,
    notes: jo.notes ?? "",
    planDateStart: jo.planDateStart ?? "",
    planDateEnd: jo.planDateEnd ?? "",
    items: jo.items.map((item) => ({
      id: item.id,
      fromQuote: item.fromQuote,
      unitPrice: item.unitPrice,
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
