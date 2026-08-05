"use client";

import { useState } from "react";
import { toast } from "sonner";
import { BanIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ReceiptVoidType } from "@/generated/prisma/enums";
import {
  VOID_TYPE_HINT,
  VOID_TYPE_LABEL,
  type ReceiptKind,
} from "../schemas/receipt";
import { useVoidReceipt } from "../hooks/use-sales-audit";
import { OnHandCheck } from "./on-hand-check";

/** CANCELLED and VOID are terminal here; REPLACED runs through Receive Payment. */
const CHOICES = [ReceiptVoidType.CANCELLED, ReceiptVoidType.VOID] as const;

/**
 * The minimum this dialog needs to cancel something. Deliberately not
 * ReceiptRowDto: the same action is reached from the job order's receipt list
 * and from a customer's payment history, and those carry different shapes.
 */
export type VoidTarget = {
  id: string;
  kind: ReceiptKind;
  /** Null for a payment recorded without a Collection Receipt. */
  documentNo: string | null;
  kindLabel: string;
  amount: string;
};

/**
 * Cancel or void an issued receipt — docs/sales.txt §5.
 *
 * Deliberately blunt about what does NOT happen: the receipt keeps its serial
 * number and stays in the booklet. Cashiers who expect "delete" need to see
 * that this is a mark on the face of the document, not a removal.
 */
export function VoidReceiptDialog({
  receipt,
  onClose,
  onVoided,
}: {
  receipt: VoidTarget | null;
  onClose: () => void;
  onVoided?: () => void;
}) {
  const voidReceipt = useVoidReceipt();
  const [type, setType] = useState<(typeof CHOICES)[number]>(
    ReceiptVoidType.CANCELLED
  );
  const [reason, setReason] = useState("");
  const [onHand, setOnHand] = useState(false);

  const reset = () => {
    setType(ReceiptVoidType.CANCELLED);
    setReason("");
    setOnHand(false);
    onClose();
  };

  const submit = () => {
    if (!receipt) return;
    if (reason.trim().length < 3) {
      toast.error("Write the reason for the cancellation.");
      return;
    }
    // Only a printed receipt has paper to hold up — see the OnHandCheck below,
    // which is not rendered at all when there is none.
    if (receipt.documentNo && !onHand) {
      toast.error(`Confirm that ${receipt.documentNo} is on hand first.`);
      return;
    }
    voidReceipt.mutate(
      { receiptId: receipt.id, kind: receipt.kind, type, reason },
      {
        onSuccess: (r) => {
          toast.success(
            `${r.documentNo ?? "The payment"} marked ${VOID_TYPE_LABEL[type]}.`,
            {
              description: r.documentNo
                ? "The number stays in the booklet. The balance it settled reopens."
                : "The balance it settled reopens.",
            }
          );
          reset();
          onVoided?.();
        },
        onError: (e: Error) => toast.error(e.message),
      }
    );
  };

  return (
    <Dialog open={receipt !== null} onOpenChange={(o) => !o && reset()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BanIcon className="size-5" /> Cancel receipt
          </DialogTitle>
          <DialogDescription>
            {receipt
              ? `${receipt.documentNo ?? "Payment"} · ${receipt.kindLabel} · ${receipt.amount}`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Mark it as</Label>
            {CHOICES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setType(c)}
                aria-pressed={type === c}
                className={cn(
                  "grid gap-0.5 rounded-md border p-3 text-left transition-colors",
                  type === c
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "hover:bg-muted/50"
                )}
              >
                <span className="text-sm font-medium">{VOID_TYPE_LABEL[c]}</span>
                <span className="text-xs text-muted-foreground">
                  {VOID_TYPE_HINT[c]}
                </span>
              </button>
            ))}
            <p className="text-xs text-muted-foreground">
              To reissue a corrected receipt instead, close this and use{" "}
              <strong>Replace</strong> — that keeps the two serial numbers
              linked to each other.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="vr-reason">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="vr-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Written on the face of the receipt — e.g. customer cancelled the order"
            />
          </div>

          {/* The part people get wrong. Say it before they click, not after. */}
          <p className="rounded-md border border-amber-500/40 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            {receipt?.documentNo
              ? `${receipt.documentNo} keeps its number and stays attached to this job order, marked ${VOID_TYPE_LABEL[type].toLowerCase()}.`
              : `This payment stays on the ledger, marked ${VOID_TYPE_LABEL[type].toLowerCase()}.`}{" "}
            It stops counting towards sales and the job order&rsquo;s balance
            reopens, so a new receipt can be issued against it.
          </p>

          {/* §5.1 step 4 — the paper has to be in front of them. A payment
              recorded without a receipt has no paper to hold up, so there is
              nothing to confirm. */}
          {receipt?.documentNo && (
            <OnHandCheck
              id="vr-onhand"
              checked={onHand}
              onChange={setOnHand}
              documentNo={receipt.documentNo}
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={reset}>
            Keep it
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={
              voidReceipt.isPending ||
              reason.trim().length < 3 ||
              // No printed receipt, no paper to have on hand — requiring the
              // tick would leave the button dead forever.
              (Boolean(receipt?.documentNo) && !onHand)
            }
          >
            {voidReceipt.isPending
              ? "Cancelling…"
              : `Mark ${VOID_TYPE_LABEL[type]}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
