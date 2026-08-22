"use client";

import { useState } from "react";
import { format } from "date-fns";
import { XIcon } from "lucide-react";
import { ColorBadge } from "@/components/color-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EmptyState,
  ErrorState,
  TableSkeletonRows,
} from "@/components/data-states";
import { useDebounce } from "@/modules/shared/hooks/use-debounce";
import type { JoPaymentDto } from "../schemas/job-order";
import {
  useTransactionsInfinite,
  type TransactionFilterParams,
} from "../hooks/use-job-orders";
import { CustomerCombobox } from "./customer-combobox";
import { ItemStatusBadge } from "./status-badge";

const COLS = 6;
const ALL = "__all__"; // shadcn Select forbids an empty-string value

type Filters = TransactionFilterParams;
const EMPTY: Filters = {};

/** Transactions History (replaces the legacy Archive JOs page): the whole JO
 *  ledger — one row per line item — with date, payment, delivery, production,
 *  customer and type filters. Read-only. */
export function TransactionsView() {
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [customerName, setCustomerName] = useState("");
  const debouncedQ = useDebounce(q);

  const query = useTransactionsInfinite({ q: debouncedQ, ...filters });
  const rows = query.data?.pages.flatMap((page) => page.rows) ?? [];

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));

  const hasFilters =
    q.trim().length > 0 ||
    Object.values(filters).some((v) => v !== undefined && v !== "");

  const clearAll = () => {
    setQ("");
    setFilters(EMPTY);
    setCustomerName("");
  };

  return (
    <div className="grid gap-4">
      {/* ── Filter bar ── */}
      <Card className="py-0">
        <CardContent className="grid gap-3 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Search" className="min-w-64 grow">
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="JO number, customer, job description…"
                aria-label="Search transactions"
              />
            </Field>
            <Field label="Customer" className="min-w-56">
              <CustomerCombobox
                value={customerName}
                onChange={(name) => {
                  setCustomerName(name);
                  // Typing/clearing the name drops a previously picked id — the
                  // filter only binds to an explicitly chosen customer.
                  if (filters.customerId) set("customerId", undefined);
                }}
                onPick={(c) => {
                  setCustomerName(c.name);
                  set("customerId", c.id);
                }}
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <Field label="From">
              <Input
                type="date"
                value={filters.from ?? ""}
                max={filters.to || undefined}
                onChange={(e) => set("from", e.target.value || undefined)}
                className="w-40"
              />
            </Field>
            <Field label="To">
              <Input
                type="date"
                value={filters.to ?? ""}
                min={filters.from || undefined}
                onChange={(e) => set("to", e.target.value || undefined)}
                className="w-40"
              />
            </Field>

            <FilterSelect
              label="Payment"
              value={filters.payment}
              onChange={(v) => set("payment", v as Filters["payment"])}
              options={[
                ["PAID", "Fully paid"],
                ["PARTIAL", "Partial"],
                ["UNPAID", "Unpaid"],
              ]}
            />
            <FilterSelect
              label="Delivery"
              value={filters.delivery}
              onChange={(v) => set("delivery", v as Filters["delivery"])}
              options={[
                ["full", "Fully delivered"],
                ["partial", "Partial"],
                ["none", "Not delivered"],
              ]}
            />
            <FilterSelect
              label="Production"
              value={filters.production}
              onChange={(v) => set("production", v as Filters["production"])}
              options={[
                ["in_progress", "In progress"],
                ["done", "Done"],
              ]}
            />
            <FilterSelect
              label="Type"
              value={filters.type}
              onChange={(v) => set("type", v as Filters["type"])}
              options={[
                ["JO", "Job Order"],
                ["PO", "Purchase Order"],
              ]}
            />

            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAll}
                className="text-muted-foreground"
              >
                <XIcon className="size-4" /> Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Ledger ── */}
      <Card className="py-0">
        <CardContent className="overflow-x-auto px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>JO Number</TableHead>
                <TableHead className="min-w-64">Name / Description</TableHead>
                <TableHead>Production</TableHead>
                <TableHead>Delivery</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isPending ? (
                <TableSkeletonRows cols={COLS} />
              ) : query.isError ? (
                <TableRow>
                  <TableCell colSpan={COLS}>
                    <ErrorState
                      message={query.error.message}
                      onRetry={() => query.refetch()}
                    />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={COLS}>
                    <EmptyState
                      title="No transactions"
                      description={
                        hasFilters
                          ? "No job orders match these filters."
                          : "Job orders appear here as they're booked."
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="align-top whitespace-nowrap">
                      <div className="grid justify-items-start gap-1">
                        <span className="font-semibold">
                          {row.lineItemId ?? row.joNumber}
                        </span>
                        {row.joIsPO && <ColorBadge tone="blue" label="PO" />}
                        {row.isRush && <ColorBadge tone="red" label="🔥 RUSH" />}
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="grid gap-0.5">
                        <span className="font-medium">{row.customerName}</span>
                        <span className="whitespace-pre-line text-muted-foreground">
                          {row.description}
                        </span>
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>QTY: {row.qty}</span>
                          {row.category && <ColorBadge label={row.category} />}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <ItemStatusBadge
                        productionStatus={row.productionStatus}
                        isDone={row.isDone}
                        isWaitingPickup={row.isWaitingPickup}
                        isOverdue={row.isOverdue}
                      />
                    </TableCell>
                    <TableCell className="align-top">
                      <DeliveryCell
                        qty={row.qty}
                        delivered={row.qtyDelivered}
                      />
                    </TableCell>
                    <TableCell className="align-top">
                      <PaymentCell payment={row.payment} />
                    </TableCell>
                    <TableCell className="align-top whitespace-nowrap text-muted-foreground">
                      {format(new Date(row.joCreatedAt), "M/d/yyyy")}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {query.hasNextPage && (
        <Button
          variant="outline"
          className="justify-self-center"
          onClick={() => query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
        >
          {query.isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`grid gap-1 ${className ?? ""}`}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** A labelled Select whose first row clears the filter (empty value). */
function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  options: [string, string][];
}) {
  return (
    <Field label={label}>
      <Select
        value={value ?? ALL}
        onValueChange={(v) => onChange(!v || v === ALL ? undefined : v)}
      >
        <SelectTrigger className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All</SelectItem>
          {options.map(([v, text]) => (
            <SelectItem key={v} value={v}>
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/** Full / partial / not-delivered, from qtyDelivered vs qty. */
function DeliveryCell({ qty, delivered }: { qty: number; delivered: number }) {
  if (delivered >= qty && qty > 0) {
    return <ColorBadge tone="green" label="Full" />;
  }
  if (delivered > 0) {
    return (
      <div className="grid justify-items-start gap-0.5">
        <ColorBadge tone="amber" label="Partial" />
        <span className="text-xs whitespace-nowrap text-muted-foreground">
          {delivered}/{qty} delivered
        </span>
      </div>
    );
  }
  return <span className="text-muted-foreground">Not delivered</span>;
}

/** Paid / partial / unpaid — same badge language as the JO board. */
function PaymentCell({ payment }: { payment?: JoPaymentDto }) {
  if (!payment) return <span className="text-muted-foreground">—</span>;
  if (payment.status === "PAID") {
    return <ColorBadge tone="green" label="✓ Paid" />;
  }
  if (payment.status === "PARTIAL") {
    return (
      <div className="grid justify-items-start gap-0.5">
        <ColorBadge tone="amber" label="Partial" />
        <span className="text-xs whitespace-nowrap text-muted-foreground">
          {formatMoney(payment.balance)} left
        </span>
      </div>
    );
  }
  return (
    <div className="grid justify-items-start gap-0.5">
      <ColorBadge tone="red" label="Unpaid" />
      <span className="text-xs whitespace-nowrap text-muted-foreground">
        {formatMoney(payment.total)} due
      </span>
    </div>
  );
}

function formatMoney(value: string): string {
  const n = Number(value);
  return isNaN(n)
    ? value
    : `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
}
