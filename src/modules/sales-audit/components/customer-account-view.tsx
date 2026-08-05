"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, BanIcon, HandCoinsIcon, RefreshCwIcon } from "lucide-react";
import { fetchJson } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ColorBadge } from "@/components/color-badge";
import { EmptyState, ErrorState } from "@/components/data-states";
import { cn } from "@/lib/utils";
import {
  AGING_BUCKETS,
  AGING_BUCKET_LABEL,
  VOID_TYPE_LABEL,
  type AgingBucket,
  type CustomerAccountDto,
  type CustomerPaymentDto,
} from "../schemas/receipt";
import { CollectPaymentDialog } from "./collect-payment-dialog";
import { VoidReceiptDialog, type VoidTarget } from "./void-receipt-dialog";

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

const BUCKET_TONE: Record<AgingBucket, "green" | "blue" | "amber" | "red"> = {
  CURRENT: "green",
  D1_30: "blue",
  D31_60: "amber",
  D61_90: "amber",
  D90_PLUS: "red",
};

const CREDIT_STATUS_LABEL = {
  UNAPPLIED: "Unspent",
  PARTIALLY_APPLIED: "Part spent",
  FULLY_APPLIED: "Spent",
} as const;

/**
 * One customer's account — the answer to "what has happened with this
 * customer", as against the ledger's "who owes us".
 *
 * Debt and credit are shown side by side and never netted: money owed to the
 * shop and money the shop is holding are opposite signs, and folding them into
 * a single figure hides both.
 */
export function CustomerAccountView({
  customerId,
  canVoid = false,
}: {
  customerId: string;
  /** Cancelling a receipt takes a supervisor — docs/sales.txt §5.1 step 6. */
  canVoid?: boolean;
}) {
  const [collecting, setCollecting] = useState(false);
  const [voiding, setVoiding] = useState<VoidTarget | null>(null);
  const [replacing, setReplacing] = useState<CustomerPaymentDto | null>(null);

  const account = useQuery({
    queryKey: ["receivables", "account", customerId],
    queryFn: () =>
      fetchJson<CustomerAccountDto>(`/api/receivables/${customerId}/account`),
  });

  if (account.isPending) {
    return (
      <div className="grid gap-3">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (account.isError) {
    return (
      <ErrorState
        message={account.error.message}
        onRetry={() => account.refetch()}
      />
    );
  }

  const a = account.data;
  const owesNothing = isZero(a.totalOutstanding);

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" render={<Link href="/sales-audit/receivables" />}>
          <ArrowLeftIcon /> All receivables
        </Button>
        <Button onClick={() => setCollecting(true)} disabled={owesNothing}>
          <HandCoinsIcon /> Receive payment
        </Button>
      </div>

      {/* ——— who they are, what they owe, what we hold ——— */}
      <div className="grid gap-3 rounded-lg border p-4">
        <div className="grid gap-0.5">
          <span className="text-lg font-semibold">{a.customerName}</span>
          <span className="text-sm text-muted-foreground">
            {a.customerAddress || "No address on file"}
          </span>
          <span className="text-sm text-muted-foreground">
            TIN: {a.customerTin || "—"}
            {a.creditControlEnabled && a.creditTermDays !== null && (
              <> · Terms: net {a.creditTermDays} days</>
            )}
            {a.creditControlEnabled && a.creditLimit && (
              <> · Limit {peso(a.creditLimit)}</>
            )}
          </span>
        </div>

        <div className="flex flex-wrap gap-x-10 gap-y-3 border-t pt-3">
          <div className="grid">
            <span className="text-xs text-muted-foreground">Outstanding</span>
            <span className="font-mono text-3xl font-semibold tabular-nums">
              {peso(a.totalOutstanding)}
            </span>
          </div>
          {!isZero(a.creditOnAccount) && (
            <div className="grid">
              <span className="text-xs text-muted-foreground">
                Credit on account
              </span>
              <span className="font-mono text-3xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
                {peso(a.creditOnAccount)}
              </span>
            </div>
          )}
        </div>

        {!owesNothing && (
          <div className="grid gap-2 border-t pt-3 sm:grid-cols-5">
            {AGING_BUCKETS.map((b) => (
              <div key={b} className="grid gap-0.5 rounded-md border p-2.5">
                <span className="text-xs text-muted-foreground">
                  {AGING_BUCKET_LABEL[b]}
                </span>
                <span
                  className={cn(
                    "font-mono tabular-nums",
                    isZero(a.aging[b]) && "text-muted-foreground"
                  )}
                >
                  {peso(a.aging[b])}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ——— open invoices ——— */}
      <Section title="Open invoices" count={a.invoices.length}>
        {a.invoices.length === 0 ? (
          <EmptyState
            title="Nothing outstanding"
            description="Every invoice for this customer has been collected in full."
          />
        ) : (
          <Table
            head={["Invoice", "Job order", "Date", "Due", "Amount", "Open"]}
            alignRight={[4, 5]}
          >
            {a.invoices.map((inv) => (
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
                      {inv.daysOverdue !== null && inv.daysOverdue > 0 && (
                        <ColorBadge
                          tone={BUCKET_TONE[inv.bucket]}
                          label={`${inv.daysOverdue}d`}
                        />
                      )}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">no terms</span>
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
          </Table>
        )}
      </Section>

      {/* ——— credit held for them ——— */}
      {a.credits.length > 0 && (
        <Section title="Credit on account" count={a.credits.length}>
          <Table
            head={["Received", "From", "Amount", "Spent", "Left"]}
            alignRight={[2, 3, 4]}
          >
            {a.credits.map((c) => (
              <tr key={c.id} className="border-b last:border-b-0">
                <td className="px-3 py-2 text-muted-foreground">
                  {shortDate(c.receivedAt)}
                </td>
                <td className="px-3 py-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs tabular-nums">
                      {c.sourceDocumentNo ?? "advance payment"}
                    </span>
                    <ColorBadge
                      tone={c.status === "FULLY_APPLIED" ? "gray" : "green"}
                      label={CREDIT_STATUS_LABEL[c.status]}
                    />
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {peso(c.amount)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                  {peso(c.applied)}
                </td>
                <td className="px-3 py-2 text-right font-mono font-medium tabular-nums">
                  {peso(c.remaining)}
                </td>
              </tr>
            ))}
          </Table>
        </Section>
      )}

      {/* ——— what they have paid, and what it went to ——— */}
      <Section title="Payment history" count={a.payments.length}>
        {a.payments.length === 0 ? (
          <EmptyState
            title="No payments yet"
            description="Nothing has been collected from this customer."
          />
        ) : (
          <Table
            head={[
              "Receipt",
              "Date",
              "Method",
              "Received",
              "Applied to",
              canVoid ? "" : "",
            ]}
            alignRight={[3]}
          >
            {a.payments.map((p) => {
              const isVoid = p.voidType !== null;
              return (
                <tr
                  key={p.id}
                  className={cn(
                    "border-b last:border-b-0",
                    isVoid && "bg-destructive/5"
                  )}
                >
                  <td className="px-3 py-2">
                    <span className="grid gap-0.5">
                      <span
                        className={cn(
                          "font-mono tabular-nums",
                          isVoid && "text-muted-foreground line-through"
                        )}
                      >
                        {p.documentNo ?? "Payment"}
                      </span>
                      {!p.documentIssued && (
                        <ColorBadge tone="gray" label="no receipt printed" />
                      )}
                      {isVoid && p.voidType && (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <ColorBadge
                            tone="red"
                            label={VOID_TYPE_LABEL[p.voidType].toUpperCase()}
                          />
                          <span className="text-xs text-muted-foreground">
                            {p.voidReason}
                          </span>
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    <span className="grid">
                      {shortDate(p.receivedAt)}
                      <span className="text-xs">{p.createdByName}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {p.method}
                    {p.methodDetail && (
                      <span className="block text-xs">{p.methodDetail}</span>
                    )}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right font-mono tabular-nums",
                      isVoid && "text-muted-foreground line-through"
                    )}
                  >
                    {peso(p.amount)}
                  </td>
                  <td className="px-3 py-2">
                    {/* The whole point of this page: which invoices this
                        money actually closed. */}
                    <span className="grid gap-0.5 text-xs">
                      {p.applied.length === 0 && isZero(p.creditApplied) ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        p.applied.map((x) => (
                          <span key={x.documentNo} className="font-mono tabular-nums">
                            {x.documentNo} · {peso(x.amount)}
                          </span>
                        ))
                      )}
                      {!isZero(p.creditApplied) && (
                        <span className="text-emerald-700 dark:text-emerald-300">
                          incl. {peso(p.creditApplied)} from credit
                        </span>
                      )}
                      {!isZero(p.creditCreated) && (
                        <span className="text-emerald-700 dark:text-emerald-300">
                          {peso(p.creditCreated)} left as credit
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {/* A cancelled payment is already marked; there is nothing
                        left to do to it. §5.1 step 6 wants a supervisor. */}
                    {!isVoid && canVoid && (
                      <span className="flex justify-end gap-1">
                        {p.documentIssued && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setReplacing(p)}
                          >
                            <RefreshCwIcon /> Replace
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setVoiding({
                              id: p.id,
                              kind: "COLLECTION",
                              documentNo: p.documentNo,
                              kindLabel: "Collection Receipt",
                              amount: peso(p.amount),
                            })
                          }
                        >
                          <BanIcon /> Cancel
                        </Button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Section>

      <CollectPaymentDialog
        customerId={collecting ? customerId : null}
        onClose={() => setCollecting(false)}
      />
      <CollectPaymentDialog
        customerId={replacing ? customerId : null}
        replaces={
          replacing && replacing.documentNo
            ? {
                id: replacing.id,
                documentNo: replacing.documentNo,
                amount: replacing.amount,
              }
            : null
        }
        onClose={() => setReplacing(null)}
      />
      <VoidReceiptDialog receipt={voiding} onClose={() => setVoiding(null)} />
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium">{title}</h2>
        <ColorBadge tone="gray" label={String(count)} />
      </div>
      {children}
    </div>
  );
}

function Table({
  head,
  alignRight = [],
  children,
}: {
  head: string[];
  alignRight?: number[];
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground uppercase">
          <tr>
            {head.map((h, i) => (
              <th
                key={h}
                className={cn(
                  "px-3 py-2 font-medium",
                  alignRight.includes(i) && "text-right"
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
