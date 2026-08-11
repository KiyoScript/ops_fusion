"use client";

import { useState } from "react";
import { format } from "date-fns";
import { PlusIcon } from "lucide-react";
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
import { useMaterialRequests } from "../hooks/use-inventory";
import { MrFormDialog } from "./mr-form-dialog";
import { MrDetailDialog, MrStatusBadge } from "./mr-detail-dialog";

const COLS = 6;
const ALL = "ALL";
const peso = (v: string) => {
  const n = parseFloat(v);
  return isNaN(n) ? v : `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
};

export function MaterialRequestsTab({
  canCreate,
  canApprove,
  canRelease,
}: {
  canCreate: boolean;
  canApprove: boolean;
  canRelease: boolean;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>(ALL);
  const debouncedQ = useDebounce(q);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const query = useMaterialRequests({ q: debouncedQ, status: status === ALL ? undefined : status });
  const rows = query.data?.pages.flatMap((p) => p.rows) ?? [];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search MR #, JO #, or purpose…" className="max-w-64" aria-label="Search material requests" />
        <Select value={status} onValueChange={(v) => setStatus(v ?? ALL)}>
          <SelectTrigger aria-label="Filter by status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="APPROVED">Approved</SelectItem>
            <SelectItem value="PARTIALLY_RELEASED">Partially released</SelectItem>
            <SelectItem value="RELEASED">Released</SelectItem>
            <SelectItem value="REJECTED">Rejected</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        {canCreate && <Button className="ml-auto" onClick={() => setAdding(true)}><PlusIcon /> New request</Button>}
      </div>

      <Card className="py-0">
        <CardContent className="overflow-x-auto px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>MR #</TableHead>
                <TableHead>For</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Items / Qty</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead>Requested</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isPending ? (
                <TableSkeletonRows cols={COLS} />
              ) : query.isError ? (
                <TableRow><TableCell colSpan={COLS}><ErrorState message={query.error.message} onRetry={() => query.refetch()} /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={COLS}><EmptyState title="No material requests" description="Request materials against a job order to issue stock from inventory." /></TableCell></TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => setDetailId(r.id)}>
                    <TableCell className="font-mono font-medium">{r.number}</TableCell>
                    <TableCell className="text-sm">
                      {r.joNumber ? <span className="font-medium">{r.joNumber}</span> : <span className="text-muted-foreground">{r.purpose ?? "Shop use"}</span>}
                    </TableCell>
                    <TableCell><MrStatusBadge status={r.status} /></TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{r.lineCount} / {r.totalQtyNeeded}</TableCell>
                    <TableCell className="text-right tabular-nums">{peso(r.costOfMaterials)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.requestedByName}<br />{format(new Date(r.requestedAt), "M/d/yyyy h:mma")}</TableCell>
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

      <MrFormDialog open={adding} onOpenChange={setAdding} />
      <MrDetailDialog id={detailId} canApprove={canApprove} canRelease={canRelease} canCreate={canCreate} onClose={() => setDetailId(null)} />
    </div>
  );
}
