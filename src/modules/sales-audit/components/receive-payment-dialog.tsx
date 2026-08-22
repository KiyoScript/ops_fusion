"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  BanIcon,
  PlusIcon,
  ReceiptTextIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";
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
  RECEIPT_KIND_HINT,
  RECEIPT_KIND_LABEL,
  VOID_TYPE_LABEL,
  type OpenInvoiceDto,
  type ReceiptKind,
  type ReceiptRowDto,
  type ReceivePaymentOptionsDto,
} from "../schemas/receipt";
import {
  usePaymentOptions,
  useReceivePayment,
  useReplaceReceipt,
} from "../hooks/use-sales-audit";
import { OnHandCheck } from "./on-hand-check";
import { VoidReceiptDialog } from "./void-receipt-dialog";

// Kept in step with services/money.ts — the cashier sees the same arithmetic
// the ledger records (VAT is backed OUT of a VAT-inclusive price).
const VAT_DIVISOR = 1.12;

const peso = (v: number) =>
  `₱${v.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const num = (v: string) => {
  const n = parseFloat(v.replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
};

// Compare money in whole centavos — 1000.10 + 1199.90 !== 2200 in binary
// floating point, and a split that "doesn't add up" by 1e-13 is not a thing
// the cashier should ever have to see.
const cent = (v: number) => Math.round(v * 100);

// Paired by row in the 2-column grid: the two acknowledgement slips first,
// then the Sales Invoices — VAT and Non-VAT side by side, since that is the
// choice the cashier actually agonises over.
const KIND_ORDER: ReceiptKind[] = [
  RECEIPT_KIND.JO_RECEIPT,
  RECEIPT_KIND.COLLECTION,
  RECEIPT_KIND.SI_VAT,
  RECEIPT_KIND.SI_NON_VAT,
  RECEIPT_KIND.SI_CHARGE,
];

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: PaymentMethod.CASH, label: "Cash" },
  { value: PaymentMethod.GCASH, label: "GCash" },
  { value: PaymentMethod.CHECK, label: "Cheque" },
  { value: PaymentMethod.BANK_TRANSFER, label: "Bank transfer" },
  { value: PaymentMethod.QR, label: "QR" },
];

/** VAT is backed out of these two; the rest carry none. */
const VAT_KINDS: ReceiptKind[] = [RECEIPT_KIND.SI_VAT, RECEIPT_KIND.SI_CHARGE];

/**
 * One tender line — a method and how much came in through it. The lines ARE
 * the money received: there is no separate "amount received" field to keep in
 * step with them, which is what removes the double entry at the counter.
 */
type Line = {
  key: string;
  method: PaymentMethod;
  amount: string;
  reference: string;
};

let lineSeq = 0;
const newLine = (method: PaymentMethod = PaymentMethod.CASH): Line => ({
  key: `line-${lineSeq++}`,
  method,
  amount: "",
  reference: "",
});

/** Receive Payment — issue a receipt against a Job Order and take the money. */
export function ReceivePaymentDialog({
  jobOrderId,
  canVoid = false,
  onClose,
}: {
  jobOrderId: string | null;
  /** Cancelling a receipt takes a supervisor — docs/sales.txt §5.1 step 6. */
  canVoid?: boolean;
  onClose: () => void;
}) {
  const options = usePaymentOptions(jobOrderId);
  const receive = useReceivePayment();
  const replace = useReplaceReceipt();
  const jo = options.data;

  const [voiding, setVoiding] = useState<ReceiptRowDto | null>(null);
  const [replacing, setReplacing] = useState<ReceiptRowDto | null>(null);
  const [replaceReason, setReplaceReason] = useState("");
  const [replaceOnHand, setReplaceOnHand] = useState(false);

  // Null until the server's recommendation lands, then the cashier's choice
  // wins. Storing null rather than a guess is what lets the preselection
  // follow the job order's actual state instead of a hardcoded SI_VAT.
  const [pickedKind, setPickedKind] = useState<ReceiptKind | null>(null);
  const [amountEdit, setAmountEdit] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [notes, setNotes] = useState("");
  const [issueDocument, setIssueDocument] = useState(true);
  // null = follow the amount; true/false = the cashier has decided.
  const [dpOverride, setDpOverride] = useState<boolean | null>(null);

  const kind =
    pickedKind ?? jo?.recommended ?? RECEIPT_KIND.SI_VAT;

  const isVat = VAT_KINDS.includes(kind);
  const isCharge = kind === RECEIPT_KIND.SI_CHARGE;
  const isCollection = kind === RECEIPT_KIND.COLLECTION;
  const isJoReceipt = kind === RECEIPT_KIND.JO_RECEIPT;

  // ——— what this document may be raised for ———
  // An invoice is capped by what is left to BILL; a collection by what is left
  // to COLLECT. They are different numbers, and using one for both is what
  // let a fully-invoiced job be invoiced a second time.
  const cap = num(
    replacing ? replacing.amount : isCollection ? (jo?.outstanding ?? "0.00") : (jo?.unbilled ?? "0.00")
  );
  // Editable, defaulting to the full cap: billing the whole remainder is the
  // common case, and a downpayment is the cashier typing a smaller number.
  const amount = replacing
    ? replacing.amount
    : (amountEdit ?? cap.toFixed(2));
  const due = num(amount);

  const availability = jo?.availability[kind];
  const blockedReason = replacing ? null : (availability?.reason ?? null);

  // Nothing left to bill AND nothing left to collect — the dialog becomes a
  // record of what was issued.
  const settled =
    !replacing &&
    jo !== undefined &&
    cent(num(jo.unbilled)) <= 0 &&
    cent(num(jo.outstanding)) <= 0;

  const vatableSales = isVat ? due / VAT_DIVISOR : due;
  const vatAmount = isVat ? due - vatableSales : 0;

  const clearForm = () => {
    setPickedKind(null);
    setAmountEdit(null);
    setLines([newLine()]);
    setNotes("");
    setIssueDocument(true);
    setReplacing(null);
    setReplaceReason("");
    setReplaceOnHand(false);
  };

  const reset = () => {
    clearForm();
    onClose();
  };

  /**
   * Reissue a spoiled receipt: same type, same amount, corrected details. The
   * void and the new receipt go to the server together, so a REPLACED receipt
   * can never be left pointing at nothing.
   */
  const startReplace = (row: ReceiptRowDto) => {
    setReplacing(row);
    setReplaceReason("");
    setReplaceOnHand(false);
    setPickedKind(row.kind);
    setAmountEdit(null);
    setLines([newLine()]);
  };

  // ——— what the customer handed over ———
  const received = lines.reduce((t, l) => t + num(l.amount), 0);
  const cashIn = lines
    .filter((l) => l.method === PaymentMethod.CASH)
    .reduce((t, l) => t + num(l.amount), 0);
  const change = Math.max(received - due, 0);
  const shortfall = Math.max(due - received, 0);
  // Only cash comes back over the counter — an over-sent transfer is a refund,
  // which is a different document entirely.
  const overNonCash = cent(change) > cent(cashIn);

  const patchLine = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () =>
    setLines((ls) => [
      ...ls,
      // Offer a different method than the last — a split is by definition paid
      // two ways, so repeating cash is rarely what's meant.
      newLine(
        ls.length && ls[ls.length - 1].method === PaymentMethod.CASH
          ? PaymentMethod.GCASH
          : PaymentMethod.CASH
      ),
    ]);
  const removeLine = (key: string) =>
    setLines((ls) => ls.filter((l) => l.key !== key));

  /** A Charge Invoice starts with nothing received — that is what credit is. */
  const pickKind = (k: ReceiptKind) => {
    setPickedKind(k);
    // The cap changes with the kind (unbilled vs outstanding), so a typed
    // amount from the previous choice would be measured against the wrong one.
    setAmountEdit(null);
    if (k === RECEIPT_KIND.SI_CHARGE) setLines([]);
    else if (lines.length === 0) setLines([newLine()]);
  };

  const nextNumber = jo?.nextNumbers[kind] ?? null;
  // A collection with no printed receipt needs no booklet number at all.
  const needsNumber = !isCollection || issueDocument;

  // A slip that does not cover the whole job is almost always a downpayment,
  // so it is ticked by default — but the cashier decides, because a customer
  // paying the last ₱10,000 of a ₱20,000 job is also paying part of it, and
  // only the person at the counter knows that is the end of it.
  const dpSuggested =
    isJoReceipt && jo !== undefined
      ? cent(due) > 0 && cent(due) < cent(num(jo.joTotal))
      : false;
  const isDownpayment = isJoReceipt && (dpOverride ?? dpSuggested);

  const problem = (): string | null => {
    if (blockedReason) return blockedReason;
    if (cent(due) <= 0) {
      return isCollection
        ? "There is nothing outstanding to collect on this job order."
        : "There is nothing left to invoice on this job order.";
    }
    if (cent(due) > cent(cap)) {
      return isCollection
        ? `Collecting ${peso(due)} but only ${peso(cap)} is outstanding.`
        : `Billing ${peso(due)} but only ${peso(cap)} is left to invoice.`;
    }
    if (lines.some((l) => cent(num(l.amount)) <= 0))
      return "Every payment line needs an amount greater than zero.";
    if (isCharge && received > 0)
      return `A ${RECEIPT_KIND_LABEL.SI_CHARGE} records a sale on credit — nothing is received against it. Issue a ${RECEIPT_KIND_LABEL.SI_VAT} or ${RECEIPT_KIND_LABEL.SI_NON_VAT} for what was actually paid.`;
    // Only a Charge Invoice may leave a balance open (docs/sales.txt §3.1.3).
    // Anything else short-paid is the wrong document, not a partial one.
    if (!isCharge && cent(shortfall) > 0)
      return `${peso(received)} received against a ${peso(due)} ${RECEIPT_KIND_LABEL[kind]}. Issue it for ${peso(received)} instead, or put the balance on credit with a ${RECEIPT_KIND_LABEL.SI_CHARGE}.`;
    if (overNonCash)
      return `Only cash can be over-tendered — ${peso(change)} is above the amount due but only ${peso(cashIn)} came in as cash.`;
    if (needsNumber && !nextNumber)
      return `No active booklet for ${RECEIPT_KIND_LABEL[kind]}. Register and approve one under Sales Audit Maintenance.`;
    if (replacing && replaceReason.trim().length < 3)
      return "Write the reason for the replacement.";
    if (replacing && !replaceOnHand)
      return `Confirm that ${replacing.documentNo} is on hand before reissuing it.`;
    return null;
  };

  const submit = () => {
    if (!jobOrderId) return;
    const err = problem();
    if (err) {
      toast.error(err);
      return;
    }
    const payments = lines.map((l) => ({
      method: l.method,
      amount: l.amount,
      reference: l.reference.trim() || undefined,
    }));
    const payload = {
      jobOrderId,
      kind,
      amount,
      cashTendered: "",
      payments,
      // Header summary — the service recomputes the dominant line itself; this
      // only keeps single-payment callers on the old shape.
      method: payments[0]?.method ?? PaymentMethod.CASH,
      methodDetail: payments[0]?.reference,
      notes: notes.trim() || undefined,
      // Only meaningful on a collection; harmless elsewhere. Allocations are
      // left to the server, which applies oldest-invoice-first.
      issueDocument: isCollection ? issueDocument : true,
      // Only a JO slip can carry it; the service ignores it on anything else.
      isDownpayment,
    };

    const describe = (balance: string, changeGiven: string) =>
      cent(num(balance)) > 0
        ? `${peso(num(balance))} left on credit (A/R).`
        : cent(num(changeGiven)) > 0
          ? `Change due: ${peso(num(changeGiven))}`
          : undefined;

    if (replacing) {
      replace.mutate(
        {
          receiptId: replacing.id,
          kind: replacing.kind,
          reason: replaceReason,
          replacement: payload,
        },
        {
          onSuccess: (r) => {
            toast.success(`${r.replacedDocumentNo} replaced by ${r.documentNo}.`, {
              description: `${r.replacedDocumentNo} stays in the booklet, marked replaced.`,
            });
            reset();
          },
          onError: (e: Error) => toast.error(e.message),
        }
      );
      return;
    }

    receive.mutate(payload, {
      onSuccess: (r) => {
        toast.success(
          r.documentNo
            ? `${RECEIPT_KIND_LABEL[kind]} ${r.documentNo} issued.`
            : `${peso(num(r.amountPaid))} recorded — no Collection Receipt printed.`,
          { description: describe(r.balanceDue, r.changeGiven) }
        );
        reset();
      },
      onError: (e: Error) => toast.error(e.message),
    });
  };

  const busy = receive.isPending || replace.isPending;

  return (
    <Dialog open={jobOrderId !== null} onOpenChange={(o) => !o && reset()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ReceiptTextIcon className="size-5" /> Receive Payment
          </DialogTitle>
          <DialogDescription>
            {jo ? `${jo.joNumber} · ${jo.customer.name}` : "Loading job order…"}
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
            <CustomerCard jo={jo} />

            {/* ——— what has already been issued against this JO ——— */}
            {jo.issued.length > 0 && (
              <IssuedReceipts
                rows={jo.issued}
                settled={settled}
                canVoid={canVoid}
                busy={replacing !== null}
                onVoid={setVoiding}
                onReplace={startReplace}
              />
            )}

            {/* ——— reissue mode ——— */}
            {replacing && (
              <div className="grid gap-3 rounded-md border border-amber-500/40 bg-amber-50 p-3 text-sm dark:bg-amber-500/10">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-amber-900 dark:text-amber-200">
                    Replacing {replacing.documentNo} · {replacing.kindLabel} ·{" "}
                    {peso(num(replacing.amount))}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setReplacing(null);
                      setReplaceReason("");
                      setReplaceOnHand(false);
                      setPickedKind(null);
                    }}
                  >
                    Cancel replacement
                  </Button>
                </div>
                <p className="text-xs text-amber-900/80 dark:text-amber-200/80">
                  Issuing below marks {replacing.documentNo} REPLACED and writes
                  the two serial numbers on each other. Both happen together —
                  neither can be left half-done.
                </p>
                <div className="grid gap-1.5">
                  <Label htmlFor="rp-replace-reason">
                    Reason <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    id="rp-replace-reason"
                    value={replaceReason}
                    onChange={(e) => setReplaceReason(e.target.value)}
                    rows={2}
                    placeholder="e.g. wrong amount encoded"
                  />
                </div>
                {/* §5.1 step 4: all copies stay bound in the booklet. If the
                    paper is not in front of them, they cannot reissue it. */}
                <OnHandCheck
                  id="rp-replace-onhand"
                  checked={replaceOnHand}
                  onChange={setReplaceOnHand}
                  documentNo={replacing.documentNo ?? ""}
                />
              </div>
            )}

            {settled ? (
              /* Nothing left to bill or collect: no receipt type, no amount,
                 no payment — showing them would only invite a double-issue. */
              <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
                This job order is invoiced in full and paid in full. To correct
                a receipt, use <strong>Replace</strong>; to undo one, use{" "}
                <strong>Cancel</strong> — either reopens the balance and brings
                this form back.
              </p>
            ) : (
              <>
                {/* ——— receipt kind ——— */}
                <div className="grid gap-2">
                  <Label>Receipt type</Label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {KIND_ORDER.map((k) => (
                      <KindTile
                        key={k}
                        kind={k}
                        active={kind === k}
                        recommended={!replacing && jo.recommended === k}
                        nextNumber={jo.nextNumbers[k]}
                        availability={jo.availability[k]}
                        lockedTo={replacing?.kind ?? null}
                        onPick={() => pickKind(k)}
                      />
                    ))}
                  </div>
                  {blockedReason && (
                    <p className="text-sm text-destructive">{blockedReason}</p>
                  )}
                </div>

                {/* ——— the amount ——— */}
                <div className="grid gap-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <Label htmlFor="rp-amount" className="text-base">
                      {isCollection ? "Amount to collect" : "Amount to invoice"}
                    </Label>
                    {replacing ? (
                      <span className="font-mono text-2xl font-semibold tabular-nums">
                        {peso(due)}
                      </span>
                    ) : (
                      <Input
                        id="rp-amount"
                        inputMode="decimal"
                        value={amount}
                        onChange={(e) =>
                          setAmountEdit(sanitizeDecimal(e.target.value))
                        }
                        className="h-11 max-w-44 text-right font-mono text-xl font-semibold tabular-nums"
                      />
                    )}
                  </div>

                  {replacing ? (
                    <p className="text-xs text-muted-foreground">
                      The amount of {replacing.documentNo}, the receipt being
                      reissued.
                    </p>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground">
                        {isCollection
                          ? `${peso(cap)} outstanding on this job order.`
                          : `${peso(cap)} of this job order is not yet invoiced. Bill less for a downpayment — the rest stays invoiceable.`}
                      </p>
                      {cent(due) !== cent(cap) && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setAmountEdit(cap.toFixed(2))}
                        >
                          Use {peso(cap)}
                        </Button>
                      )}
                    </div>
                  )}

                  {isVat && (
                    <div className="grid gap-1 border-t pt-2 text-sm">
                      <div className="mb-0.5 flex items-center gap-2">
                        <ColorBadge tone="blue" label="VAT 12%" />
                      </div>
                      <Row label="Vatable sales (÷ 1.12)" value={peso(vatableSales)} />
                      <Row label="VAT (× 12%)" value={peso(vatAmount)} />
                    </div>
                  )}

                  {isCharge && (
                    <p className="border-t pt-2 text-xs text-muted-foreground">
                      Nothing is received now — the whole {peso(due)} becomes
                      Accounts Receivable, settled later by a Collection
                      Receipt.
                      {jo.credit.enabled && jo.credit.termDays !== null && (
                        <> Due in {jo.credit.termDays} days.</>
                      )}
                    </p>
                  )}
                </div>

                {/* ——— which invoices a collection pays down ——— */}
                {isCollection && jo.openInvoices.length > 0 && (
                  <OpenInvoices invoices={jo.openInvoices} collecting={due} />
                )}

                {/* ——— the optional Collection Receipt ——— */}
                {isCollection && (
                  <label
                    htmlFor="rp-issue-doc"
                    className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm"
                  >
                    <input
                      id="rp-issue-doc"
                      type="checkbox"
                      checked={issueDocument}
                      onChange={(e) => setIssueDocument(e.target.checked)}
                      className="mt-0.5 size-4 shrink-0 accent-primary"
                    />
                    <span className="grid gap-0.5">
                      <span className="font-medium">
                        Print a Collection Receipt
                        {issueDocument && nextNumber && (
                          <span className="ml-2 font-mono text-xs text-muted-foreground">
                            {nextNumber}
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {issueDocument
                          ? "Consumes the next CR number from the active booklet."
                          : "The payment is still recorded and the balance still closes — no booklet number is used."}
                      </span>
                    </span>
                  </label>
                )}

                {/* ——— downpayment, or the whole sale? ——— */}
                {isJoReceipt && (
                  <label
                    htmlFor="rp-is-dp"
                    className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm"
                  >
                    <input
                      id="rp-is-dp"
                      type="checkbox"
                      checked={isDownpayment}
                      onChange={(e) => setDpOverride(e.target.checked)}
                      className="mt-0.5 size-4 shrink-0 accent-primary"
                    />
                    <span className="grid gap-0.5">
                      <span className="font-medium">
                        This is a downpayment
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {isDownpayment
                          ? "Money held against work not yet billed — recorded on today's log, but not counted as a sale. More downpayments may follow on this job."
                          : "The customer paid and is done. This slip is the sale, and its money counts in today's gross sales."}
                      </span>
                    </span>
                  </label>
                )}

                {/* ——— what the customer handed over ——— */}
                {!isCharge && (
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label>
                        {lines.length > 1 ? "Payment lines" : "Payment"}
                      </Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={addLine}
                      >
                        <PlusIcon />
                        {lines.length === 0
                          ? "Record a payment"
                          : lines.length === 1
                            ? "Split payment"
                            : "Add line"}
                      </Button>
                    </div>

                    {lines.length === 0 ? (
                      <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                        Nothing recorded yet — add how the {peso(due)} was paid.
                      </p>
                    ) : (
                      <div className="grid gap-2">
                        {lines.map((l, i) => (
                          <div key={l.key} className="flex items-center gap-2">
                            <Select
                              value={l.method}
                              onValueChange={(v) =>
                                patchLine(l.key, { method: v as PaymentMethod })
                              }
                            >
                              {/* h-9 w-full — the trigger defaults to w-fit/h-8
                                  and would otherwise sit shorter and narrower
                                  than the Inputs beside it. */}
                              <SelectTrigger
                                aria-label={`Payment method, line ${i + 1}`}
                                className="h-9 w-full max-w-44 flex-1"
                              >
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

                            <Input
                              inputMode="decimal"
                              aria-label={`Amount received, line ${i + 1}`}
                              value={l.amount}
                              onChange={(e) =>
                                patchLine(l.key, {
                                  amount: sanitizeDecimal(e.target.value),
                                })
                              }
                              // The number they'll usually type, not a dead 0.00.
                              placeholder={amountPlaceholder(lines, l, due)}
                              className="flex-1 text-right font-mono tabular-nums"
                            />

                            <Input
                              aria-label={`Reference, line ${i + 1}`}
                              value={l.reference}
                              onChange={(e) =>
                                patchLine(l.key, { reference: e.target.value })
                              }
                              placeholder={
                                l.method === PaymentMethod.CASH
                                  ? "—"
                                  : "Cheque no. / ref"
                              }
                              disabled={l.method === PaymentMethod.CASH}
                              className="flex-1"
                            />

                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`Remove line ${i + 1}`}
                              onClick={() => removeLine(l.key)}
                              disabled={lines.length === 1}
                            >
                              <XIcon />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}

                    <Settlement
                      kind={kind}
                      received={received}
                      due={due}
                      change={change}
                      shortfall={shortfall}
                      overNonCash={overNonCash}
                      cashIn={cashIn}
                    />
                  </div>
                )}

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
              </>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={reset}>
            {settled ? "Close" : "Cancel"}
          </Button>
          {!settled && (
            <Button onClick={submit} disabled={busy || !jo || !!problem()}>
              {busy
                ? "Issuing…"
                : replacing
                  ? `Replace with ${nextNumber ?? "receipt"}`
                  : !needsNumber
                    ? `Record ${peso(due)}`
                    : nextNumber
                      ? `Issue ${nextNumber}`
                      : "Issue receipt"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>

      <VoidReceiptDialog
        receipt={voiding}
        onClose={() => setVoiding(null)}
        // The balance has reopened — drop anything typed against the old one.
        onVoided={clearForm}
      />
    </Dialog>
  );
}

/** Who it's billed to: already on the JO, never retyped. */
function CustomerCard({ jo }: { jo: ReceivePaymentOptionsDto }) {
  const overLimit =
    jo.credit.enabled &&
    jo.credit.available !== null &&
    cent(num(jo.credit.available)) < 0;

  return (
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
          <strong className="tabular-nums">{peso(num(jo.totalReceived))}</strong>
        </span>
        {/* The two numbers the whole dialog turns on — shown apart, because
            they answer different questions. */}
        <span>
          To invoice{" "}
          <strong className="tabular-nums text-foreground">
            {peso(num(jo.unbilled))}
          </strong>
        </span>
        <span>
          Outstanding{" "}
          <strong className="tabular-nums text-foreground">
            {peso(num(jo.outstanding))}
          </strong>
        </span>
      </div>

      {jo.credit.enabled && (jo.credit.limit || jo.credit.termDays !== null) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
          {jo.credit.termDays !== null && (
            <span>Terms: net {jo.credit.termDays} days</span>
          )}
          {jo.credit.limit && (
            <span>
              Credit limit {peso(num(jo.credit.limit))} · owes{" "}
              {peso(num(jo.credit.customerOutstanding))} across all jobs
            </span>
          )}
          {overLimit && <ColorBadge tone="red" label="Over limit" />}
        </div>
      )}
    </div>
  );
}

/** One receipt-type tile: what it is, its next serial, and why it's off. */
function KindTile({
  kind,
  active,
  recommended,
  nextNumber,
  availability,
  lockedTo,
  onPick,
}: {
  kind: ReceiptKind;
  active: boolean;
  recommended: boolean;
  nextNumber: string | null;
  availability: { enabled: boolean; reason: string | null };
  /** While replacing, only the superseded receipt's own kind is selectable. */
  lockedTo: ReceiptKind | null;
  onPick: () => void;
}) {
  const lockedOut = lockedTo !== null && kind !== lockedTo;
  const disabled = lockedOut || !availability.enabled;

  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      disabled={disabled}
      className={cn(
        "flex flex-col items-start gap-0.5 rounded-md border p-3 text-left transition-colors",
        active
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : !disabled && "hover:bg-muted/50",
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
        {RECEIPT_KIND_LABEL[kind]}
        {recommended && <ColorBadge tone="green" label="Suggested" />}
      </span>
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        {nextNumber ?? "no active booklet"}
      </span>
      {/* When a tile is off, say why right on it — a greyed box with no
          explanation is the thing that sends people to ask someone. */}
      <span className="text-xs text-muted-foreground">
        {disabled && !lockedOut
          ? availability.reason
          : RECEIPT_KIND_HINT[kind]}
      </span>
    </button>
  );
}

/** The invoices a collection will pay down, oldest first. */
function OpenInvoices({
  invoices,
  collecting,
}: {
  invoices: OpenInvoiceDto[];
  collecting: number;
}) {
  // Mirrors the server's oldest-first allocation so the cashier can see where
  // the money is about to land before they commit it. Resolved in one pass
  // BEFORE the render rather than accumulated inside it — a running total
  // mutated during render is read at different values on different passes.
  const { applied: appliedPer, unapplied } = invoices.reduce<{
    applied: number[];
    unapplied: number;
  }>(
    (acc, inv) => {
      const take = Math.max(
        Math.min(acc.unapplied, cent(num(inv.openBalance))),
        0
      );
      acc.applied.push(take);
      acc.unapplied -= take;
      return acc;
    },
    { applied: [], unapplied: cent(collecting) }
  );

  return (
    <div className="grid gap-2 rounded-md border p-3">
      <span className="text-sm font-medium">Applied to</span>
      <div className="grid gap-1.5">
        {invoices.map((inv, i) => {
          const applied = appliedPer[i];
          return (
            <div
              key={inv.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-1.5 text-sm first:border-t-0 first:pt-0"
            >
              <span className="font-mono tabular-nums">{inv.documentNo}</span>
              <span className="text-xs text-muted-foreground">
                {inv.kindLabel}
              </span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {peso(num(inv.openBalance))} open
              </span>
              {inv.daysOverdue !== null && inv.daysOverdue > 0 && (
                <ColorBadge tone="red" label={`${inv.daysOverdue}d overdue`} />
              )}
              {applied > 0 && (
                <span className="ml-auto font-mono font-medium tabular-nums text-emerald-700 dark:text-emerald-300">
                  − {peso(applied / 100)}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {unapplied > 0 && (
        <p className="text-xs text-destructive">
          {peso(unapplied / 100)} has no open invoice to apply to.
        </p>
      )}
    </div>
  );
}

/**
 * What a blank line should suggest: the part of the amount still uncovered.
 * On a single line that is the whole amount, which is what gets typed nine
 * times out of ten.
 */
function amountPlaceholder(lines: Line[], self: Line, due: number): string {
  const others = lines
    .filter((l) => l.key !== self.key)
    .reduce((t, l) => t + num(l.amount), 0);
  const remaining = due - others;
  return remaining > 0 ? remaining.toFixed(2) : "0.00";
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}

/**
 * What falls out of what was handed over: change back over the counter, or a
 * shortfall — which on anything but a Charge Invoice is an ERROR, not a
 * receivable. Only a Charge Invoice may open one (docs/sales.txt §3.1.3).
 */
function Settlement({
  kind,
  received,
  due,
  change,
  shortfall,
  overNonCash,
  cashIn,
}: {
  kind: ReceiptKind;
  received: number;
  due: number;
  change: number;
  shortfall: number;
  overNonCash: boolean;
  cashIn: number;
}) {
  return (
    <div className="grid gap-1.5 rounded-md border bg-muted/40 px-3 py-2 text-sm">
      <Row label="Received" value={peso(received)} />

      {change > 0 && (
        <div className="flex items-center justify-between font-semibold text-emerald-700 dark:text-emerald-300">
          <span>Change</span>
          <span className="font-mono tabular-nums">{peso(change)}</span>
        </div>
      )}

      {shortfall > 0 && (
        <div className="grid gap-0.5 border-t pt-1.5">
          <div className="flex items-center justify-between font-semibold text-destructive">
            <span>Short by</span>
            <span className="font-mono tabular-nums">{peso(shortfall)}</span>
          </div>
          <span className="text-xs text-muted-foreground">
            A {RECEIPT_KIND_LABEL[kind]} is settled in full when it is issued.
            Invoice {peso(received)} instead, or put the rest on credit with a{" "}
            {RECEIPT_KIND_LABEL.SI_CHARGE}.
          </span>
        </div>
      )}

      {change === 0 && shortfall === 0 && received > 0 && (
        <span className="text-xs text-emerald-700 dark:text-emerald-300">
          ✓ Settled in full — no change, no balance.
        </span>
      )}

      {received === 0 && due > 0 && (
        <span className="text-xs text-muted-foreground">
          Add how the {peso(due)} was paid.
        </span>
      )}

      {overNonCash && (
        <p className="border-t pt-1.5 text-xs text-destructive">
          Only cash can be over-tendered. {peso(change)} is above the amount due
          but only {peso(cashIn)} came in as cash.
        </p>
      )}
    </div>
  );
}

/**
 * Receipts already raised against this Job Order.
 *
 * Cancelled ones are listed too, struck through — docs/sales.txt §4 rule 3:
 * every number in the booklet must be accounted for, so a voided receipt is
 * shown, never hidden.
 */
function IssuedReceipts({
  rows,
  settled,
  canVoid,
  busy,
  onVoid,
  onReplace,
}: {
  rows: ReceiptRowDto[];
  settled: boolean;
  canVoid: boolean;
  busy: boolean;
  onVoid: (row: ReceiptRowDto) => void;
  onReplace: (row: ReceiptRowDto) => void;
}) {
  const live = rows.filter((r) => r.voidType === null);
  const owed = live.reduce((t, r) => t + num(r.balanceDue), 0);

  return (
    <div
      className={cn(
        "grid gap-2 rounded-md border p-3",
        settled &&
          "border-emerald-500/40 bg-emerald-50/60 dark:bg-emerald-500/10"
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">
          {settled ? "Fully invoiced and paid" : "Already issued on this job order"}
        </span>
        <ColorBadge
          tone={settled ? "green" : "blue"}
          label={`${live.length} active receipt${live.length === 1 ? "" : "s"}`}
        />
        {owed > 0 && (
          <ColorBadge tone="amber" label={`${peso(owed)} on credit`} />
        )}
      </div>

      <div className="grid gap-1.5">
        {rows.map((r) => {
          const voidType = r.voidType;
          const struck = voidType ? "text-muted-foreground line-through" : "";
          return (
            <div
              key={r.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-1.5 text-sm first:border-t-0 first:pt-0"
            >
              <span className={cn("font-mono tabular-nums", struck)}>
                {r.documentNo ?? "Payment"}
              </span>
              <span className="text-muted-foreground">{r.kindLabel}</span>
              {!r.documentIssued && (
                <ColorBadge tone="gray" label="no receipt printed" />
              )}
              <span className={cn("font-mono tabular-nums", struck)}>
                {peso(num(r.amount))}
              </span>
              {!voidType && cent(num(r.balanceDue)) > 0 && (
                <ColorBadge
                  tone="amber"
                  label={`${peso(num(r.balanceDue))} unpaid`}
                />
              )}
              {!voidType &&
                cent(num(r.settledAmount)) > 0 &&
                cent(num(r.balanceDue)) === 0 && (
                  <ColorBadge tone="green" label="collected" />
                )}
              <span className="text-xs text-muted-foreground">
                {new Date(r.receivedAt).toLocaleDateString("en-PH", {
                  month: "short",
                  day: "numeric",
                })}{" "}
                · {r.createdByName}
              </span>

              {voidType ? (
                <span className="flex flex-wrap items-center gap-2">
                  <ColorBadge
                    tone="red"
                    label={VOID_TYPE_LABEL[voidType].toUpperCase()}
                  />
                  <span className="text-xs text-muted-foreground">
                    {r.replacedByDocumentNo
                      ? `→ ${r.replacedByDocumentNo}`
                      : r.voidReason}
                  </span>
                </span>
              ) : (
                canVoid && (
                  <span className="ml-auto flex gap-1">
                    {/* Nothing to supersede when no serial was ever issued —
                        that payment can only be cancelled and re-recorded. */}
                    {r.documentIssued && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => onReplace(r)}
                      >
                        <RefreshCwIcon /> Replace
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => onVoid(r)}
                    >
                      <BanIcon /> Cancel
                    </Button>
                  </span>
                )
              )}

              {r.replacesDocumentNo && (
                <span className="text-xs text-muted-foreground">
                  replaces {r.replacesDocumentNo}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {!canVoid && (
        <p className="text-xs text-muted-foreground">
          Cancelling a receipt needs a supervisor.
        </p>
      )}
    </div>
  );
}
