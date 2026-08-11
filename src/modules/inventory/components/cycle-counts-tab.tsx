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
import { useCycleCounts } from "../hooks/use-inventory";
import { CycleCountFormDialog } from "./cycle-count-form-dialog";
import { CycleCountDetailDialog } from "./cycle-count-detail-dialog";

const COLS = 6;
const ALL = "ALL";

function StatusBadge({ status }: { status: string }) {
  if (status === "APPROVED") return <Badge variant="secondary">Approved</Badge>;
  if (status === "COMPLETED") return <Badge variant="outline">Awaiting approval</Badge>;
  if (status === "CANCELLED") return <Badge variant="destructive">Cancelled</Badge>;
  return <Badge variant="outline">Draft</Badge>;
}

export function CycleCountsTab({ canCreate, canApprove }: { canCreate: boolean; canApprove: boolean }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>(ALL);
  const debouncedQ = useDebounce(q);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const query = useCycleCounts({ q: debouncedQ, status: status === ALL ? undefined : status });
  const rows = query.data?.pages.flatMap((p) => p.rows) ?? [];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search CC # or location…" className="max-w-64" aria-label="Search cycle counts" />
        <Select value={status} onValueChange={(v) => setStatus(v ?? ALL)}>
          <SelectTrigger aria-label="Filter by status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            <SelectItem value="DRAFT">Draft</SelectItem>
            <SelectItem value="COMPLETED">Awaiting approval</SelectItem>
            <SelectItem value="APPROVED">Approved</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        {canCreate && (
          <Button className="ml-auto" onClick={() => setAdding(true)}><PlusIcon /> New count</Button>
        )}
      </div>

      <Card className="py-0">
        <CardContent className="overflow-x-auto px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>CC #</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Location</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="text-right">Net variance</TableHead>
                <TableHead>Counted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isPending ? (
                <TableSkeletonRows cols={COLS} />
              ) : query.isError ? (
                <TableRow><TableCell colSpan={COLS}><ErrorState message={query.error.message} onRetry={() => query.refetch()} /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={COLS}><EmptyState title="No cycle counts" description="Record a physical count to reconcile system stock." /></TableCell></TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => setDetailId(r.id)}>
                    <TableCell className="font-mono font-medium">{r.number}</TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.location ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{r.lineCount}</TableCell>
                    <TableCell className={`text-right font-medium tabular-nums ${r.netVariance < 0 ? "text-destructive" : r.netVariance > 0 ? "text-emerald-600" : ""}`}>
                      {r.netVariance > 0 ? `+${r.netVariance}` : r.netVariance}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.countedByName}<br />{format(new Date(r.countedAt), "M/d/yyyy h:mma")}
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

      <CycleCountFormDialog open={adding} onOpenChange={setAdding} />
      <CycleCountDetailDialog id={detailId} canApprove={canApprove} canManage={canCreate} onClose={() => setDetailId(null)} />
    </div>
  );
}
