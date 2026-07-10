"use client";

import { useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { CopyIcon, PrinterIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { EmptyState, ErrorState } from "@/components/data-states";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useJoReports } from "../hooks/use-job-orders";
import type { EodReportDto, ReportRowDto } from "../schemas/job-order";

const peso = (v: string) => {
  const n = parseFloat(v);
  return isNaN(n)
    ? v
    : `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
};

export function ReportsView() {
  const [asOf, setAsOf] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const query = useJoReports(asOf);

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <div className="grid gap-1.5">
          <Label htmlFor="report-date">As of date</Label>
          <Input
            id="report-date"
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value || format(new Date(), "yyyy-MM-dd"))}
            className="max-w-44"
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <PrinterIcon /> Print
        </Button>
      </div>

      {query.isError ? (
        <Card><ErrorState message={query.error.message} onRetry={() => query.refetch()} /></Card>
      ) : (
        <>
          <EodSummary eod={query.data?.eod} loading={query.isPending} />
          <DeptReport rows={query.data?.rows ?? []} loading={query.isPending} />
        </>
      )}
    </div>
  );
}

/* ── End-of-day summary (legacy computeEODStats_) ── */
function EodSummary({ eod, loading }: { eod?: EodReportDto; loading: boolean }) {
  const copy = () => {
    if (!eod) return;
    navigator.clipboard.writeText(eod.text).then(
      () => toast.success("EOD report copied."),
      () => toast.error("Copy failed.")
    );
  };

  const kpis = eod && [
    { label: "Received today", v: eod.receivedToday.count, sub: peso(eod.receivedToday.amount), tone: "" },
    { label: "Active (total)", v: eod.active.count, sub: peso(eod.active.amount), tone: "" },
    { label: "Overdue", v: eod.overdue.count, sub: peso(eod.overdue.amount), tone: "red" },
    { label: "Due today", v: eod.dueToday.count, sub: peso(eod.dueToday.amount), tone: "amber" },
    { label: "Due in 1–3 days", v: eod.due1to3, sub: "", tone: "amber" },
    { label: "Ongoing", v: eod.ongoing, sub: "", tone: "blue" },
    { label: "Waiting", v: eod.waiting, sub: "blocked", tone: "gray" },
    { label: "Released today", v: eod.releasedToday, sub: "", tone: "green" },
    { label: "Cancelled today", v: eod.cancelledToday, sub: "", tone: "gray" },
    { label: "No deadline", v: eod.noDeadline, sub: "needs encoding", tone: "gray" },
  ];

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>
          EOD Summary{eod ? ` · ${eod.dateLabel}` : ""}
        </CardTitle>
        {eod && (
          <Button variant="outline" size="sm" onClick={copy} className="print:hidden">
            <CopyIcon /> Copy report
          </Button>
        )}
      </CardHeader>
      <CardContent className="grid gap-4">
        {loading || !kpis ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-5">
              {kpis.map((k) => (
                <div key={k.label} className="rounded-xl border p-3">
                  <div className="text-xs text-muted-foreground">{k.label}</div>
                  <div
                    className={cn(
                      "text-2xl font-semibold tabular-nums",
                      k.tone === "red" && "text-red-600 dark:text-red-400",
                      k.tone === "amber" && "text-amber-600 dark:text-amber-400",
                      k.tone === "green" && "text-emerald-600 dark:text-emerald-400",
                      k.tone === "blue" && "text-blue-600 dark:text-blue-400"
                    )}
                  >
                    {k.v}
                  </div>
                  {k.sub && <div className="text-xs text-muted-foreground">{k.sub}</div>}
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">Overdue · S&amp;M: {eod!.overdueSM}</Badge>
              <Badge variant="outline">Due today · S&amp;M: {eod!.dueTodaySM}</Badge>
              {eod!.overdueYesterday !== null && (
                <Badge variant="ghost">
                  Overdue vs yesterday: {eod!.overdueYesterday}
                  {eod!.overdue.count < eod!.overdueYesterday
                    ? " ▼"
                    : eod!.overdue.count > eod!.overdueYesterday
                      ? " ▲"
                      : " ="}
                </Badge>
              )}
              {eod!.longestOverdueDays > 0 && (
                <Badge variant="destructive">
                  Longest overdue: {eod!.longestOverdueDays}d ({eod!.longestOverdueCount})
                </Badge>
              )}
            </div>

            {/* Monospace report — exact legacy layout, copy/print friendly */}
            <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-xs leading-relaxed">
              {eod!.text}
            </pre>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ── JO Report by Department (legacy getJOReportAllDepts) ── */
function DeptReport({ rows, loading }: { rows: ReportRowDto[]; loading: boolean }) {
  return (
    <Card className="py-0">
      <CardHeader className="px-6 pt-5">
        <CardTitle>JO Report by Department <span className="text-sm font-normal text-muted-foreground">({rows.length} active items)</span></CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto px-0 pb-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>JO # / Item</TableHead>
              <TableHead>Customer / Description</TableHead>
              <TableHead>Team Status</TableHead>
              <TableHead>Deadline</TableHead>
              <TableHead className="text-right">Days Left</TableHead>
              <TableHead>Assigned</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((_, c) => (
                    <TableCell key={c}><Skeleton className="h-4 w-full max-w-28" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={7}><EmptyState title="No active items" /></TableCell></TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="align-top whitespace-nowrap font-medium">{r.lineItemId}</TableCell>
                  <TableCell className="align-top">
                    <div className="font-medium">{r.customerName}</div>
                    <div className="whitespace-pre-line text-xs text-muted-foreground">{r.description}</div>
                    <div className="text-xs text-muted-foreground">QTY: {r.qty}</div>
                  </TableCell>
                  <TableCell className="align-top">{r.statusDepartment ?? "—"}</TableCell>
                  <TableCell className="align-top whitespace-nowrap">
                    {r.deadline ? format(new Date(r.deadline), "M/d/yyyy") : "—"}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "align-top text-right tabular-nums",
                      r.daysLeft !== null && r.daysLeft < 0 && "font-medium text-red-600 dark:text-red-400"
                    )}
                  >
                    {r.daysLeft ?? "—"}
                  </TableCell>
                  <TableCell className="align-top">{r.assignedTo ?? "—"}</TableCell>
                  <TableCell className="align-top text-right tabular-nums">{peso(r.lineTotal)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
