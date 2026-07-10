"use client";

import { useState } from "react";
import { useQueryState } from "nuqs";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
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
import { useDrList } from "../hooks/use-delivery-receipts";
import { IssueDrDialog } from "./issue-dr-dialog";
import { DrDetailDialog } from "./dr-detail-dialog";

const COLS = 7;
const peso = (v: string) => {
  const n = parseFloat(v);
  return isNaN(n) ? v : `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
};

export function DrView({
  canIssue,
  canCancel,
}: {
  canIssue: boolean;
  canCancel: boolean;
}) {
  const [q, setQ] = useQueryState("q", { defaultValue: "" });
  const debouncedQ = useDebounce(q);
  const [detailId, setDetailId] = useState<string | null>(null);

  const query = useDrList(debouncedQ);
  const rows = query.data?.pages.flatMap((p) => p.rows) ?? [];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search DR #, JO #, or customer…"
          className="max-w-72"
          aria-label="Search delivery receipts"
        />
        {canIssue && (
          <div className="ml-auto">
            <IssueDrDialog />
          </div>
        )}
      </div>

      <Card className="py-0">
        <CardContent className="overflow-x-auto px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>DR #</TableHead>
                <TableHead>JO #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Items / Qty</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Issued</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isPending ? (
                <TableSkeletonRows cols={COLS} />
              ) : query.isError ? (
                <TableRow>
                  <TableCell colSpan={COLS}>
                    <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={COLS}>
                    <EmptyState
                      title="No delivery receipts yet"
                      description="Issue a DR once a job order's items are completed."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer"
                    onClick={() => setDetailId(r.id)}
                  >
                    <TableCell className="font-medium">{r.drNumber}</TableCell>
                    <TableCell>{r.joNumber}</TableCell>
                    <TableCell>{r.customerName}</TableCell>
                    <TableCell>
                      {r.status === "CANCELLED" ? (
                        <Badge variant="destructive">Cancelled</Badge>
                      ) : (
                        <Badge variant="secondary">Issued</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {r.lineCount} / {r.totalQty}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{peso(r.amount)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {format(new Date(r.issuedAt), "M/d/yyyy")}
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

      <DrDetailDialog
        drId={detailId}
        canCancel={canCancel}
        onClose={() => setDetailId(null)}
      />
    </div>
  );
}
