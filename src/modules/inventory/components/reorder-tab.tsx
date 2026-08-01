"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, ErrorState, TableSkeletonRows } from "@/components/data-states";
import { useReorder } from "../hooks/use-inventory";

const COLS = 6;

export function ReorderTab() {
  const query = useReorder();
  const rows = query.data ?? [];

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Active items whose on-hand has fallen below their reorder level — most short first.
      </p>
      <Card className="py-0">
        <CardContent className="overflow-x-auto px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead className="text-right">Reorder level</TableHead>
                <TableHead className="text-right">Short by</TableHead>
                <TableHead>Supplier</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isPending ? (
                <TableSkeletonRows cols={COLS} />
              ) : query.isError ? (
                <TableRow><TableCell colSpan={COLS}><ErrorState message={query.error.message} onRetry={() => query.refetch()} /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={COLS}><EmptyState title="All stocked up" description="No items are below their reorder level." /></TableCell></TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono font-medium">{r.code}</TableCell>
                    <TableCell className="min-w-40 max-w-md">
                      <div className="wrap-break-word">{r.name}</div>
                      {r.category && <div className="text-xs text-muted-foreground">{r.category}</div>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.onHand.toLocaleString()} {r.unit}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{r.reorderLevel.toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="destructive" className="tabular-nums">−{r.shortBy.toLocaleString()}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.supplierName ?? "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
