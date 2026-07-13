"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArchiveIcon,
  CheckIcon,
  SendHorizonalIcon,
  SendIcon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  archiveQuotationAction,
  transitionQuotationAction,
} from "@/app/(app)/quotations/actions";

/** Lifecycle buttons for the detail page — which ones render depends on the
 *  current status and the caller's CASL abilities (resolved server-side). */
export function QuotationStatusActions({
  id,
  quoteNumber,
  status,
  canUpdate,
  canApprove,
  canSend,
  canArchive,
}: {
  id: string;
  quoteNumber: string;
  status: string;
  canUpdate: boolean;
  canApprove: boolean;
  canSend: boolean;
  canArchive: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [reason, setReason] = useState("");

  const run = (
    action: "submit" | "approve" | "reject" | "send",
    successMessage: string,
    extra?: { reason?: string }
  ) => {
    startTransition(async () => {
      const result = await transitionQuotationAction({ id, action, ...extra });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(successMessage);
      setRejectOpen(false);
      router.refresh();
    });
  };

  const archive = () => {
    startTransition(async () => {
      const result = await archiveQuotationAction(id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${quoteNumber} archived.`);
      setArchiveOpen(false);
      router.push("/quotations");
      router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "DRAFT" && canUpdate && (
        <Button
          onClick={() => run("submit", "Submitted for approval.")}
          disabled={pending}
        >
          <SendHorizonalIcon /> Submit for approval
        </Button>
      )}

      {status === "PENDING_APPROVAL" && canApprove && (
        <>
          <Button
            onClick={() => run("approve", `${quoteNumber} approved.`)}
            disabled={pending}
          >
            <CheckIcon /> Approve
          </Button>
          <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
            <DialogTrigger render={<Button variant="destructive" />}>
              <XIcon /> Reject
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Reject {quoteNumber}?</DialogTitle>
                <DialogDescription>
                  The encoder can edit the quotation and resubmit it. Tell them
                  what needs to change.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-2">
                <Label htmlFor="reject-reason">Reason</Label>
                <Textarea
                  id="reject-reason"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Rate is below the minimum charge for this size."
                />
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setRejectOpen(false)}
                  disabled={pending}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() =>
                    run("reject", `${quoteNumber} rejected.`, { reason })
                  }
                  disabled={pending || !reason.trim()}
                >
                  Reject quotation
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}

      {status === "APPROVED" && canSend && (
        <Button
          onClick={() => run("send", "Marked as sent to the customer.")}
          disabled={pending}
        >
          <SendIcon /> Mark as sent
        </Button>
      )}

      {canArchive && status !== "CONVERTED" && (
        <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
          <DialogTrigger render={<Button variant="outline" />}>
            <ArchiveIcon /> Archive
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Archive {quoteNumber}?</DialogTitle>
              <DialogDescription>
                The quotation leaves the list but is never hard-deleted.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setArchiveOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button variant="destructive" onClick={archive} disabled={pending}>
                Archive quotation
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
