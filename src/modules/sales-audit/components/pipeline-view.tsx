"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangleIcon, ChevronRightIcon, SearchIcon } from "lucide-react";
import { fetchJson } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
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
import { ColorBadge } from "@/components/color-badge";
import { EmptyState, ErrorState, TableSkeletonRows } from "@/components/data-states";
import { cn } from "@/lib/utils";
import {
  PIPELINE_STATE,
  type PipelineDto,
  type PipelineState,
} from "../schemas/backlog";

const peso = (v: string | number) =>
  `₱${Number(v || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const cents = (v: string) => Math.round(parseFloat(v || "0") * 100);

const shortDate = (d: string) =>
  new Date(d).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

const STATE_LABEL: Record<PipelineState, string> = {
  ALL: "Everything",
  BACKLOG: "On the floor",
  UNBILLED: "Delivered, not billed",
  OVERDUE: "Past deadline",
};

export function PipelineView() {
  const [state, setState] = useState<PipelineState>("ALL");
  const [customerId, setCustomerId] = useState("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const params = new URLSearchParams({ state });
  if (customerId) params.set("customerId", customerId);
  if (search.trim()) params.set("search", search.trim());

  const pipeline = useQuery({
    queryKey: ["pipeline", state, customerId, search.trim()],
    queryFn: () => fetchJson<PipelineDto>(`/api/pipeline?${params}`),
    placeholderData: (prev) => prev,
  });

  const d = pipeline.data;

  return (
    <div className="flex flex-col gap-6">
      {/* ——— the three states ——— */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StateTile
          label="On the floor"
          value={d?.totals.backlog}
          hint="Ordered and being made. Not earned yet — no invoice, no due date."
        />
        <StateTile
          label="Delivered, not billed"
          value={d?.totals.unbilled}
          hint="Earned. Nobody is chasing this — it is on no A/R report."
          alarm={cents(d?.totals.unbilled ?? "0") > 0}
        />
        <StateTile
          label="Invoiced"
          value={d?.totals.invoiced}
          hint="Billed on these jobs. Chased on the A/R ledger, not here."
          muted
        />
        <StateTile
          label="Deposits held"
          value={d?.totals.deposits}
          hint="Downpayments on JO slips — money we hold, not revenue."
          muted
        />
      </div>

      {d && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-muted/30 px-4 py-3 text-sm">
          <span>
            <b className="tabular-nums">{peso(d.totals.offLedger)}</b> owed to us
            and <b>not on any A/R report</b> — {d.totals.jobCount} job
            {d.totals.jobCount === 1 ? "" : "s"}
          </span>
          {d.totals.overdueCount > 0 && (
            <ColorBadge
              tone="red"
              label={`${d.totals.overdueCount} past deadline`}
            />
          )}
        </div>
      )}

      {/* ——— filters ——— */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="JO number, customer, item…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          value={customerId || "ALL"}
          onValueChange={(v) => setCustomerId(!v || v === "ALL" ? "" : v)}
        >
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Every customer" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Every customer</SelectItem>
            {(d?.customers ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(Object.keys(STATE_LABEL) as PipelineState[]).map((s) => (
          <Button
            key={s}
            type="button"
            size="sm"
            variant={state === s ? "default" : "outline"}
            onClick={() => setState(PIPELINE_STATE[s])}
          >
            {STATE_LABEL[s]}
          </Button>
        ))}
      </div>

      {pipeline.isError && (
        <ErrorState
          message={
            pipeline.error instanceof Error
              ? pipeline.error.message
              : "Could not load the pipeline."
          }
          onRetry={() => pipeline.refetch()}
        />
      )}

      {/* ——— the jobs ——— */}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job order</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Deadline</TableHead>
              <TableHead className="text-right">Job value</TableHead>
              <TableHead className="text-right">On the floor</TableHead>
              <TableHead className="text-right">Not billed</TableHead>
              <TableHead className="text-right">Invoiced</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {pipeline.isLoading && <TableSkeletonRows cols={8} />}
            {d && d.jobs.length === 0 && (
              <TableRow>
                <TableCell colSpan={8}>
                  <EmptyState
                    title="Nothing in the pipeline"
                    description="Every approved job has been delivered and billed."
                  />
                </TableCell>
              </TableRow>
            )}
            {(d?.jobs ?? []).map((j) => {
              const expanded = open === j.jobOrderId;
              const unbilled = cents(j.unbilled) > 0;
              return (
                <Fragment key={j.jobOrderId}>
                  <TableRow
                    className="cursor-pointer"
                    onClick={() =>
                      setOpen(expanded ? null : j.jobOrderId)
                    }
                  >
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-1.5">
                        <ChevronRightIcon
                          className={cn(
                            "size-3.5 text-muted-foreground transition-transform",
                            expanded && "rotate-90"
                          )}
                        />
                        {j.joNumber}
                      </span>
                    </TableCell>
                    <TableCell>{j.customerName}</TableCell>
                    <TableCell>
                      {j.deadline ? (
                        <span className="flex items-center gap-1.5">
                          {shortDate(j.deadline)}
                          {j.daysLate !== null && (
                            <ColorBadge
                              tone="red"
                              label={`${j.daysLate}d late`}
                            />
                          )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {peso(j.total)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {cents(j.backlog) > 0 ? (
                        peso(j.backlog)
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        unbilled && "font-medium text-amber-700 dark:text-amber-400"
                      )}
                    >
                      {unbilled ? peso(j.unbilled) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {peso(j.invoiced)}
                    </TableCell>
                    <TableCell
                      className="text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Link
                        href={`/sales-audit/receivables/${j.customerId}`}
                        className="text-sm text-primary hover:underline"
                      >
                        Account
                      </Link>
                    </TableCell>
                  </TableRow>

                  {expanded && (
                    <TableRow>
                      <TableCell colSpan={8} className="bg-muted/30">
                        <div className="flex flex-col gap-3 py-2">
                          {unbilled && (
                            <p className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
                              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                              <span>
                                <b>{peso(j.unbilled)}</b> of this job has been
                                delivered and never invoiced. It is not on the
                                aging report and it counts against no credit
                                limit — nobody is chasing it.
                              </span>
                            </p>
                          )}

                          {j.openItems.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                              Everything on this job has been delivered.
                            </p>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                                  <tr>
                                    <th className="py-1 text-left font-medium">
                                      Still to deliver
                                    </th>
                                    <th className="py-1 text-left font-medium">
                                      Status
                                    </th>
                                    <th className="py-1 text-right font-medium">
                                      Qty
                                    </th>
                                    <th className="py-1 text-right font-medium">
                                      Delivered
                                    </th>
                                    <th className="py-1 text-right font-medium">
                                      Line total
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {j.openItems.map((i) => (
                                    <tr key={i.id} className="border-t">
                                      {/* Never truncated — AGENTS.md. */}
                                      <td className="py-1.5 pr-4">
                                        {i.description}
                                      </td>
                                      <td className="py-1.5 pr-4 text-muted-foreground">
                                        {i.productionStatus ?? "—"}
                                      </td>
                                      <td className="py-1.5 text-right tabular-nums">
                                        {i.qty}
                                      </td>
                                      <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                                        {i.qtyDelivered}
                                      </td>
                                      <td className="py-1.5 text-right tabular-nums">
                                        {peso(i.lineTotal)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}

                          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                            <span>Status: {j.status.replace(/_/g, " ")}</span>
                            <span>Delivered value: {peso(j.deliveredValue)}</span>
                            {cents(j.deposits) > 0 && (
                              <span>
                                Deposits held: {peso(j.deposits)} — not revenue
                                until an invoice is raised
                              </span>
                            )}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        Approved, in-progress, completed and invoiced job orders only — drafts
        and cancelled work are excluded. A job leaves this report once it is
        fully delivered and fully invoiced; from then on it is the A/R ledger&rsquo;s.
      </p>
    </div>
  );
}

function StateTile({
  label,
  value,
  hint,
  alarm,
  muted,
}: {
  label: string;
  value: string | undefined;
  hint: string;
  alarm?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        alarm && "border-amber-500/40 bg-amber-50 dark:bg-amber-500/10"
      )}
    >
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          alarm && "text-amber-700 dark:text-amber-300",
          muted && "text-muted-foreground"
        )}
      >
        {value === undefined ? "—" : peso(value)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
