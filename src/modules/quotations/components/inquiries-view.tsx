"use client";

import Link from "next/link";
import { useQueryState } from "nuqs";
import { format } from "date-fns";
import { FilePlus2Icon } from "lucide-react";
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
import { ColorBadge, type BadgeTone } from "@/components/color-badge";
import { useDebounce } from "@/modules/shared/hooks/use-debounce";
import { useInquiriesInfinite } from "../hooks/use-inquiries";
import { QuotationStatusBadge } from "./quotation-status-badge";
import { InquiryDialog } from "./inquiry-dialog";
import { InquiryRowActions } from "./inquiry-row-actions";
import { InquiryMetrics } from "./inquiry-metrics";

const VIEWS = [
  { value: "open", label: "Open (no quote yet)" },
  { value: "quoted", label: "Quoted" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
] as const;

const MEDIUM_BADGES: Record<string, { tone: BadgeTone; label: string }> = {
  WALK_IN: { tone: "green", label: "Walk-in" },
  MESSENGER: { tone: "blue", label: "Messenger" },
  CALL: { tone: "amber", label: "Call" },
  EMAIL: { tone: "purple", label: "Email" },
  VIBER: { tone: "purple", label: "Viber" },
  PORTAL: { tone: "auto", label: "Portal" },
};

const STATUS_BADGES: Record<string, { tone: BadgeTone; label: string }> = {
  OPEN: { tone: "amber", label: "Open" },
  QUOTED: { tone: "green", label: "Quoted" },
  CLOSED: { tone: "gray", label: "Closed" },
};

const COLS = 8;

export function InquiriesView({
  canWrite,
  canQuote,
}: {
  canWrite: boolean;
  canQuote: boolean;
}) {
  const [q, setQ] = useQueryState("q", { defaultValue: "" });
  const [view, setView] = useQueryState("view", { defaultValue: "open" });
  const debouncedQ = useDebounce(q);

  const query = useInquiriesInfinite({ q: debouncedQ, view });
  const rows = query.data?.pages.flatMap((page) => page.rows) ?? [];

  return (
    <div className="grid gap-4">
      <InquiryMetrics activeView={view} onSelect={(next) => setView(next)} />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search customer or service…"
          className="max-w-72"
          aria-label="Search inquiries"
        />
        <Select value={view} onValueChange={(value) => setView(value as string)}>
          <SelectTrigger aria-label="Filter inquiries">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VIEWS.map((v) => (
              <SelectItem key={v.value} value={v.value}>
                {v.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canWrite && (
          <div className="ml-auto">
            <InquiryDialog />
          </div>
        )}
      </div>

      <Card className="py-0">
        <CardContent className="overflow-x-auto px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="min-w-48">Customer</TableHead>
                <TableHead>Medium</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="min-w-64">Services requested</TableHead>
                <TableHead>Logged by</TableHead>
                <TableHead className="min-w-44">Quotation</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
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
                      title="No inquiries found"
                      description={
                        canWrite
                          ? "Log the first inquiry to start the quote pipeline."
                          : "Nothing matches the current filters."
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const medium = MEDIUM_BADGES[row.medium] ?? {
                    tone: "gray" as const,
                    label: row.medium,
                  };
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {format(new Date(row.createdAt), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell className="max-w-56">
                        <p className="truncate font-medium">{row.customerName}</p>
                        {(row.contactNumber || row.email) && (
                          <p className="truncate text-xs text-muted-foreground">
                            {[row.contactNumber, row.email]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <ColorBadge tone={medium.tone} label={medium.label} />
                      </TableCell>
                      <TableCell>
                        <ColorBadge
                          tone={STATUS_BADGES[row.status]?.tone ?? "gray"}
                          label={STATUS_BADGES[row.status]?.label ?? row.status}
                        />
                        {row.closedReason && (
                          <p className="mt-0.5 max-w-40 truncate text-xs text-muted-foreground">
                            {row.closedReason}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="max-w-80">
                        <p className="truncate">{row.servicesRequested}</p>
                        {row.notes && (
                          <p className="truncate text-xs text-muted-foreground">
                            {row.notes}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {row.createdByName}
                      </TableCell>
                      <TableCell>
                        {row.quotationId ? (
                          <Link
                            href={`/quotations/${row.quotationId}`}
                            className="inline-flex items-center gap-2 hover:underline"
                          >
                            <span className="font-medium">{row.quoteNumber}</span>
                            {row.quoteStatus && (
                              <QuotationStatusBadge status={row.quoteStatus} />
                            )}
                          </Link>
                        ) : canQuote && row.status !== "CLOSED" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            nativeButton={false}
                            render={
                              <Link href={`/quotations/new?inquiryId=${row.id}`} />
                            }
                          >
                            <FilePlus2Icon /> Create quote
                          </Button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {canWrite && !row.quotationId && (
                          <InquiryRowActions inquiry={row} />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
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
