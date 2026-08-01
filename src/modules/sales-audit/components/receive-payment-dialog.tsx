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
  type ReceiptKind,
  type ReceiptRowDto,
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

  const [kind, setKind] = useState<ReceiptKind>(RECEIPT_KIND.SI_VAT);
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [notes, setNotes] = useState("");

  // ——— the amount is FIXED, never typed ———
  // It is the job order's own price: the outstanding balance normally, or the
  // amount of the receipt being reissued when replacing one. Nothing at the
  // counter should be able to change what the job costs.
  const amount = replacing ? replacing.amount : (jo?.balance ?? "0.00");
  const due = num(amount);

  const isVat = VAT_KINDS.includes(kind);
  const vatableSales = isVat ? due / VAT_DIVISOR : due;
  const vatAmount = isVat ? due - vatableSales : 0;
  const isCharge = kind === RECEIPT_KIND.SI_CHARGE;
  const isCollection = kind === RECEIPT_KIND.COLLECTION;

  // Nothing left to collect — the dialog becomes a record of what was issued.
  const settled = !replacing && jo !== undefined && cent(due) <= 0;

  const clearForm = () => {
    setKind(RECEIPT_KIND.SI_VAT);
    setLines([newLine()]);
    setNotes("");
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
    setKind(row.kind);
    setLines([newLine()]);
  };

  // ——— what the customer handed over ———
  const received = lines.reduce((t, l) => t + num(l.amount), 0);
  const cashIn = lines
    .filter((l) => l.method === PaymentMethod.CASH)
    .reduce((t, l) => t + num(l.amount), 0);
  const change = Math.max(received - due, 0);
  const balanceDue = Math.max(due - received, 0);
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
    setKind(k);
    if (k === RECEIPT_KIND.SI_CHARGE) setLines([]);
    else if (lines.length === 0) setLines([newLine()]);
  };

  const nextNumber = jo?.nextNumbers[kind] ?? null;
  const blocked = !nextNumber;

  const problem = (): string | null => {
    if (cent(due) <= 0) return "There is nothing left to receive on this job order.";
    if (lines.some((l) => cent(num(l.amount)) <= 0))
      return "Every payment line needs an amount greater than zero.";
    if (received === 0 && !isCharge)
      return `Nothing was received. A sale on credit is issued as a ${RECEIPT_KIND_LABEL.SI_CHARGE}.`;
    if (overNonCash)
      return `Only cash can be over-tendered — ${peso(change)} is above the amount due but only ${peso(cashIn)} came in as cash.`;
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
        toast.success(`${RECEIPT_KIND_LABEL[kind]} ${r.documentNo} issued.`, {
          description: describe(r.balanceDue, r.changeGiven),
        });
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
                  documentNo={replacing.documentNo}
                />
              </div>
            )}

            {settled ? (
              /* Nothing left to collect: no receipt type, no amount, no
                 payment — showing them would only invite a double-issue. */
              <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
                This job order is fully covered by the receipts above. To
                correct one, use <strong>Replace</strong>; to undo it, use{" "}
                <strong>Cancel</strong> — either reopens the balance and brings
                this form back.
              </p>
            ) : (
              <>
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
                          onClick={() => pickKind(k)}
                          aria-pressed={active}
                          disabled={replacing !== null && k !== replacing.kind}
                          className={cn(
                            "flex flex-col items-start gap-0.5 rounded-md border p-3 text-left transition-colors",
                            active
                              ? "border-primary bg-primary/5 ring-1 ring-primary"
                              : "hover:bg-muted/50",
                            !next && "opacity-60",
                            replacing !== null &&
                              k !== replacing.kind &&
                              "cursor-not-allowed opacity-40"
                          )}
                        >
                          <span className="text-sm font-medium">
                            {RECEIPT_KIND_LABEL[k]}
                          </span>
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            {next ?? "no active booklet"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {RECEIPT_KIND_HINT[k]}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {blocked && (
                    <p className="text-sm text-destructive">
                      No active booklet for {RECEIPT_KIND_LABEL[kind]}. Register
                      and approve one under Sales Audit Maintenance before
                      issuing.
                    </p>
                  )}
                </div>

                {/* ——— the amount: fixed by the job order, shown not typed ——— */}
                <div className="grid gap-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <Label className="text-base">
                      {isCollection ? "Outstanding" : "Amount to receive"}
                    </Label>
                    <span className="font-mono text-2xl font-semibold tabular-nums">
                      {peso(due)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {replacing
                      ? `The amount of ${replacing.documentNo}, the receipt being reissued.`
                      : "The job order's outstanding balance — priced on the JO, not editable here."}
                  </p>
                  {isVat && (
                    <div className="grid gap-1 border-t pt-2 text-sm">
                      <div className="mb-0.5 flex items-center gap-2">
                        <ColorBadge tone="blue" label="VAT 12%" />
                      </div>
                      <Row label="Vatable sales (÷ 1.12)" value={peso(vatableSales)} />
                      <Row label="VAT (× 12%)" value={peso(vatAmount)} />
                    </div>
                  )}
                  {isCollection && (
                    <p className="border-t pt-2 text-xs text-muted-foreground">
                      A Collection Receipt is issued for the amount actually
                      received below — not for the full outstanding.
                    </p>
                  )}
                </div>

                {/* ——— what the customer handed over ——— */}
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
                      Nothing received — the whole {peso(due)} goes on credit as
                      Accounts Receivable, settled later by a Collection
                      Receipt.
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
                            disabled={lines.length === 1 && !isCharge}
                          >
                            <XIcon />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ——— change out, or balance left on credit ——— */}
                  <Settlement
                    received={received}
                    change={change}
                    balanceDue={balanceDue}
                    overNonCash={overNonCash}
                    cashIn={cashIn}
                  />
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

        <DialogFooter>
          <Button variant="outline" onClick={reset}>
            {settled ? "Close" : "Cancel"}
          </Button>
          {!settled && (
            <Button onClick={submit} disabled={busy || blocked || !jo || !!problem()}>
              {busy
                ? "Issuing…"
                : replacing
                  ? `Replace with ${nextNumber ?? "receipt"}`
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
 * The two numbers that fall out of what was handed over: change back over the
 * counter, or a balance left on credit. Only one of them is ever non-zero.
 */
function Settlement({
  received,
  change,
  balanceDue,
  overNonCash,
  cashIn,
}: {
  received: number;
  change: number;
  balanceDue: number;
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

      {balanceDue > 0 && (
        <div className="grid gap-0.5 border-t pt-1.5">
          <div className="flex items-center justify-between font-semibold text-amber-700 dark:text-amber-300">
            <span>Balance</span>
            <span className="font-mono tabular-nums">{peso(balanceDue)}</span>
          </div>
          <span className="text-xs text-muted-foreground">
            Left on credit (utang) — Accounts Receivable, settled later by a
            Collection Receipt.
          </span>
        </div>
      )}

      {change === 0 && balanceDue === 0 && received > 0 && (
        <span className="text-xs text-emerald-700 dark:text-emerald-300">
          ✓ Settled in full — no change, no balance.
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
          {settled ? "Fully paid" : "Already issued on this job order"}
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
                {r.documentNo}
              </span>
              <span className="text-muted-foreground">{r.kindLabel}</span>
              <span className={cn("font-mono tabular-nums", struck)}>
                {peso(num(r.amount))}
              </span>
              {!voidType && cent(num(r.balanceDue)) > 0 && (
                <ColorBadge
                  tone="amber"
                  label={`${peso(num(r.balanceDue))} unpaid`}
                />
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
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => onReplace(r)}
                    >
                      <RefreshCwIcon /> Replace
                    </Button>
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
