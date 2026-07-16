"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ReceiptTextIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ColorBadge } from "@/components/color-badge";
import { ErrorState } from "@/components/data-states";
import { sanitizeDecimal } from "@/lib/form-numeric";
import { cn } from "@/lib/utils";
import { PaymentMethod } from "@/generated/prisma/enums";
import {
  RECEIPT_KIND,
  RECEIPT_KIND_LABEL,
  type ReceiptKind,
} from "../schemas/receipt";
import { usePaymentOptions, useReceivePayment } from "../hooks/use-sales-audit";

// Kept in step with services/money.ts — the cashier sees the same arithmetic
// the ledger records (VAT is backed OUT of a VAT-inclusive price).
const VAT_DIVISOR = 1.12;

const peso = (v: number) =>
  `₱${v.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const num = (v: string) => {
  const n = parseFloat(v.replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
};

const KIND_ORDER: ReceiptKind[] = [
  RECEIPT_KIND.JO_RECEIPT,
  RECEIPT_KIND.SI_VAT,
  RECEIPT_KIND.SI_NON_VAT,
  RECEIPT_KIND.COLLECTION,
];

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: PaymentMethod.CASH, label: "Cash" },
  { value: PaymentMethod.GCASH, label: "GCash" },
  { value: PaymentMethod.CHECK, label: "Cheque" },
  { value: PaymentMethod.BANK_TRANSFER, label: "Bank transfer" },
  { value: PaymentMethod.QR, label: "QR" },
];

/** Receive Payment — issue a receipt against a Job Order and take the money. */
export function ReceivePaymentDialog({
  jobOrderId,
  onClose,
}: {
  jobOrderId: string | null;
  onClose: () => void;
}) {
  const options = usePaymentOptions(jobOrderId);
  const receive = useReceivePayment();
  const jo = options.data;

  const [kind, setKind] = useState<ReceiptKind>(RECEIPT_KIND.SI_VAT);
  // null → untouched, so the field shows the JO's outstanding balance (the
  // usual thing the cashier is collecting). Derived, not synced in an effect.
  const [amountEdit, setAmountEdit] = useState<string | null>(null);
  const [tendered, setTendered] = useState("");
  const [method, setMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [methodDetail, setMethodDetail] = useState("");
  const [notes, setNotes] = useState("");

  const amount = amountEdit ?? jo?.balance ?? "";
  const setAmount = (v: string) => setAmountEdit(v);

  const reset = () => {
    setKind(RECEIPT_KIND.SI_VAT);
    setAmountEdit(null);
    setTendered("");
    setMethod(PaymentMethod.CASH);
    setMethodDetail("");
    setNotes("");
    onClose();
  };

  const gross = num(amount);
  const isVat = kind === RECEIPT_KIND.SI_VAT;
  const vatableSales = isVat ? gross / VAT_DIVISOR : gross;
  const vatAmount = isVat ? gross - vatableSales : 0;

  const isCash = method === PaymentMethod.CASH;
  const cash = num(tendered);
  const change = isCash && tendered !== "" ? cash - gross : 0;
  const isShort = isCash && tendered !== "" && cash < gross;

  const nextNumber = jo?.nextNumbers[kind] ?? null;
  const blocked = !nextNumber;

  const submit = () => {
    if (!jobOrderId) return;
    if (gross <= 0) {
      toast.error("Enter an amount greater than zero.");
      return;
    }
    if (isShort) {
      toast.error("Cash received is less than the amount due.");
      return;
    }
    receive.mutate(
      {
        jobOrderId,
        kind,
        amount,
        // Change is only meaningful for cash; a cheque gives none.
        cashTendered: isCash ? tendered : "",
        method,
        methodDetail: methodDetail.trim() || undefined,
        notes: notes.trim() || undefined,
      },
      {
        onSuccess: (r) => {
          toast.success(`${RECEIPT_KIND_LABEL[kind]} ${r.documentNo} issued.`, {
            description:
              num(r.changeGiven) > 0
                ? `Change due: ${peso(num(r.changeGiven))}`
                : undefined,
          });
          reset();
        },
        onError: (e: Error) => toast.error(e.message),
      }
    );
  };

  return (
    <Dialog open={jobOrderId !== null} onOpenChange={(o) => !o && reset()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ReceiptTextIcon className="size-5" /> Receive Payment
          </DialogTitle>
          <DialogDescription>
            {jo
              ? `${jo.joNumber} · ${jo.customer.name}`
              : "Loading job order…"}
          </DialogDescription>
        </DialogHeader>

        {options.isPending ? (
          <div className="grid gap-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : options.isError ? (
          <ErrorState
            message={options.error.message}
            onRetry={() => options.refetch()}
          />
        ) : jo ? (
          <div className="grid gap-5">
            {/* ——— who it's billed to: already on the JO, never retyped ——— */}
            <div className="grid gap-1 rounded-md border bg-muted/40 p-3 text-sm">
              <div className="font-medium">{jo.customer.name}</div>
              <div className="text-muted-foreground">
                {jo.customer.address || "No address on file"}
              </div>
              <div className="flex flex-wrap gap-x-4 text-muted-foreground">
                <span>TIN: {jo.customer.tin || "—"}</span>
                {jo.customer.vatRegistered && (
                  <ColorBadge tone="blue" label="VAT-registered" />
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 border-t pt-2 text-xs">
                <span>
                  JO total{" "}
                  <strong className="tabular-nums">{peso(num(jo.joTotal))}</strong>
                </span>
                <span>
                  Received{" "}
                  <strong className="tabular-nums">
                    {peso(num(jo.totalReceived))}
                  </strong>
                </span>
                <span>
                  Balance{" "}
                  <strong className="tabular-nums text-foreground">
                    {peso(num(jo.balance))}
                  </strong>
                </span>
              </div>
            </div>

            {/* ——— receipt kind ——— */}
            <div className="grid gap-2">
              <Label>Receipt type</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {KIND_ORDER.map((k) => {
                  const next = jo.nextNumbers[k];
                  const active = kind === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setKind(k)}
                      aria-pressed={active}
                      className={cn(
                        "flex flex-col items-start gap-0.5 rounded-md border p-3 text-left transition-colors",
                        active
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "hover:bg-muted/50",
                        !next && "opacity-60"
                      )}
                    >
                      <span className="text-sm font-medium">
                        {RECEIPT_KIND_LABEL[k]}
                      </span>
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {next ?? "no active booklet"}
                      </span>
                    </button>
                  );
                })}
              </div>
              {blocked && (
                <p className="text-sm text-destructive">
                  No active booklet for {RECEIPT_KIND_LABEL[kind]}. Register and
                  approve one under Sales Audit Maintenance before issuing.
                </p>
              )}
            </div>

            {/* ——— money ——— */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="rp-amount">Amount</Label>
                <Input
                  id="rp-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(sanitizeDecimal(e.target.value))}
                  placeholder="0.00"
                  className="text-right font-mono tabular-nums"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="rp-method">Payment method</Label>
                <Select
                  value={method}
                  onValueChange={(v) => setMethod(v as PaymentMethod)}
                >
                  <SelectTrigger id="rp-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {METHODS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {isCash ? (
                <div className="grid gap-1.5">
                  <Label htmlFor="rp-tendered">Amount received (cash)</Label>
                  <Input
                    id="rp-tendered"
                    inputMode="decimal"
                    value={tendered}
                    onChange={(e) => setTendered(sanitizeDecimal(e.target.value))}
                    placeholder="0.00"
                    aria-invalid={isShort}
                    className={cn(
                      "text-right font-mono tabular-nums",
                      isShort && "border-destructive"
                    )}
                  />
                  {isShort && (
                    <p className="text-xs text-destructive">
                      Short by {peso(gross - cash)}.
                    </p>
                  )}
                </div>
              ) : (
                <div className="grid gap-1.5">
                  <Label htmlFor="rp-detail">Reference no.</Label>
                  <Input
                    id="rp-detail"
                    value={methodDetail}
                    onChange={(e) => setMethodDetail(e.target.value)}
                    placeholder="Cheque no. / GCash ref"
                  />
                </div>
              )}

              {/* ——— change: the number the cashier actually needs ——— */}
              <div className="grid gap-1.5">
                <Label>Change</Label>
                <div
                  className={cn(
                    "flex h-9 items-center justify-end rounded-md border px-3 font-mono text-base tabular-nums",
                    change > 0
                      ? "border-emerald-500/40 bg-emerald-50 font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                      : "bg-muted/40 text-muted-foreground"
                  )}
                >
                  {peso(Math.max(change, 0))}
                </div>
              </div>
            </div>

            {/* ——— VAT breakdown, live ——— */}
            <div className="grid gap-1 rounded-md border p-3 text-sm">
              <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Breakdown
                {isVat && <ColorBadge tone="blue" label="VAT 12%" />}
              </div>
              {isVat ? (
                <>
                  <Row label="Vatable sales (÷ 1.12)" value={peso(vatableSales)} />
                  <Row label="VAT (× 12%)" value={peso(vatAmount)} />
                </>
              ) : (
                <Row
                  label={
                    kind === RECEIPT_KIND.COLLECTION
                      ? "Collection (not a sale — no VAT)"
                      : "Non-VAT sales"
                  }
                  value={peso(gross)}
                />
              )}
              <div className="mt-1 flex items-center justify-between border-t pt-1.5 font-semibold">
                <span>Total</span>
                <span className="font-mono tabular-nums">{peso(gross)}</span>
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="rp-notes">Notes</Label>
              <Textarea
                id="rp-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Optional"
              />
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={reset}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={
              receive.isPending || blocked || gross <= 0 || isShort || !jo
            }
          >
            {receive.isPending
              ? "Issuing…"
              : nextNumber
                ? `Issue ${nextNumber}`
                : "Issue receipt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}
