"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MoreHorizontalIcon, RotateCcwIcon, XCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  closeInquiryAction,
  reopenInquiryAction,
} from "@/app/(app)/inquiries/actions";
import type { InquiryRowDto } from "../schemas/inquiry";
import { InquiryDialog } from "./inquiry-dialog";
import { useInvalidateInquiries } from "../hooks/use-inquiries";

/** Row actions for an inquiry with no quotation yet: edit (OPEN),
 *  close-with-reason (OPEN), or reopen (CLOSED). */
export function InquiryRowActions({ inquiry }: { inquiry: InquiryRowDto }) {
  const router = useRouter();
  const invalidate = useInvalidateInquiries();
  const [pending, startTransition] = useTransition();
  const [closeOpen, setCloseOpen] = useState(false);
  const [reason, setReason] = useState("");

  const doClose = () => {
    startTransition(async () => {
      const result = await closeInquiryAction({ id: inquiry.id, reason });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Inquiry closed.");
      setCloseOpen(false);
      invalidate();
      router.refresh();
    });
  };

  const doReopen = () => {
    startTransition(async () => {
      const result = await reopenInquiryAction(inquiry.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Inquiry reopened.");
      invalidate();
      router.refresh();
    });
  };

  return (
    <div className="flex items-center justify-end gap-1">
      {inquiry.status === "OPEN" && <InquiryDialog inquiry={inquiry} />}

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon" aria-label="More actions" />
          }
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {inquiry.status === "CLOSED" ? (
            <DropdownMenuItem onClick={doReopen} disabled={pending}>
              <RotateCcwIcon /> Reopen inquiry
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onClick={() => setCloseOpen(true)}
              disabled={pending}
            >
              <XCircleIcon /> Close inquiry
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close this inquiry?</DialogTitle>
            <DialogDescription>
              Use this when the inquiry won&apos;t become a quote — no interest,
              unreachable, or spam. You can reopen it later.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="close-reason">Reason (optional)</Label>
            <Textarea
              id="close-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Customer went with another shop."
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCloseOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={doClose} disabled={pending}>
              Close inquiry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
