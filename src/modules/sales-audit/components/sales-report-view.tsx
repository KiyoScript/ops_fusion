"use client";

import { useState } from "react";
import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, ErrorState, TableSkeletonRows } from "@/components/data-states";
import { cn } from "@/lib/utils";
import {
  RECEIPT_KIND_LABEL,
  SALES_GRANULARITY,
  type ReceiptKind,
  type SalesGranularity,
} from "../schemas/receipt";
import { salesReportXlsxUrl, useSalesReport } from "../hooks/use-sales-report";

const peso = (v: string | number) =>
  `₱${Number(v || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The ranges people actually ask for, so nobody types two dates for "July". */
function presets(): { label: string; from: string; to: string }[] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const startOfMonth = new Date(y, m, 1);
  const startOfLastMonth = new Date(y, m - 1, 1);
  const endOfLastMonth = new Date(y, m, 0);
  const quarterStart = new Date(y, Math.floor(m / 3) * 3, 1);
  return [
    { label: "This month", from: iso(startOfMonth), to: iso(now) },
    { label: "Last month", from: iso(startOfLastMonth), to: iso(endOfLastMonth) },
    { label: "This quarter", from: iso(quarterStart), to: iso(now) },
    { label: "This year", from: iso(new Date(y, 0, 1)), to: iso(now) },
  ];
}

const GRANULARITY_LABEL: Record<SalesGranularity, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
};

/**
 * The four kinds that book revenue — a JO slip paid in full is the walk-in's
 * sale document. Slips TAGGED as downpayments and collections are money but
 * not sales, so both sit BELOW the total and the rows above always add up.
 */
const REVENUE_KINDS: ReceiptKind[] = [
  "SI_VAT",
  "SI_NON_VAT",
  "SI_CHARGE",
  "JO_RECEIPT",
];

export function SalesReportView() {
  const initial = presets()[0]!;
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [groupBy, setGroupBy] = useState<SalesGranularity>("day");

  const params = { from, to, groupBy };
  const report = useSalesReport(params, Boolean(from && to && from <= to));
  const r = report.data;

  // Bars are scaled to the biggest period in view, not to the total — the
  // question a period table answers is "which weeks were big", and scaling to
  // the total flattens every bar into an unreadable sliver.
  const peakPeriod = Math.max(
    1,
    ...(r?.byPeriod ?? []).map((p) => Number(p.gross))
  );

  return (
    <div className="flex flex-col gap-6">
      {/* ——— range ——— */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <Label htmlFor="rpt-from" className="text-xs text-muted-foreground">
            From
          </Label>
          <Input
            id="rpt-from"
            type="date"
            className="w-40"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="rpt-to" className="text-xs text-muted-foreground">
            To
          </Label>
          <Input
            id="rpt-to"
            type="date"
            className="w-40"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {presets().map((p) => (
            <Button
              key={p.label}
              type="button"
              size="sm"
              variant={from === p.from && to === p.to ? "default" : "outline"}
              onClick={() => {
                setFrom(p.from);
                setTo(p.to);
              }}
            >
              {p.label}
            </Button>
          ))}
        </div>

        <div className="ml-auto flex items-end gap-3">
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">Group by</Label>
            <div className="flex gap-1.5">
              {SALES_GRANULARITY.map((g) => (
                <Button
                  key={g}
                  type="button"
                  size="sm"
                  variant={groupBy === g ? "default" : "outline"}
                  onClick={() => setGroupBy(g)}
                >
                  {GRANULARITY_LABEL[g]}
                </Button>
              ))}
            </div>
          </div>
          <a
            href={salesReportXlsxUrl(params)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm font-medium",
              "hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              !r && "pointer-events-none opacity-50"
            )}
            aria-disabled={!r}
          >
            <DownloadIcon className="size-4" />
            Excel
          </a>
        </div>
      </div>

      {from > to && (
        <ErrorState message="The range ends before it starts." />
      )}
      {report.isError && (
        <ErrorState
          message={
            report.error instanceof Error
              ? report.error.message
              : "Could not build the report."
          }
          onRetry={() => report.refetch()}
        />
      )}

      {/* ——— the headline figures ——— */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Gross sales"
          value={r?.totals.gross}
          hint={
            r
              ? `${r.totals.count} receipt${r.totals.count === 1 ? "" : "s"} over ${r.days} day${r.days === 1 ? "" : "s"}`
              : undefined
          }
          emphasis
        />
        <StatTile
          label="VAT-able sales"
          value={r?.totals.vatableSales}
          hint="Net of VAT — the base for BIR reporting"
        />
        <StatTile
          label="Output VAT"
          value={r?.totals.vatAmount}
          hint="Backed out of the VAT series"
        />
        <StatTile
          label="Collected"
          value={r?.totals.collected}
          hint={
            r
              ? `${r.totals.collectionCount} collection${r.totals.collectionCount === 1 ? "" : "s"} — cash in, not revenue`
              : undefined
          }
          muted
        />
      </div>

      {r && Number(r.totals.deposits) > 0 && (
        <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
          <b className="tabular-nums">{peso(r.totals.deposits)}</b> taken as
          downpayments on {r.totals.depositCount} JO slip
          {r.totals.depositCount === 1 ? "" : "s"} — money held against work not
          yet billed, so it is not in gross sales either.
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Collections and JO downpayments are shown apart from sales on purpose.
        A collection settles an invoice whose revenue was already booked, and a
        downpayment is money held against work not yet billed — counting either
        as a sale would report the same peso twice, or report a sale that has
        not happened. Cancelled receipts are excluded throughout.
      </p>

      {/* ——— by receipt kind ——— */}
      <section className="grid gap-2">
        <h2 className="text-sm font-medium">Where the sales came from</h2>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Receipt</TableHead>
                <TableHead className="text-right">Count</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">VAT-able</TableHead>
                <TableHead className="text-right">Output VAT</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!r && <TableSkeletonRows cols={5} rows={4} />}
              {r &&
                REVENUE_KINDS.map((k) => (
                  <TableRow key={k}>
                    <TableCell>{RECEIPT_KIND_LABEL[k]}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.byType[k].count}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {peso(r.byType[k].gross)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {peso(r.byType[k].vatableSales)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {peso(r.byType[k].vatAmount)}
                    </TableCell>
                  </TableRow>
                ))}
              {r && (
                <TableRow className="border-t-2 font-medium">
                  <TableCell>Gross sales</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.totals.count}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {peso(r.totals.gross)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {peso(r.totals.vatableSales)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {peso(r.totals.vatAmount)}
                  </TableCell>
                </TableRow>
              )}
              {/* A memo line, not a total: this money is already counted
                  above, in the JO receipts row. */}
              {r && r.totals.depositCount > 0 && (
                <TableRow className="text-muted-foreground">
                  <TableCell>
                    of which downpayments
                    <span className="ml-2 text-xs">
                      customer has not collected the job yet
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.totals.depositCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {peso(r.totals.deposits)}
                  </TableCell>
                  <TableCell />
                  <TableCell />
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* ——— over time ——— */}
      <section className="grid gap-2">
        <h2 className="text-sm font-medium">
          Sales by {GRANULARITY_LABEL[groupBy].toLowerCase()}
        </h2>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead className="w-2/5">Gross</TableHead>
                <TableHead className="text-right">Receipts</TableHead>
                <TableHead className="text-right">Output VAT</TableHead>
                <TableHead className="text-right">Collected</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!r && <TableSkeletonRows cols={5} />}
              {r && r.byPeriod.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <EmptyState
                      title="Nothing in this range"
                      description="No receipts were issued between these dates."
                    />
                  </TableCell>
                </TableRow>
              )}
              {(r?.byPeriod ?? []).map((p) => (
                <TableRow key={p.key}>
                  <TableCell className="whitespace-nowrap">{p.label}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {/* One measure, one hue. `collected` is a different
                          scale and stays a number — drawing both would be a
                          two-axis chart wearing a table. */}
                      <div
                        className="h-2 min-w-0.5 rounded-full bg-primary"
                        style={{
                          width: `${Math.max((Number(p.gross) / peakPeriod) * 100, 1)}%`,
                        }}
                      />
                      <span className="shrink-0 font-medium tabular-nums">
                        {peso(p.gross)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {p.count}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {peso(p.vatAmount)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {peso(p.collected)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* ——— who bought ——— */}
      <section className="grid gap-2">
        <h2 className="text-sm font-medium">Sales by customer</h2>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead className="w-2/5">Gross</TableHead>
                <TableHead className="text-right">Receipts</TableHead>
                <TableHead className="text-right">Share</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!r && <TableSkeletonRows cols={4} />}
              {r && r.byCustomer.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4}>
                    <EmptyState title="No customers in this range" />
                  </TableCell>
                </TableRow>
              )}
              {(r?.byCustomer ?? []).map((c) => (
                <TableRow key={c.customerId}>
                  <TableCell className="font-medium">
                    {c.customerName}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div
                        className="h-2 min-w-0.5 rounded-full bg-primary"
                        style={{ width: `${Math.max(c.sharePct, 1)}%` }}
                      />
                      <span className="shrink-0 tabular-nums">
                        {peso(c.gross)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {c.count}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {c.sharePct}%
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

function StatTile({
  label,
  value,
  hint,
  emphasis,
  muted,
}: {
  label: string;
  value: string | undefined;
  hint?: string;
  emphasis?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 font-semibold tabular-nums",
          emphasis ? "text-3xl" : "text-2xl",
          muted && "text-muted-foreground"
        )}
      >
        {value === undefined ? "—" : peso(value)}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
