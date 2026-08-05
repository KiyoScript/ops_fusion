"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileTextIcon, HandCoinsIcon, SearchIcon, WalletIcon } from "lucide-react";
import { fetchJson } from "@/lib/api-client";
import { sanitizeDecimal } from "@/lib/form-numeric";
import { Label } from "@/components/ui/label";
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
import { Skeleton } from "@/components/ui/skeleton";
import { ColorBadge } from "@/components/color-badge";
import { EmptyState, ErrorState } from "@/components/data-states";
import { cn } from "@/lib/utils";
import {
  AGING_BUCKETS,
  AGING_BUCKET_LABEL,
  type AgingBucket,
  type ReceivableCustomerDto,
  type ReceivablesPageDto,
  type StatementOfAccountDto,
} from "../schemas/receipt";
import { CollectPaymentDialog } from "./collect-payment-dialog";

const peso = (v: string) =>
  `₱${parseFloat(v || "0").toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const isZero = (v: string) => Math.round(parseFloat(v || "0") * 100) === 0;

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

/** Older debt reads hotter — the eye should land on 90+ first. */
const BUCKET_TONE: Record<AgingBucket, "green" | "blue" | "amber" | "red"> = {
  CURRENT: "green",
  D1_30: "blue",
  D31_60: "amber",
  D61_90: "amber",
  D90_PLUS: "red",
};

export function ReceivablesView({
  canMaintain = false,
}: {
  /** Credit terms are reference data — admins set them, cashiers don't. */
  canMaintain?: boolean;
}) {
  const [q, setQ] = useState("");
  const [bucket, setBucket] = useState<AgingBucket | null>(null);
  const [overLimitOnly, setOverLimitOnly] = useState(false);
  const [statementFor, setStatementFor] = useState<string | null>(null);
  const [creditFor, setCreditFor] = useState<ReceivableCustomerDto | null>(null);
  const [collectFor, setCollectFor] = useState<string | null>(null);

  const search = new URLSearchParams();
  if (q.trim()) search.set("q", q.trim());
  if (bucket) search.set("bucket", bucket);
  if (overLimitOnly) search.set("overLimitOnly", "true");

  const ledger = useQuery({
    queryKey: ["receivables", q.trim(), bucket, overLimitOnly],
    queryFn: () =>
      fetchJson<ReceivablesPageDto>(`/api/receivables?${search}`),
  });

  if (ledger.isPending) {
    return (
      <div className="grid gap-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (ledger.isError) {
    return (
      <ErrorState
        message={ledger.error.message}
        onRetry={() => ledger.refetch()}
      />
    );
  }

  const { summary, customers, creditControlEnabled } = ledger.data;

  return (
    <div className="grid gap-5">
      {/* ——— the totals, and the aging bands as filters ——— */}
      <div className="grid gap-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <div className="grid">
            <span className="text-xs text-muted-foreground">
              Total outstanding
            </span>
            <span className="font-mono text-3xl font-semibold tabular-nums">
              {peso(summary.totalOutstanding)}
            </span>
          </div>
          <span className="text-sm text-muted-foreground">
            {summary.invoiceCount} open invoice
            {summary.invoiceCount === 1 ? "" : "s"} across{" "}
            {summary.customerCount} customer
            {summary.customerCount === 1 ? "" : "s"}
          </span>
          {creditControlEnabled && summary.overLimitCount > 0 && (
            <ColorBadge
              tone="red"
              label={`${summary.overLimitCount} over credit limit`}
            />
          )}
          {!isZero(summary.totalCreditOnAccount) && (
            <div className="grid">
              <span className="text-xs text-muted-foreground">
                Credit on account
              </span>
              <span className="font-mono text-lg tabular-nums text-emerald-700 dark:text-emerald-300">
                {peso(summary.totalCreditOnAccount)}
              </span>
            </div>
          )}
        </div>

        <div className="grid gap-2 sm:grid-cols-5">
          {AGING_BUCKETS.map((b) => {
            const active = bucket === b;
            return (
              <button
                key={b}
                type="button"
                onClick={() => setBucket(active ? null : b)}
                aria-pressed={active}
                className={cn(
                  "grid gap-0.5 rounded-md border p-2.5 text-left transition-colors",
                  active
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "hover:bg-muted/50"
                )}
              >
                <span className="text-xs text-muted-foreground">
                  {AGING_BUCKET_LABEL[b]}
                </span>
                <span
                  className={cn(
                    "font-mono text-lg tabular-nums",
                    isZero(summary.aging[b]) && "text-muted-foreground"
                  )}
                >
                  {peso(summary.aging[b])}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ——— filters ——— */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 sm:max-w-xs">
          <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search customer…"
            aria-label="Search customer"
            className="pl-8"
          />
        </div>
        {creditControlEnabled && (
          <Button
            type="button"
            variant={overLimitOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setOverLimitOnly((v) => !v)}
          >
            Over limit only
          </Button>
        )}
        {(bucket || overLimitOnly || q) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ("");
              setBucket(null);
              setOverLimitOnly(false);
            }}
          >
            Clear
          </Button>
        )}
      </div>

      {/* ——— the ledger ——— */}
      {customers.length === 0 ? (
        <EmptyState
          title="Nothing outstanding"
          description={
            q || bucket || overLimitOnly
              ? "No customer matches these filters."
              : "Every invoice has been collected in full."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">Customer</th>
                <th className="px-3 py-2 text-right font-medium">Invoices</th>
                <th className="px-3 py-2 text-right font-medium">
                  Outstanding
                </th>
                <th className="px-3 py-2 font-medium">Oldest</th>
                {creditControlEnabled && (
                  <>
                    <th className="px-3 py-2 font-medium">Terms</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Credit left
                    </th>
                  </>
                )}
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.customerId} className="border-b last:border-b-0">
                  <td className="px-3 py-2 font-medium">
                    <span className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/sales-audit/receivables/${c.customerId}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {c.customerName}
                      </Link>
                      {c.overLimit && creditControlEnabled && (
                        <ColorBadge tone="red" label="Over limit" />
                      )}
                      {/* Money held FOR them — the opposite sign to what they
                          owe, so it is shown beside the debt, never netted
                          into it. */}
                      {!isZero(c.creditOnAccount) && (
                        <ColorBadge
                          tone="green"
                          label={`${peso(c.creditOnAccount)} credit`}
                        />
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {c.invoiceCount}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-medium tabular-nums">
                    {peso(c.outstanding)}
                  </td>
                  <td className="px-3 py-2">
                    {c.oldestDaysOverdue === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <ColorBadge
                        tone={BUCKET_TONE[bucketOf(c.oldestDaysOverdue)]}
                        label={
                          c.oldestDaysOverdue === 0
                            ? "Current"
                            : `${c.oldestDaysOverdue}d overdue`
                        }
                      />
                    )}
                  </td>
                  {creditControlEnabled && (
                    <>
                      <td className="px-3 py-2 text-muted-foreground">
                        {c.creditTermDays === null
                          ? "—"
                          : `Net ${c.creditTermDays}`}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right font-mono tabular-nums",
                          c.overLimit && "text-destructive"
                        )}
                      >
                        {c.creditAvailable === null
                          ? "—"
                          : peso(c.creditAvailable)}
                      </td>
                    </>
                  )}
                  <td className="px-3 py-2 text-right">
                    <span className="flex justify-end gap-1">
                      {/* The primary action on an A/R row: take their money. */}
                      <Button
                        size="sm"
                        onClick={() => setCollectFor(c.customerId)}
                      >
                        <HandCoinsIcon /> Collect
                      </Button>
                      {creditControlEnabled && canMaintain && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setCreditFor(c)}
                        >
                          <WalletIcon /> Credit
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setStatementFor(c.customerId)}
                      >
                        <FileTextIcon /> Statement
                      </Button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <StatementDialog
        customerId={statementFor}
        onClose={() => setStatementFor(null)}
      />
      <CreditDialog
        customer={creditFor}
        onClose={() => setCreditFor(null)}
      />
      <CollectPaymentDialog
        customerId={collectFor}
        onClose={() => setCollectFor(null)}
      />
    </div>
  );
}

/** Agree a customer's payment terms and credit ceiling. */
function CreditDialog({
  customer,
  onClose,
}: {
  customer: ReceivableCustomerDto | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  // Keyed on the customer so reopening on a different row starts from THEIR
  // current values rather than whatever was typed last.
  const [draft, setDraft] = useState<{
    key: string;
    termDays: string;
    limit: string;
  }>({ key: "", termDays: "", limit: "" });

  if (customer && draft.key !== customer.customerId) {
    setDraft({
      key: customer.customerId,
      termDays: customer.creditTermDays?.toString() ?? "",
      limit: customer.creditLimit ?? "",
    });
  }

  const save = useMutation({
    mutationFn: (input: {
      customerId: string;
      creditTermDays: number | null;
      creditLimit: string | null;
    }) =>
      fetchJson<{ id: string; name: string }>(
        `/api/receivables/${input.customerId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            creditTermDays: input.creditTermDays,
            creditLimit: input.creditLimit,
          }),
        }
      ),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["receivables"] });
      toast.success(`Credit terms saved for ${c.name}.`);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const termDaysValue =
    draft.termDays.trim() === "" ? null : Number(draft.termDays);
  const termDaysInvalid =
    termDaysValue !== null &&
    (!Number.isInteger(termDaysValue) || termDaysValue < 0 || termDaysValue > 365);

  return (
    <Dialog open={customer !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Credit terms</DialogTitle>
          <DialogDescription>
            {customer?.customerName ?? ""}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="cd-terms">Payment terms (days)</Label>
            <Input
              id="cd-terms"
              inputMode="numeric"
              value={draft.termDays}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  termDays: e.target.value.replace(/[^\d]/g, ""),
                }))
              }
              placeholder="e.g. 30"
              className="font-mono tabular-nums"
            />
            <p className="text-xs text-muted-foreground">
              A charge invoice falls due this many days after it is issued.
              Leave blank for no terms — it then never shows as overdue.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="cd-limit">Credit limit</Label>
            <Input
              id="cd-limit"
              inputMode="decimal"
              value={draft.limit}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  limit: sanitizeDecimal(e.target.value),
                }))
              }
              placeholder="e.g. 50000.00"
              className="text-right font-mono tabular-nums"
            />
            <p className="text-xs text-muted-foreground">
              New charge invoices are blocked once this customer&rsquo;s open
              balance would exceed this. Leave blank for no ceiling.
              {customer && (
                <> Currently owes {peso(customer.outstanding)}.</>
              )}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending || termDaysInvalid || !customer}
            onClick={() =>
              customer &&
              save.mutate({
                customerId: customer.customerId,
                creditTermDays: termDaysValue,
                creditLimit: draft.limit.trim() === "" ? null : draft.limit.trim(),
              })
            }
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Mirrors bucketFor in the schema, for the badge tone on a day count. */
function bucketOf(days: number): AgingBucket {
  if (days <= 0) return "CURRENT";
  if (days <= 30) return "D1_30";
  if (days <= 60) return "D31_60";
  if (days <= 90) return "D61_90";
  return "D90_PLUS";
}

/** A customer's Statement of Account — printable, one line per open invoice. */
function StatementDialog({
  customerId,
  onClose,
}: {
  customerId: string | null;
  onClose: () => void;
}) {
  const statement = useQuery({
    queryKey: ["receivables", "statement", customerId],
    queryFn: () =>
      fetchJson<StatementOfAccountDto>(`/api/receivables/${customerId}`),
    enabled: customerId !== null,
  });

  const s = statement.data;

  return (
    <Dialog open={customerId !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Statement of Account</DialogTitle>
          <DialogDescription>
            {s ? `${s.customerName} · as of ${shortDate(s.asOf)}` : "Loading…"}
          </DialogDescription>
        </DialogHeader>

        {statement.isPending ? (
          <Skeleton className="h-56 w-full" />
        ) : statement.isError ? (
          <ErrorState
            message={statement.error.message}
            onRetry={() => statement.refetch()}
          />
        ) : s ? (
          <div className="grid gap-4">
            <div className="grid gap-0.5 rounded-md border bg-muted/40 p-3 text-sm">
              <span className="font-medium">{s.customerName}</span>
              <span className="text-muted-foreground">
                {s.customerAddress || "No address on file"}
              </span>
              <span className="text-muted-foreground">
                TIN: {s.customerTin || "—"}
              </span>
              {s.creditTermDays !== null && (
                <span className="text-muted-foreground">
                  Terms: net {s.creditTermDays} days
                  {s.creditLimit && ` · limit ${peso(s.creditLimit)}`}
                </span>
              )}
            </div>

            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground uppercase">
                  <tr>
                    <th className="px-3 py-2 font-medium">Invoice</th>
                    <th className="px-3 py-2 font-medium">Job order</th>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Due</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                    <th className="px-3 py-2 text-right font-medium">Open</th>
                  </tr>
                </thead>
                <tbody>
                  {s.invoices.map((inv) => (
                    <tr key={inv.id} className="border-b last:border-b-0">
                      <td className="px-3 py-2">
                        <span className="grid">
                          <span className="font-mono tabular-nums">
                            {inv.documentNo}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {inv.kindLabel}
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {inv.joNumber ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {shortDate(inv.saleDate)}
                      </td>
                      <td className="px-3 py-2">
                        {inv.dueDate ? (
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="text-muted-foreground">
                              {shortDate(inv.dueDate)}
                            </span>
                            {inv.daysOverdue !== null &&
                              inv.daysOverdue > 0 && (
                                <ColorBadge
                                  tone={BUCKET_TONE[inv.bucket]}
                                  label={`${inv.daysOverdue}d`}
                                />
                              )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            no terms
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {peso(inv.amount)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-medium tabular-nums">
                        {peso(inv.openBalance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t bg-muted/40">
                  <tr>
                    <td colSpan={5} className="px-3 py-2 text-right font-medium">
                      Total outstanding
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-base font-semibold tabular-nums">
                      {peso(s.totalOutstanding)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="grid gap-2 sm:grid-cols-5">
              {AGING_BUCKETS.map((b) => (
                <div key={b} className="grid gap-0.5 rounded-md border p-2.5">
                  <span className="text-xs text-muted-foreground">
                    {AGING_BUCKET_LABEL[b]}
                  </span>
                  <span
                    className={cn(
                      "font-mono tabular-nums",
                      isZero(s.aging[b]) && "text-muted-foreground"
                    )}
                  >
                    {peso(s.aging[b])}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => window.print()}>Print</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
