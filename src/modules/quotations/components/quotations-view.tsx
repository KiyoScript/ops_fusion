"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryState } from "nuqs";
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
import {
  EmptyState,
  ErrorState,
  TableSkeletonRows,
} from "@/components/data-states";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/modules/shared/hooks/use-debounce";
import { useQuotationsInfinite } from "../hooks/use-quotations";
import { ColorBadge, type BadgeTone } from "@/components/color-badge";
import { QuotationStatusBadge } from "./quotation-status-badge";

const STATUS_VIEWS = [
  { value: "open", label: "Open" },
  { value: "DRAFT", label: "Draft" },
  { value: "PENDING_APPROVAL", label: "Pending approval" },
  { value: "APPROVED", label: "Approved" },
  { value: "SENT", label: "Sent" },
  { value: "REJECTED", label: "Rejected" },
  { value: "CONVERTED", label: "Converted" },
  { value: "all", label: "All" },
] as const;

const TYPE_VIEWS = [
  { value: "all", label: "All types" },
  { value: "SALES", label: "Sales" },
  { value: "PO", label: "PO" },
  { value: "NON_JO", label: "Non-JO" },
] as const;

const TYPE_BADGES: Record<string, { tone: BadgeTone; label: string }> = {
  SALES: { tone: "blue", label: "Sales" },
  PO: { tone: "purple", label: "PO" },
  NON_JO: { tone: "amber", label: "Non-JO" },
};

const COLS = 8;

export function QuotationsView({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  // Filters live in the URL so views are shareable and back-button friendly.
  const [q, setQ] = useQueryState("q", { defaultValue: "" });
  const [status, setStatus] = useQueryState("status", { defaultValue: "open" });
  const [type, setType] = useQueryState("type", { defaultValue: "all" });
  const debouncedQ = useDebounce(q);

  const query = useQuotationsInfinite({ q: debouncedQ, status, type });
  const rows = query.data?.pages.flatMap((page) => page.rows) ?? [];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search quote # or customer…"
          className="max-w-72"
          aria-label="Search quotations"
        />
        <Select value={type} onValueChange={(value) => setType(value as string)}>
          <SelectTrigger aria-label="Filter by type">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            {TYPE_VIEWS.map((v) => (
              <SelectItem key={v.value} value={v.value}>
                {v.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(value) => setStatus(value as string)}>
          <SelectTrigger aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_VIEWS.map((v) => (
              <SelectItem key={v.value} value={v.value}>
                {v.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canWrite && (
          <div className="ml-auto">
            <Button nativeButton={false} render={<Link href="/quotations/new" />}>
              <PlusIcon /> New Quotation
            </Button>
          </div>
        )}
      </div>

      <Card className="py-0">
        <CardContent className="overflow-x-auto px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quote #</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="min-w-56">Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Valid until</TableHead>
                <TableHead>Created</TableHead>
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
                      title="No quotations found"
                      description={
                        canWrite
                          ? "Create the first quotation to get started."
                          : "Nothing matches the current filters."
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/quotations/${row.id}`)}
                  >
                    <TableCell>
                      <Link
                        href={`/quotations/${row.id}`}
                        className="font-medium hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {row.quoteNumber}
                      </Link>
                      {row.poNumber && (
                        <p className="text-xs text-muted-foreground">
                          PO: {row.poNumber}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <ColorBadge
                        tone={TYPE_BADGES[row.type]?.tone ?? "gray"}
                        label={TYPE_BADGES[row.type]?.label ?? row.type}
                      />
                    </TableCell>
                    <TableCell className="max-w-64 truncate">
                      {row.customerName}
                    </TableCell>
                    <TableCell>
                      <QuotationStatusBadge
                        status={row.status}
                        isExpired={row.isExpired}
                      />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.itemCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.total)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "whitespace-nowrap",
                        row.isExpired && "text-destructive"
                      )}
                    >
                      {row.validUntil
                        ? format(new Date(`${row.validUntil}T00:00:00`), "MMM d, yyyy")
                        : "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {format(new Date(row.createdAt), "MMM d, yyyy")}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {query.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}

function formatMoney(value: string): string {
  const n = parseFloat(value);
  return Number.isNaN(n)
    ? value
    : `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
}
