"use client";

import { useState } from "react";
import { PlusIcon } from "lucide-react";
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
import { EmptyState, ErrorState, TableSkeletonRows } from "@/components/data-states";
import { useDebounce } from "@/modules/shared/hooks/use-debounce";
import { useMaterials } from "../hooks/use-inventory";
import { MaterialFormDialog } from "./material-form-dialog";
import { MaterialDetailDialog } from "./material-detail-dialog";

const COLS = 7;
const peso = (v: string) => {
  const n = parseFloat(v);
  return isNaN(n) ? v : `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
};

export function MaterialsTab({ canMaintain }: { canMaintain: boolean }) {
  const [q, setQ] = useState("");
  const debouncedQ = useDebounce(q);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const query = useMaterials({ q: debouncedQ });
  const rows = query.data?.pages.flatMap((p) => p.rows) ?? [];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search code, name, or category…"
          className="max-w-72"
          aria-label="Search items"
        />
        {canMaintain && (
          <Button className="ml-auto" onClick={() => setAdding(true)}>
            <PlusIcon /> Add item
          </Button>
        )}
      </div>

      <Card className="py-0">
        <CardContent className="overflow-x-auto px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead className="text-right">Unit cost</TableHead>
                <TableHead className="text-right">Stock value</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Status</TableHead>
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
                      title="No items yet"
                      description="Add your first inventory item to start tracking stock."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => setDetailId(r.id)}>
                    <TableCell className="font-mono font-medium">{r.code}</TableCell>
                    <TableCell className="min-w-48 max-w-md">
                      <div className="wrap-break-word">{r.name}</div>
                      {r.category && <div className="text-xs text-muted-foreground">{r.category}</div>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <div className="flex items-center justify-end gap-1.5">
                        {r.belowReorder && <Badge variant="destructive" className="font-normal">Low</Badge>}
                        <span className="font-medium">{r.onHand.toLocaleString()}</span>
                        <span className="text-xs text-muted-foreground">{r.unit}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{peso(r.unitCost)}</TableCell>
                    <TableCell className="text-right tabular-nums">{peso(r.stockValue)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.supplier?.name ?? "—"}</TableCell>
                    <TableCell>
                      {r.status === "ACTIVE" ? (
                        <Badge variant="secondary">Active</Badge>
                      ) : (
                        <Badge variant="outline">Inactive</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {query.hasNextPage && (
        <Button variant="outline" className="justify-self-center" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
          {query.isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>
      )}

      <MaterialFormDialog open={adding} onOpenChange={setAdding} />
      <MaterialDetailDialog id={detailId} canMaintain={canMaintain} onClose={() => setDetailId(null)} />
    </div>
  );
}
