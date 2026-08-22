"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  BanIcon,
  ChevronRightIcon,
  PlusIcon,
  ReceiptTextIcon,
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
import { remainderFor, resolveTenders } from "../services/split-tender";
import { cn } from "@/lib/utils";
import { PaymentMethod } from "@/generated/prisma/enums";
import {
  RECEIPT_KIND,
  RECEIPT_KIND_HINT,
  RECEIPT_KIND_LABEL,
  VOID_MARK,
  type OpenInvoiceDto,
  type ReceiptKind,
  type ReceiptRowDto,
  type ReceivePaymentOptionsDto,
} from "../schemas/receipt";
import {
  usePaymentOptions,
  useReceivePayment,
} from "../hooks/use-sales-audit";
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
  const jo = options.data;

  const [voiding, setVoiding] = useState<ReceiptRowDto | null>(null);

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
    isCollection ? (jo?.outstanding ?? "0.00") : (jo?.unbilled ?? "0.00")
  );
  // The downpayment the quotation agreed, if this job came from one and
  // nothing has been billed against it yet. Once part of the job is billed the
  // suggestion is spent — the agreed downpayment is a one-time thing, and
  // re-offering it on the balance would quietly halve the invoice.
  const agreed =
    !isCollection && jo?.agreedDownpayment && cent(num(jo.unbilled)) === cent(num(jo.joTotal))
      ? jo.agreedDownpayment
      : null;

  // Editable, defaulting to the agreed downpayment when there is one and to
  // the full remainder otherwise — billing everything left is the common case,
  // and a part payment is the cashier typing a smaller number.
  const amount = amountEdit ?? agreed?.amount ?? cap.toFixed(2);
  const due = num(amount);

  const availability = jo?.availability[kind];
  const blockedReason = availability?.reason ?? null;

  // Nothing left to bill AND nothing left to collect — the dialog becomes a
  // record of what was issued.
  const settled =
    jo !== undefined &&
    cent(num(jo.unbilled)) <= 0 &&
    cent(num(jo.outstanding)) <= 0;

  const vatableSales = isVat ? due / VAT_DIVISOR : due;
  const vatAmount = isVat ? due - vatableSales : 0;

  const clearForm = () => {
    setPickedKind(null);
    setAmountEdit(null);
    setLines([newLine()]);
    setDpOverride(null);
    setNotes("");
    setIssueDocument(true);
  };

  const reset = () => {
    clearForm();
    onClose();
  };

  // ——— what the customer handed over ———
  //
  // One line FOLLOWS the amount being invoiced: it carries whatever the typed
  // lines leave uncovered, so a split adds up to the document by default. The
  // follower is simply the last line left blank — typing in a line claims it,
  // clearing it hands it back.
  //
  // A single blank line is the ordinary case, and it mirrors the amount the
  // way it always has. What changes is that splitting no longer breaks the
  // link: reduce the cash line and the other one takes up the difference.
  //
  // Utang stays reachable and stays deliberate. To leave a balance owing, the
  // cashier types a smaller figure into every line — a decision, rather than
  // a box somebody forgot to fill in.
  const {
    shown: shownLines,
    tenders,
    followerIndex,
  } = resolveTenders(lines, due, isCharge);
  const received = tenders.reduce((t, l) => t + num(l.amount), 0);
  const cashIn = tenders
    .filter((l) => l.method === PaymentMethod.CASH)
    .reduce((t, l) => t + num(l.amount), 0);
  const change = Math.max(received - due, 0);
  const shortfall = Math.max(due - received, 0);
  // Only cash comes back over the counter — an over-sent transfer is a refund,
  // which is a different document entirely.
  const overNonCash = cent(change) > cent(cashIn);

  const patchLine = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => {
    setLines((ls) => {
      // The line that was following freezes at what it is showing, and the new
      // one follows instead — otherwise adding a second method would silently
      // zero the first. The new line starts at 0.00 because the frozen one is
      // covering everything; reduce it and the difference lands here.
      const frozen = ls.map((l, i) =>
        i === followerIndex ? { ...l, amount: remainderFor(ls, i, due) } : l
      );
      return [
        ...frozen,
        // Offer a different method than the last — a split is by definition
        // paid two ways, so repeating cash is rarely what's meant.
        newLine(
          frozen.length &&
            frozen[frozen.length - 1].method === PaymentMethod.CASH
            ? PaymentMethod.GCASH
            : PaymentMethod.CASH
        ),
      ];
    });
  };
  const removeLine = (key: string) =>
    setLines((ls) => ls.filter((l) => l.key !== key));

  /** A Charge Invoice starts with nothing received — that is what credit is. */
  const pickKind = (k: ReceiptKind) => {
    setPickedKind(k);
    // The cap changes with the kind (unbilled vs outstanding), so a typed
    // amount from the previous choice would be measured against the wrong one.
    setAmountEdit(null);
    // A different receipt kind means a different amount, so the payment lines
    // start over and follow it rather than carrying the last kind's figures
    // across to a document they were never typed against.
    setLines(k === RECEIPT_KIND.SI_CHARGE ? [] : [newLine()]);
    setDpOverride(null);
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
  /** True while the amount still matches what the quotation agreed. */
  const onAgreedTerm =
    agreed !== null && cent(due) === cent(num(agreed.amount));
  // Short of the agreed downpayment. Said, not blocked — the shop can always
  // accept less than it quoted, and only the person at the counter knows
  // whether that was agreed. Silence would be the wrong call the other way:
  // the quotation says this is what the customer was told to bring.
  const belowAgreed =
    agreed !== null && cent(due) > 0 && cent(due) < cent(num(agreed.amount));
  // Only meaningful when the slip is settled in full: a slip left part-paid
  // has billed the WHOLE job and put the rest on utang, which is a receivable
  // rather than a deposit. The two are alternatives, never both at once.
  const onUtang = isJoReceipt && cent(shortfall) > 0;
  const isDownpayment = isJoReceipt && !onUtang && (dpOverride ?? dpSuggested);

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
    if (tenders.some((l) => cent(num(l.amount)) <= 0))
      return "Every payment line needs an amount greater than zero.";
    if (isCharge && received > 0)
      return `A ${RECEIPT_KIND_LABEL.SI_CHARGE} records a sale on credit — nothing is received against it. Issue a ${RECEIPT_KIND_LABEL.SI_VAT} or ${RECEIPT_KIND_LABEL.SI_NON_VAT} for what was actually paid.`;
    // A Charge Invoice and a JO slip may both leave a balance open — the
    // first by definition, the second because the shop sells on utang across
    // the counter. A short-paid Sales Invoice is the wrong document, not a
    // partial one.
    if (!isCharge && !isJoReceipt && cent(shortfall) > 0)
      return `${peso(received)} received against a ${peso(due)} ${RECEIPT_KIND_LABEL[kind]}. Issue it for ${peso(received)} instead, or put the balance on credit with a ${RECEIPT_KIND_LABEL.SI_CHARGE}.`;
    if (overNonCash)
      return `Only cash can be over-tendered — ${peso(change)} is above the amount due but only ${peso(cashIn)} came in as cash.`;
    if (needsNumber && !nextNumber)
      return `No active booklet for ${RECEIPT_KIND_LABEL[kind]}. Register and approve one under Sales Audit Maintenance.`;
    return null;
  };

  // Computed once and used for BOTH the disabled button and the sentence
  // above it. Working it out in the disabled prop alone is what left the
  // cashier with a dead button and no reason: the toast below can only fire
  // from a click, and a disabled button never gets one.
  const blocker = problem();

  const submit = () => {
    if (!jobOrderId) return;
    if (blocker) {
      toast.error(blocker);
      return;
    }
    const payments = tenders.map((l) => ({
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

  const busy = receive.isPending;

  return (
    <Dialog open={jobOrderId !== null} onOpenChange={(o) => !o && reset()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
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
                onVoid={setVoiding}
              />
            )}

            {settled ? (
              /* Nothing left to bill or collect: no receipt type, no amount,
                 no payment — showing them would only invite a double-issue. */
              <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
                This job order is invoiced in full and paid in full.{" "}
                <strong>Cancel</strong> a receipt to reopen the balance — this
                form comes back, and a corrected one can be issued in its
                place.
              </p>
            ) : (
              <>
                <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,4fr)_minmax(0,5fr)]">
                  {/* ─── left: which document ─── */}
                  <div className="grid content-start gap-5">
                    {/* ——— receipt kind ——— */}
                    <div className="grid gap-2">
                      <Label>Receipt type</Label>
                      {/* One per row in the narrow column — two would wrap the
                          reason text into an unreadable sliver. */}
                      <div className="grid gap-2">
                        {KIND_ORDER.map((k) => (
                          <KindTile
                            key={k}
                            kind={k}
                            active={kind === k}
                            recommended={jo.recommended === k}
                            nextNumber={jo.nextNumbers[k]}
                            availability={jo.availability[k]}
                            onPick={() => pickKind(k)}
                          />
                        ))}
                      </div>
                      {blockedReason && (
                        <p className="text-sm text-destructive">{blockedReason}</p>
                      )}
                    </div>
                  </div>

                  {/* ─── right: the money ─── */}
                  <div className="grid content-start gap-5">
                    {/* ——— the amount ——— */}
                    <div className="grid gap-2 rounded-md border p-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <Label htmlFor="rp-amount" className="text-base">
                          {isCollection ? "Amount to collect" : "Amount to invoice"}
                        </Label>
                        <Input
                          id="rp-amount"
                          inputMode="decimal"
                          value={amount}
                          onChange={(e) =>
                            setAmountEdit(sanitizeDecimal(e.target.value))
                          }
                          className="h-11 max-w-44 text-right font-mono text-xl font-semibold tabular-nums"
                        />
                      </div>

                      {onAgreedTerm && agreed && (
                        <p className="text-xs font-medium text-primary">
                          Pre-filled from the quotation
                          {agreed.label ? ` — ${agreed.label}` : ""}. This is the
                          downpayment the customer agreed to bring; change it if
                          they are paying something else.
                        </p>
                      )}
                      {belowAgreed && agreed && (
                        <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                          The quotation agreed {peso(num(agreed.amount))}
                          {agreed.label ? ` (${agreed.label})` : ""} — this is{" "}
                          {peso(num(agreed.amount) - due)} less. Fine if that is
                          what was arranged.
                        </p>
                      )}

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

                    {/* ——— downpayment, or the whole job on utang? ——— */}
                    {isJoReceipt && (
                      <label
                        htmlFor="rp-is-dp"
                        className={cn(
                          "flex items-start gap-3 rounded-md border p-3 text-sm",
                          onUtang ? "cursor-not-allowed opacity-70" : "cursor-pointer"
                        )}
                      >
                        <input
                          id="rp-is-dp"
                          type="checkbox"
                          checked={isDownpayment}
                          disabled={onUtang}
                          onChange={(e) => setDpOverride(e.target.checked)}
                          className="mt-0.5 size-4 shrink-0 accent-primary"
                        />
                        <span className="grid gap-0.5">
                          <span className="font-medium">
                            This is a downpayment
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {onUtang
                              ? `Not this one — you are billing the whole ${peso(due)} and leaving ${peso(shortfall)} on utang, so the balance is a receivable rather than a deposit. To take a downpayment instead, bill ${peso(received)} and the rest stays invoiceable.`
                              : isDownpayment
                                ? `Books ${peso(due)} of sales today and leaves ${peso(num(jo?.joTotal ?? "0") - due)} of the job still to invoice. More payments may follow on this job.`
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
                                  // The following line shows what it is
                                  // absorbing, so the figures on screen are
                                  // the figures that will be recorded.
                                  value={shownLines[i]?.amount ?? l.amount}
                                  onChange={(e) =>
                                    patchLine(l.key, {
                                      amount: sanitizeDecimal(e.target.value),
                                    })
                                  }
                                  // Only reachable on a line the cashier has
                                  // emptied while another blank line is
                                  // already following — the hint is what is
                                  // still uncovered either way.
                                  placeholder={remainderFor(lines, i, due)}
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
                          opensCredit={isJoReceipt || isCharge}
                          overNonCash={overNonCash}
                          cashIn={cashIn}
                          joTotal={num(jo?.joTotal ?? "0")}
                          paidBefore={num(jo?.totalReceived ?? "0")}
                        />
                      </div>
                    )}
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
              </>
            )}
          </div>
        ) : null}

        {/* Why the button is dead. The same check that disables it already
            produces a sentence saying what to do about it — and until now
            nothing rendered that sentence anywhere. Held back until the job
            order has loaded, so an empty dialog does not accuse the cashier
            of having nothing left to invoice. */}
        {jo && !settled && blocker && (
          <p
            role="status"
            className="rounded-md border border-amber-500/40 bg-amber-50/70 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
          >
            {blocker}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={reset}>
            {settled ? "Close" : "Cancel"}
          </Button>
          {!settled && (
            <Button onClick={submit} disabled={busy || !jo || !!blocker}>
              {busy
                ? "Issuing…"
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

      <div className="mt-1 flex flex-wrap items-baseline gap-x-5 gap-y-1 border-t pt-2 text-xs">
        <span>
          Job total{" "}
          <strong className="tabular-nums">{peso(num(jo.joTotal))}</strong>
        </span>
        <span>
          Paid so far{" "}
          <strong className="tabular-nums">{peso(num(jo.totalReceived))}</strong>
        </span>
        {/* The headline: what the customer still owes on this job, whether it
            has been billed yet or not. Everything else here explains it. */}
        {(() => {
          const left = Math.max(num(jo.joTotal) - num(jo.totalReceived), 0);
          return (
            <span
              className={
                left > 0
                  ? "font-medium text-amber-700 dark:text-amber-400"
                  : "font-medium text-emerald-700 dark:text-emerald-300"
              }
            >
              {left > 0 ? "Still to pay " : "Fully paid "}
              <strong className="tabular-nums">{peso(left)}</strong>
            </span>
          );
        })()}
        {/* Still-to-pay is exactly left-to-bill PLUS on-the-ledger, so on a
            job where nothing has been billed on credit the breakdown just
            repeats the headline and a zero. Show it only once the two halves
            actually differ — which is precisely when the cashier has to choose
            between invoicing and collecting. */}
        {cent(num(jo.outstanding)) > 0 && (
          <>
            <span className="text-muted-foreground">
              left to bill{" "}
              <strong className="tabular-nums text-foreground">
                {peso(num(jo.unbilled))}
              </strong>
            </span>
            <span className="text-muted-foreground">
              on the A/R ledger{" "}
              <strong className="tabular-nums text-foreground">
                {peso(num(jo.outstanding))}
              </strong>
            </span>
          </>
        )}
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
  onPick,
}: {
  kind: ReceiptKind;
  active: boolean;
  recommended: boolean;
  nextNumber: string | null;
  availability: { enabled: boolean; reason: string | null };
  onPick: () => void;
}) {
  const disabled = !availability.enabled;

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
        {disabled ? availability.reason : RECEIPT_KIND_HINT[kind]}
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


const METHOD_LABEL: Record<PaymentMethod, string> = Object.fromEntries(
  METHODS.map((m) => [m.value, m.label])
) as Record<PaymentMethod, string>;

/**
 * What one already-issued receipt actually took in, and how.
 *
 * The TENDER LINES are the truth about how the money arrived — the header's
 * `method` is only the largest of them, which is all the day log and the
 * printables need but not enough to answer "what did they pay with". A split
 * shows every line with its own reference, because two cheques are two cheque
 * numbers.
 *
 * The money is shown in the three parts that R3 keeps separate: what the
 * printed receipt says was handed over at issue (`amountPaid`, frozen),
 * what has been collected against it since (`settledAmount`), and what is
 * therefore still owed. Adding them into one "paid" figure is what makes a
 * receivable look settled when it is not.
 */
function ReceiptDetail({ row }: { row: ReceiptRowDto }) {
  const paid = num(row.amountPaid);
  const settled = num(row.settledAmount);
  const owed = num(row.balanceDue);
  const change = num(row.changeGiven);
  const tendered = row.cashTendered === null ? null : num(row.cashTendered);
  const cancelled = row.voidType !== null;

  return (
    <div className="mt-2 grid gap-4 rounded-md bg-muted/50 p-3 text-sm sm:grid-cols-2">
      <div className="grid content-start gap-1.5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          How it was paid
        </p>

        {row.payments.length > 0 ? (
          row.payments.map((t, i) => (
            <div
              key={`${t.method}-${i}`}
              className="flex items-baseline justify-between gap-3"
            >
              <span>
                {METHOD_LABEL[t.method] ?? t.method}
                {t.reference && (
                  <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                    {t.reference}
                  </span>
                )}
              </span>
              <span className="font-mono tabular-nums">
                {peso(num(t.amount))}
              </span>
            </div>
          ))
        ) : cent(paid) > 0 ? (
          // Written before split tender existed: the header method is all the
          // detail there is, and saying so beats showing an empty panel.
          <div className="flex items-baseline justify-between gap-3">
            <span>
              {row.method ? METHOD_LABEL[row.method] : "Method not recorded"}
              {row.methodDetail && (
                <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                  {row.methodDetail}
                </span>
              )}
            </span>
            <span className="font-mono tabular-nums">{peso(paid)}</span>
          </div>
        ) : (
          <p className="text-muted-foreground">
            Nothing was received — this receipt records a sale on credit.
          </p>
        )}

        {tendered !== null && cent(change) > 0 && (
          <div className="mt-1 grid gap-0.5 border-t pt-1.5 text-xs">
            <Row label="Cash handed over" value={peso(tendered)} />
            <Row label="Change given" value={peso(change)} />
          </div>
        )}
      </div>

      <div className="grid content-start gap-1.5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          On this receipt
        </p>
        <Row label="Amount" value={peso(num(row.amount))} />
        {cent(num(row.vatAmount)) > 0 && (
          <>
            <Row label="VAT-able" value={peso(num(row.vatableSales))} />
            <Row label="Output VAT" value={peso(num(row.vatAmount))} />
          </>
        )}
        <Row label="Paid at issue" value={peso(paid)} />
        {cent(settled) > 0 && (
          <Row label="Collected since" value={peso(settled)} />
        )}

        {cancelled ? (
          <p className="border-t pt-1.5 text-xs text-muted-foreground">
            Cancelled{row.voidedByName ? ` by ${row.voidedByName}` : ""} — it
            owes nothing and counts as no sale. The serial stays in the booklet.
          </p>
        ) : cent(owed) > 0 ? (
          <div className="border-t pt-1.5 font-medium text-amber-700 dark:text-amber-400">
            <Row label="Still owed" value={peso(owed)} />
          </div>
        ) : (
          <p className="border-t pt-1.5 text-xs text-muted-foreground">
            Settled in full.
          </p>
        )}

        {row.dueDate && !cancelled && cent(owed) > 0 && (
          <p className="text-xs text-muted-foreground">
            Due {new Date(row.dueDate).toLocaleDateString("en-PH", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </p>
        )}
      </div>
    </div>
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

/**
 * What falls out of what was handed over — and then, separately, where the
 * WHOLE JOB stands once this receipt is issued.
 *
 * The two were conflated, and it read badly: a ₱2,360.40 downpayment paid in
 * full says "settled in full" about itself while ₱2,360.40 of the job is still
 * unpaid. A cashier reading that has every reason to think the job is done.
 * The document's settlement and the job's balance are different questions and
 * now answer separately.
 */
function Settlement({
  kind,
  received,
  due,
  change,
  shortfall,
  opensCredit,
  overNonCash,
  cashIn,
  joTotal,
  paidBefore,
}: {
  kind: ReceiptKind;
  received: number;
  due: number;
  change: number;
  shortfall: number;
  /** True when this kind may leave a balance owing — JO slip or Charge. */
  opensCredit: boolean;
  overNonCash: boolean;
  cashIn: number;
  /** The job's whole value. */
  joTotal: number;
  /** Money already in against this job, before this receipt. */
  paidBefore: number;
}) {
  // Change handed back is not money the shop kept, so it never counts toward
  // the job — otherwise over-tendering ₱1,000 on a ₱700 job would read as
  // ₱300 of the balance paid off.
  const keptNow = Math.max(received - change, 0);
  const paidAfter = paidBefore + keptNow;
  const stillToPay = Math.max(joTotal - paidAfter, 0);
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
          <div
            className={cn(
              "flex items-center justify-between font-semibold",
              opensCredit ? "text-amber-700 dark:text-amber-400" : "text-destructive"
            )}
          >
            <span>{opensCredit ? "On utang" : "Short by"}</span>
            <span className="font-mono tabular-nums">{peso(shortfall)}</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {opensCredit
              ? `Stays owing on this job. It lands on the A/R ledger, ages from today, and is collected later.`
              : `A ${RECEIPT_KIND_LABEL[kind]} is settled in full when it is issued. Invoice ${peso(received)} instead, or put the rest on credit with a ${RECEIPT_KIND_LABEL.SI_CHARGE}.`}
          </span>
        </div>
      )}

      {change === 0 && shortfall === 0 && received > 0 && (
        <span className="text-xs text-emerald-700 dark:text-emerald-300">
          ✓ This receipt is settled in full — no change, no balance on it.
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

      {joTotal > 0 && (
        <div className="grid gap-1 border-t pt-2">
          <span className="text-xs font-medium text-muted-foreground">
            This job order, after issuing this
          </span>
          <Row label="Job total" value={peso(joTotal)} />
          <Row label="Paid, including this" value={peso(paidAfter)} />
          <div
            className={cn(
              "flex items-center justify-between font-semibold",
              stillToPay > 0
                ? "text-amber-700 dark:text-amber-400"
                : "text-emerald-700 dark:text-emerald-300"
            )}
          >
            <span>{stillToPay > 0 ? "Still to pay" : "Fully paid"}</span>
            <span className="font-mono tabular-nums">{peso(stillToPay)}</span>
          </div>
          {stillToPay > 0 && (
            <span className="text-xs text-muted-foreground">
              {shortfall > 0 && opensCredit
                ? `${peso(shortfall)} of it is on utang and already on the A/R ledger; the rest is still to be invoiced.`
                : "Collected on a later receipt against this same job."}
            </span>
          )}
        </div>
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
  onVoid,
}: {
  rows: ReceiptRowDto[];
  settled: boolean;
  canVoid: boolean;
  onVoid: (row: ReceiptRowDto) => void;
}) {
  const live = rows.filter((r) => r.voidType === null);
  const owed = live.reduce((t, r) => t + num(r.balanceDue), 0);
  /** Which receipt is opened up. One at a time — the list is a summary. */
  const [expanded, setExpanded] = useState<string | null>(null);

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
          const open = expanded === r.id;
          return (
            <div
              key={r.id}
              className="border-t pt-1.5 first:border-t-0 first:pt-0"
            >
              <div
                className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded text-sm hover:bg-muted/50"
                onClick={() => setExpanded(open ? null : r.id)}
              >
                <button
                  type="button"
                  aria-expanded={open}
                  aria-label={`${open ? "Hide" : "Show"} what was paid on ${r.documentNo ?? "this payment"}`}
                  className="rounded"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded(open ? null : r.id);
                  }}
                >
                  <ChevronRightIcon
                    className={cn(
                      "size-3.5 shrink-0 text-muted-foreground transition-transform",
                      open && "rotate-90"
                    )}
                  />
                </button>
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
                    {/* One word, whatever became of it — that is what the leaf
                        itself says. The successor beside it is the difference. */}
                    <ColorBadge tone="red" label={VOID_MARK} />
                    <span className="text-xs text-muted-foreground">
                      {r.replacedByDocumentNo
                        ? `→ ${r.replacedByDocumentNo}`
                        : r.voidReason}
                    </span>
                  </span>
                ) : (
                  canVoid && (
                    <Button
                      className="ml-auto"
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        // Cancelling is not "tell me more" — the row underneath
                        // must not open on the way to the confirm dialog.
                        e.stopPropagation();
                        onVoid(r);
                      }}
                    >
                      <BanIcon /> Cancel
                    </Button>
                  )
                )}

                {r.replacesDocumentNo && (
                  <span className="text-xs text-muted-foreground">
                    replaces {r.replacesDocumentNo}
                  </span>
                )}
              </div>

              {open && <ReceiptDetail row={r} />}
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
