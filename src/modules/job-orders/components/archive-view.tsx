"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { ColorBadge } from "@/components/color-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { useJoItemsInfinite } from "../hooks/use-job-orders";
import { ItemStatusBadge } from "./status-badge";

const COLS = 6;

/** Legacy ArchiveJOs page: read-only list of archived items, most recently
 *  archived first — same six columns, same search. */
export function ArchiveView() {
  const [q, setQ] = useState("");
  const debouncedQ = useDebounce(q);
  const query = useJoItemsInfinite({ q: debouncedQ, view: "done" });
  const rows = query.data?.pages.flatMap((page) => page.rows) ?? [];

  return (
    <div className="grid gap-4">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by JO number, customer, job description…"
        className="max-w-96"
        aria-label="Search archived job orders"
      />

      <Card className="py-0">
        <CardContent className="overflow-x-auto px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>JO Number</TableHead>
                <TableHead className="min-w-64">Name / Description</TableHead>
                <TableHead className="min-w-56">Status History</TableHead>
                <TableHead>Team Status</TableHead>
                <TableHead>Assigned To</TableHead>
                <TableHead>Date Archived</TableHead>
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
                      title="No archived items"
                      description="Items land here when their status is marked Done, or when a JO is archived."
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
                          {row.deadline && (
                            <span>
                              📅 {format(new Date(row.deadline), "M/d/yyyy")}
                            </span>
                          )}
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
                      <ItemStatusBadge
                        productionStatus={row.productionStatus}
                        isDone
                        isWaitingPickup={false}
                        isOverdue={false}
                      />
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
                    <TableCell className="align-top whitespace-nowrap">
                      {row.archivedAt
                        ? format(new Date(row.archivedAt), "M/d/yyyy")
                        : "—"}
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
