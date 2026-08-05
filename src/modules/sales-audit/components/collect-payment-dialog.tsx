"use client";

import { useState } from "react";
import { toast } from "sonner";
import { HandCoinsIcon, PlusIcon, XIcon } from "lucide-react";
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
import { OnHandCheck } from "./on-hand-check";
import { sanitizeDecimal } from "@/lib/form-numeric";
import { cn } from "@/lib/utils";
import { PaymentMethod } from "@/generated/prisma/enums";
import type { CollectOptionsDto } from "../schemas/receipt";
import {
  useCollectOptions,
  useCollectFromCustomer,
} from "../hooks/use-sales-audit";

const peso = (v: number) =>
  `₱${v.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const num = (v: string) => {
  const n = parseFloat(v.replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
};

const cent = (v: number) => Math.round(v * 100);

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric" });

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: PaymentMethod.CASH, label: "Cash" },
  { value: PaymentMethod.GCASH, label: "GCash" },
  { value: PaymentMethod.CHECK, label: "Cheque" },
  { value: PaymentMethod.BANK_TRANSFER, label: "Bank transfer" },
  { value: PaymentMethod.QR, label: "QR" },
];

type Line = {
  key: string;
  method: PaymentMethod;
  amount: string;
  reference: string;
};

let lineSeq = 0;
const newLine = (method: PaymentMethod = PaymentMethod.CASH): Line => ({
  key: `cl-${lineSeq++}`,
  method,
  amount: "",
  reference: "",
});

/**
 * Receive a payment against a customer's ACCOUNT — the QuickBooks shape.
 *
 * The money is spread across their open invoices oldest-first, no matter which
 * job order each belongs to. Every row stays editable, so a customer paying
 * one specific invoice out of order is a click rather than a workaround. What
 * the invoices don't need is held as credit on the account.
 */
export function CollectPaymentDialog({
  customerId,
  replaces,
  onClose,
}: {
  customerId: string | null;
  /** Reissuing a spoiled Collection Receipt — §5.1: void and reissue together. */
  replaces?: { id: string; documentNo: string; amount: string } | null;
  onClose: () => void;
}) {
  const options = useCollectOptions(customerId);
  const collect = useCollectFromCustomer();
  const data = options.data;

  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [creditToApply, setCreditToApply] = useState("");
  const [notes, setNotes] = useState("");
  const [issueDocument, setIssueDocument] = useState(true);
  const [replaceReason, setReplaceReason] = useState("");
  const [replaceOnHand, setReplaceOnHand] = useState(false);
  /** Rows the cashier has typed into — null until they take over. */
  const [manual, setManual] = useState<Record<string, string> | null>(null);

  const reset = () => {
    setLines([newLine()]);
    setCreditToApply("");
    setNotes("");
    setIssueDocument(true);
    setReplaceReason("");
    setReplaceOnHand(false);
    setManual(null);
    onClose();
  };

  const received = lines.reduce((t, l) => t + num(l.amount), 0);
  // No active booklet means no receipt can be printed, whatever the tick says.
  const willPrint = issueDocument && (data?.nextCrNumber ?? null) !== null;
  const creditAvailable = num(data?.creditAvailable ?? "0");
  const creditUsed = Math.min(num(creditToApply), creditAvailable);
  const pool = received + creditUsed;

  const invoices = data?.invoices ?? [];

  // Auto-apply oldest-first until the cashier overrides a row; from then on
  // their numbers stand. Computed in one pass, never mutated during render.
  const autoApplied = invoices.reduce<{ per: Record<string, number>; left: number }>(
    (acc, inv) => {
      const take = Math.max(Math.min(acc.left, cent(num(inv.openBalance))), 0);
      acc.per[inv.id] = take;
      acc.left -= take;
      return acc;
    },
    { per: {}, left: cent(pool) }
  ).per;

  const appliedFor = (id: string) =>
    manual ? cent(num(manual[id] ?? "0")) : (autoApplied[id] ?? 0);

  const applied = invoices.reduce((t, inv) => t + appliedFor(inv.id), 0);
  const toCredit = cent(pool) - applied;

  const setRow = (id: string, value: string) =>
    setManual((m) => {
      // Taking over starts from whatever is on screen, so nothing jumps.
      const seed =
        m ??
        Object.fromEntries(
          invoices.map((inv) => [
            inv.id,
            ((autoApplied[inv.id] ?? 0) / 100).toFixed(2),
          ])
        );
      return { ...seed, [id]: value };
    });

  const patchLine = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () =>
    setLines((ls) => [
      ...ls,
      newLine(
        ls.length && ls[ls.length - 1].method === PaymentMethod.CASH
          ? PaymentMethod.GCASH
          : PaymentMethod.CASH
      ),
    ]);

  const problem = (): string | null => {
    if (!data) return null;
    if (invoices.length === 0)
      return `${data.customerName} has nothing outstanding.`;
    if (lines.some((l) => l.amount.trim() !== "" && cent(num(l.amount)) <= 0))
      return "Every payment line needs an amount greater than zero.";
    if (cent(pool) <= 0)
      return "Enter a payment, or apply a credit already on file.";
    if (cent(num(creditToApply)) > cent(creditAvailable))
      return `Only ${peso(creditAvailable)} of credit is on this account.`;
    if (applied > cent(pool))
      return `${peso(applied / 100)} allocated but only ${peso(pool)} is available to apply.`;
    for (const inv of invoices) {
      if (appliedFor(inv.id) > cent(num(inv.openBalance))) {
        return `${peso(appliedFor(inv.id) / 100)} applied to ${inv.documentNo}, which only has ${peso(num(inv.openBalance))} outstanding.`;
      }
    }
    if (cent(received) === 0 && willPrint)
      return "This payment is funded entirely by credit, so no money is received. Untick the Collection Receipt.";
    if (creditUsed > 0 && toCredit > 0)
      return `This spends ${peso(creditUsed)} of credit and would leave ${peso(toCredit / 100)} back on the account. Apply only what the invoices need.`;
    if (replaces && replaceReason.trim().length < 3)
      return "Write the reason for the replacement.";
    if (replaces && !replaceOnHand)
      return `Confirm that ${replaces.documentNo} is on hand before reissuing it.`;
    return null;
  };

  const submit = () => {
    if (!customerId || !data) return;
    const err = problem();
    if (err) {
      toast.error(err);
      return;
    }
    collect.mutate(
      {
        customerId,
        payments: lines
          .filter((l) => cent(num(l.amount)) > 0)
          .map((l) => ({
            method: l.method,
            amount: l.amount,
            reference: l.reference.trim() || undefined,
          })),
        creditApplied: creditUsed > 0 ? creditUsed.toFixed(2) : undefined,
        // Only sent once the cashier has taken over — otherwise the server
        // applies oldest-first itself, and the two can never drift apart.
        allocations: manual
          ? invoices
              .filter((inv) => appliedFor(inv.id) > 0)
              .map((inv) => ({
                saleId: inv.id,
                amount: (appliedFor(inv.id) / 100).toFixed(2),
              }))
          : undefined,
        issueDocument: willPrint,
        notes: notes.trim() || undefined,
        replaces: replaces
          ? { receiptId: replaces.id, reason: replaceReason }
          : undefined,
      },
      {
        onSuccess: (r) => {
          const bits = [
            r.replacedDocumentNo
              ? `${r.replacedDocumentNo} replaced by ${r.documentNo}.`
              : r.documentNo
                ? `${r.documentNo} issued.`
                : "Payment recorded.",
            r.invoicesClosed > 0 &&
              `${r.invoicesClosed} invoice${r.invoicesClosed === 1 ? "" : "s"} closed.`,
            cent(num(r.creditCreated)) > 0 &&
              `${peso(num(r.creditCreated))} left as credit on account.`,
            cent(num(r.creditUsed)) > 0 &&
              `${peso(num(r.creditUsed))} of credit used.`,
          ].filter(Boolean);
          toast.success(`${peso(num(r.applied))} applied.`, {
            description: bits.join(" "),
          });
          reset();
        },
        onError: (e: Error) => toast.error(e.message),
      }
    );
  };

  return (
    <Dialog open={customerId !== null} onOpenChange={(o) => !o && reset()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HandCoinsIcon className="size-5" />
            {replaces ? "Replace Collection Receipt" : "Receive Payment"}
          </DialogTitle>
          <DialogDescription>
            {data
              ? `${data.customerName} · ${peso(num(data.totalOutstanding))} outstanding`
              : "Loading account…"}
          </DialogDescription>
        </DialogHeader>

        {options.isPending ? (
          <div className="grid gap-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : options.isError ? (
          <ErrorState
            message={options.error.message}
            onRetry={() => options.refetch()}
          />
        ) : data ? (
          <div className="grid gap-5">
            {/* ——— reissue mode ——— */}
            {replaces && (
              <div className="grid gap-3 rounded-md border border-amber-500/40 bg-amber-50 p-3 text-sm dark:bg-amber-500/10">
                <span className="font-medium text-amber-900 dark:text-amber-200">
                  Replacing {replaces.documentNo} · {peso(num(replaces.amount))}
                </span>
                <p className="text-xs text-amber-900/80 dark:text-amber-200/80">
                  Issuing below marks {replaces.documentNo} REPLACED and writes
                  the two serial numbers on each other. Both happen together —
                  neither can be left half-done. Everything{" "}
                  {replaces.documentNo} settled reopens first, so the invoices
                  below already show what it was paying for.
                </p>
                <div className="grid gap-1.5">
                  <Label htmlFor="cp-replace-reason">
                    Reason <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    id="cp-replace-reason"
                    value={replaceReason}
                    onChange={(e) => setReplaceReason(e.target.value)}
                    rows={2}
                    placeholder="e.g. wrong amount encoded"
                  />
                </div>
                <OnHandCheck
                  id="cp-replace-onhand"
                  checked={replaceOnHand}
                  onChange={setReplaceOnHand}
                  documentNo={replaces.documentNo}
                />
              </div>
            )}

            {/* ——— what they handed over ——— */}
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label>{lines.length > 1 ? "Payment lines" : "Payment"}</Label>
                <Button type="button" variant="outline" size="sm" onClick={addLine}>
                  <PlusIcon />
                  {lines.length === 1 ? "Split payment" : "Add line"}
                </Button>
              </div>
              <div className="grid gap-2">
                {lines.map((l, i) => (
                  <div key={l.key} className="flex items-center gap-2">
                    <Select
                      value={l.method}
                      onValueChange={(v) =>
                        patchLine(l.key, { method: v as PaymentMethod })
                      }
                    >
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
                        patchLine(l.key, { amount: sanitizeDecimal(e.target.value) })
                      }
                      placeholder={data.totalOutstanding}
                      className="flex-1 text-right font-mono tabular-nums"
                    />
                    <Input
                      aria-label={`Reference, line ${i + 1}`}
                      value={l.reference}
                      onChange={(e) => patchLine(l.key, { reference: e.target.value })}
                      placeholder={
                        l.method === PaymentMethod.CASH ? "—" : "Cheque no. / ref"
                      }
                      disabled={l.method === PaymentMethod.CASH}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove line ${i + 1}`}
                      onClick={() =>
                        setLines((ls) => ls.filter((x) => x.key !== l.key))
                      }
                      disabled={lines.length === 1}
                    >
                      <XIcon />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            {/* ——— credit already on the account ——— */}
            {cent(creditAvailable) > 0 && (
              <div className="grid gap-2 rounded-md border border-emerald-500/40 bg-emerald-50/60 p-3 dark:bg-emerald-500/10">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    Credit on account{" "}
                    <span className="font-mono tabular-nums">
                      {peso(creditAvailable)}
                    </span>
                  </span>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="cp-credit" className="text-xs">
                      Apply
                    </Label>
                    <Input
                      id="cp-credit"
                      inputMode="decimal"
                      value={creditToApply}
                      onChange={(e) =>
                        setCreditToApply(sanitizeDecimal(e.target.value))
                      }
                      placeholder="0.00"
                      className="h-8 w-32 text-right font-mono tabular-nums"
                    />
                    {cent(creditUsed) !== cent(creditAvailable) && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setCreditToApply(creditAvailable.toFixed(2))}
                      >
                        Use all
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Money already held for this customer from an earlier
                  overpayment. Spending it here takes it off the account.
                </p>
              </div>
            )}

            {/* ——— the invoices this settles ——— */}
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label>Outstanding invoices</Label>
                {manual && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setManual(null)}
                  >
                    Re-apply oldest first
                  </Button>
                )}
              </div>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground uppercase">
                    <tr>
                      <th className="px-3 py-2 font-medium">Invoice</th>
                      <th className="px-3 py-2 font-medium">Job order</th>
                      <th className="px-3 py-2 font-medium">Due</th>
                      <th className="px-3 py-2 text-right font-medium">Open</th>
                      <th className="px-3 py-2 text-right font-medium">Payment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => {
                      const paying = appliedFor(inv.id);
                      const closes = paying >= cent(num(inv.openBalance)) && paying > 0;
                      return (
                        <tr
                          key={inv.id}
                          className={cn(
                            "border-b last:border-b-0",
                            paying > 0 && "bg-emerald-50/40 dark:bg-emerald-500/5"
                          )}
                        >
                          <td className="px-3 py-2">
                            <span className="grid">
                              <span className="flex items-center gap-2 font-mono tabular-nums">
                                {inv.documentNo}
                                {closes && (
                                  <ColorBadge tone="green" label="closes" />
                                )}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {shortDate(inv.saleDate)} · {inv.kindLabel}
                              </span>
                            </span>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {inv.joNumber ?? "—"}
                          </td>
                          <td className="px-3 py-2">
                            {inv.dueDate ? (
                              <span className="flex flex-wrap items-center gap-1.5">
                                <span className="text-muted-foreground">
                                  {shortDate(inv.dueDate)}
                                </span>
                                {inv.daysOverdue !== null && inv.daysOverdue > 0 && (
                                  <ColorBadge
                                    tone="red"
                                    label={`${inv.daysOverdue}d`}
                                  />
                                )}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {peso(num(inv.openBalance))}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Input
                              inputMode="decimal"
                              aria-label={`Payment applied to ${inv.documentNo}`}
                              value={(paying / 100).toFixed(2)}
                              onChange={(e) =>
                                setRow(inv.id, sanitizeDecimal(e.target.value))
                              }
                              className="ml-auto h-8 w-32 text-right font-mono tabular-nums"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ——— where the money lands ——— */}
            <div className="grid gap-1.5 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <Row label="Received now" value={peso(received)} />
              {creditUsed > 0 && (
                <Row label="Credit applied" value={peso(creditUsed)} />
              )}
              <div className="flex items-center justify-between border-t pt-1.5 font-semibold">
                <span>Applied to invoices</span>
                <span className="font-mono tabular-nums">
                  {peso(applied / 100)}
                </span>
              </div>
              {toCredit > 0 && (
                <div className="grid gap-0.5 border-t pt-1.5">
                  <div className="flex items-center justify-between font-semibold text-emerald-700 dark:text-emerald-300">
                    <span>Left as credit</span>
                    <span className="font-mono tabular-nums">
                      {peso(toCredit / 100)}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    More than the invoices need — held on{" "}
                    {data.customerName}&rsquo;s account for their next invoice,
                    not handed back.
                  </span>
                </div>
              )}
            </div>

            {/* The serial is shown, not merely promised: the cashier is about
                to write this number on paper, and "the next CR number" is not
                something they can check anywhere else on this screen. */}
            <label
              htmlFor="cp-issue-doc"
              className={cn(
                "flex items-start gap-3 rounded-md border p-3 text-sm",
                data.nextCrNumber ? "cursor-pointer" : "opacity-70"
              )}
            >
              <input
                id="cp-issue-doc"
                type="checkbox"
                checked={issueDocument && data.nextCrNumber !== null}
                disabled={data.nextCrNumber === null}
                onChange={(e) => setIssueDocument(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-primary"
              />
              <span className="grid gap-0.5">
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  Print a Collection Receipt
                  {data.nextCrNumber ? (
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">
                      {data.nextCrNumber}
                    </span>
                  ) : (
                    <ColorBadge tone="amber" label="no active booklet" />
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {!data.nextCrNumber ? (
                    <>
                      No Collection Receipt booklet is active, so no number can
                      be issued. Register and approve one under{" "}
                      <strong>Sales Audit Maintenance</strong> — or record the
                      payment without a receipt, which still closes the balance.
                    </>
                  ) : issueDocument ? (
                    <>
                      {data.nextCrNumber} will be consumed from the active
                      booklet and cannot be reused.
                    </>
                  ) : (
                    <>
                      The payment is still recorded and the balances still close
                      — {data.nextCrNumber} stays unused.
                    </>
                  )}
                </span>
              </span>
            </label>

            <div className="grid gap-1.5">
              <Label htmlFor="cp-notes">Notes</Label>
              <Textarea
                id="cp-notes"
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
            disabled={collect.isPending || !data || !!problem()}
          >
            {collect.isPending
              ? "Recording…"
              : willPrint && data?.nextCrNumber
                ? `Apply ${peso(applied / 100)} · issue ${data.nextCrNumber}`
                : `Apply ${peso(applied / 100)}`}
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

export type { CollectOptionsDto };
