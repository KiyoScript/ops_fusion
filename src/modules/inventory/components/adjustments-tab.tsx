"use client";

import { useState } from "react";
import { format } from "date-fns";
import { PlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { EmptyState, ErrorState, TableSkeletonRows } from "@/components/data-states";
import { useDebounce } from "@/modules/shared/hooks/use-debounce";
import { useAdjustments } from "../hooks/use-inventory";
import { AdjustmentFormDialog } from "./adjustment-form-dialog";
import { AdjustmentDetailDialog } from "./adjustment-detail-dialog";

const COLS = 6;
const ALL = "ALL";

function StatusBadge({ status }: { status: string }) {
  if (status === "APPROVED") return <Badge variant="secondary">Approved</Badge>;
  if (status === "REJECTED") return <Badge variant="destructive">Rejected</Badge>;
  return <Badge variant="outline">Pending</Badge>;
}

export function AdjustmentsTab({ canCreate, canApprove }: { canCreate: boolean; canApprove: boolean }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>(ALL);
  const debouncedQ = useDebounce(q);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const query = useAdjustments({ q: debouncedQ, status: status === ALL ? undefined : status });
  const rows = query.data?.pages.flatMap((p) => p.rows) ?? [];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ADJ # or reason…" className="max-w-64" aria-label="Search adjustments" />
        <Select value={status} onValueChange={(v) => setStatus(v ?? ALL)}>
          <SelectTrigger aria-label="Filter by status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="APPROVED">Approved</SelectItem>
            <SelectItem value="REJECTED">Rejected</SelectItem>
          </SelectContent>
        </Select>
        {canCreate && (
          <Button className="ml-auto" onClick={() => setAdding(true)}><PlusIcon /> New adjustment</Button>
        )}
      </div>

      <Card className="py-0">
        <CardContent className="overflow-x-auto px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ADJ #</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Net qty</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead>Decided</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isPending ? (
                <TableSkeletonRows cols={COLS} />
              ) : query.isError ? (
                <TableRow><TableCell colSpan={COLS}><ErrorState message={query.error.message} onRetry={() => query.refetch()} /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={COLS}><EmptyState title="No adjustments" description="Stock corrections you submit appear here for approval." /></TableCell></TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => setDetailId(r.id)}>
                    <TableCell className="font-mono font-medium">{r.number}</TableCell>
                    <TableCell className="min-w-40 max-w-md wrap-break-word">{r.reason}</TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                    <TableCell className={`text-right font-medium tabular-nums ${r.netQty < 0 ? "text-destructive" : r.netQty > 0 ? "text-emerald-600" : ""}`}>
                      {r.netQty > 0 ? `+${r.netQty}` : r.netQty}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.requestedByName}<br />{format(new Date(r.requestedAt), "M/d/yyyy")}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.decidedByName ? <>{r.decidedByName}<br />{r.decidedAt && format(new Date(r.decidedAt), "M/d/yyyy")}</> : "—"}
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

      <AdjustmentFormDialog open={adding} onOpenChange={setAdding} />
      <AdjustmentDetailDialog id={detailId} canApprove={canApprove} onClose={() => setDetailId(null)} />
    </div>
  );
}
