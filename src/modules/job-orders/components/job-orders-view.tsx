"use client";

import Link from "next/link";
import { useState } from "react";
import { useQueryState } from "nuqs";
import { format } from "date-fns";
import { PencilIcon, PlusIcon, ReceiptTextIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";
import { useDebounce } from "@/modules/shared/hooks/use-debounce";
import { ReceivePaymentDialog } from "@/modules/sales-audit/components/receive-payment-dialog";
import { useJoItemsInfinite } from "../hooks/use-job-orders";
import type { JobOrderItemRowDto } from "../schemas/job-order";
import { BoardMetrics } from "./board-metrics";
import { ImportDialog } from "./import-dialog";
import { ItemEditDialog } from "./item-edit-dialog";
import { JoEditDialog } from "./jo-edit-dialog";
import { ItemStatusBadge } from "./status-badge";

const VIEWS = [
  { value: "active", label: "Active" },
  { value: "ongoing", label: "Ongoing" },
  { value: "waiting", label: "Waiting pickup" },
  { value: "overdue", label: "Overdue" },
  { value: "custApproval", label: "Customers Approval" },
  { value: "smAlarming", label: "S&M Alarming" },
  { value: "smOverdue", label: "S&M Overdue" },
  { value: "done", label: "Archived (done)" },
  { value: "all", label: "All" },
] as const;

const COLS = 6;

export function JobOrdersView({
  canWrite,
  canImport,
  canReceivePayment = false,
}: {
  canWrite: boolean;
  canImport: boolean;
  canReceivePayment?: boolean;
}) {
  // Filters live in the URL so views are shareable and back-button friendly.
  const [q, setQ] = useQueryState("q", { defaultValue: "" });
  const [view, setView] = useQueryState("view", { defaultValue: "active" });
  const debouncedQ = useDebounce(q);
  // Row Edit opens the LINE-ITEM modal (legacy updateJORow); the whole-JO
  // editor is reachable from inside it.
  const [editingItem, setEditingItem] = useState<JobOrderItemRowDto | null>(null);
  const [editingJoId, setEditingJoId] = useState<string | null>(null);
  const [payingJoId, setPayingJoId] = useState<string | null>(null);

  const query = useJoItemsInfinite({ q: debouncedQ, view });
  const rows = query.data?.pages.flatMap((page) => page.rows) ?? [];

  // Legacy table bands rows by JO so multi-item JOs read as one group.
  const banded = new Map<string, boolean>();
  let band = false;
  let lastJo = "";
  for (const row of rows) {
    if (row.joNumber !== lastJo) {
      band = !band;
      lastJo = row.joNumber;
    }
    banded.set(row.id, band);
  }

  return (
    <div className="grid gap-4">
      <BoardMetrics activeView={view} onSelect={(next) => setView(next)} />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search JO #, customer, or description…"
          className="max-w-72"
          aria-label="Search job order items"
        />
        <Select value={view} onValueChange={(value) => setView(value as string)}>
          <SelectTrigger aria-label="Filter view">
            <SelectValue placeholder="View" />
          </SelectTrigger>
          <SelectContent>
            {VIEWS.map((v) => (
              <SelectItem key={v.value} value={v.value}>
                {v.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          {canImport && <ImportDialog />}
          {canWrite && (
            <Button nativeButton={false} render={<Link href="/job-orders/new" />}>
              <PlusIcon /> New Non-JO
            </Button>
          )}
        </div>
      </div>

      <Card className="py-0">
        <CardContent className="overflow-x-auto px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead className="min-w-64">Name</TableHead>
                <TableHead className="min-w-56">Status</TableHead>
                <TableHead>Team Status</TableHead>
                <TableHead>Assigned To</TableHead>
                <TableHead>Action</TableHead>
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
                      title="No records found"
                      description={
                        view === "active"
                          ? "Create a job order or import your legacy data to get started."
                          : "Nothing matches this view."
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className={cn(banded.get(row.id) && "bg-muted/40")}
                  >
                    <TableCell className="align-top whitespace-nowrap">
                      <div className="grid justify-items-start gap-1">
                        {/* per line item, like the legacy sheet: JO# + item suffix */}
                        <span className="font-semibold">
                          {row.lineItemId ?? row.joNumber}
                        </span>
                        {row.joIsPO && <ColorBadge tone="purple" label="PO" />}
                        {row.joIsNonJo && <ColorBadge tone="gray" label="NON-JO" />}
                        {row.isRush && <ColorBadge tone="red" label="🔥 RUSH" />}
                        {row.joIsApproved ? (
                          <ColorBadge tone="green" label="✓ Approved" />
                        ) : (
                          <ColorBadge tone="gray" label="For approval" />
                        )}
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
                          {row.deadline && (
                            <span
                              className={
                                row.isOverdue
                                  ? "font-medium text-destructive"
                                  : undefined
                              }
                            >
                              📅 {format(new Date(row.deadline), "M/d/yyyy")}
                              {!row.isDone && row.daysLeft !== null
                                ? row.daysLeft >= 0
                                  ? ` · ${row.daysLeft}d left`
                                  : ` · ${-row.daysLeft}d overdue`
                                : ""}
                            </span>
                          )}
                          <span>{formatMoney(row.lineTotal)}</span>
                          {row.isLFP && row.lfpWidth && row.lfpHeight && (
                            <ColorBadge
                              tone="amber"
                              label={`${row.lfpWidth} × ${row.lfpHeight} ${row.lfpUnit ?? ""}`}
                            />
                          )}
                          {row.category && <ColorBadge label={row.category} />}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-72 align-top">
                      {row.statusHistory ? (
                        <span className="line-clamp-5 whitespace-pre-line text-xs leading-relaxed">
                          {row.statusHistory}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="grid justify-items-start gap-1">
                        <ItemStatusBadge
                          productionStatus={row.productionStatus}
                          isDone={row.isDone}
                          isWaitingPickup={row.isWaitingPickup}
                          isOverdue={row.isOverdue}
                        />
                        {row.waitingPickupSince && !row.isDone && (
                          <span className="text-xs text-muted-foreground">
                            since {format(new Date(row.waitingPickupSince), "M/d")}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      {row.assignedTo ? (
                        <div className="flex max-w-40 flex-wrap gap-1">
                          {row.assignedTo.split(",").map((name) => (
                            <Badge key={name} variant="secondary">
                              {name.trim()}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-col items-start gap-1">
                        {canWrite && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEditingItem(row)}
                          >
                            <PencilIcon /> Edit
                          </Button>
                        )}
                        {canReceivePayment && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setPayingJoId(row.jobOrderId)}
                          >
                            <ReceiptTextIcon /> Pay
                          </Button>
                        )}
                      </div>
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

      <ItemEditDialog
        row={editingItem}
        onClose={() => setEditingItem(null)}
        onEditJo={(joId) => {
          setEditingItem(null);
          setEditingJoId(joId);
        }}
      />
      <JoEditDialog
        jobOrderId={editingJoId}
        canDelete={canImport}
        canReceivePayment={canReceivePayment}
        onClose={() => setEditingJoId(null)}
      />
      <ReceivePaymentDialog
        jobOrderId={payingJoId}
        onClose={() => setPayingJoId(null)}
      />
    </div>
  );
}

function formatMoney(value: string): string {
  const n = parseFloat(value);
  return isNaN(n)
    ? value
    : `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
}
