"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
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
import { useCustomers } from "../hooks/use-customers";

const COLS = 7;
const ALL = "ALL";

export function CustomersView() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>(ALL);
  const debouncedQ = useDebounce(q);

  const query = useCustomers({ q: debouncedQ, status: status === ALL ? undefined : status });
  const rows = query.data?.pages.flatMap((p) => p.rows) ?? [];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, company, contact, email, or TIN…"
          className="max-w-80"
          aria-label="Search customers"
        />
        <Select value={status} onValueChange={(v) => setStatus(v ?? ALL)}>
          <SelectTrigger aria-label="Filter by status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="INACTIVE">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="py-0">
        <CardContent className="overflow-x-auto px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>TIN</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Credit</TableHead>
                <TableHead className="text-right">Quotes / JOs</TableHead>
                <TableHead>Added</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isPending ? (
                <TableSkeletonRows cols={COLS} />
              ) : query.isError ? (
                <TableRow><TableCell colSpan={COLS}><ErrorState message={query.error.message} onRetry={() => query.refetch()} /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={COLS}><EmptyState title="No customers" description="Customers are created from the Quotation flow — make a quotation to add one." /></TableCell></TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => router.push(`/customers/${r.id}`)}>
                    <TableCell className="min-w-48 max-w-sm">
                      <div className="font-medium wrap-break-word">{r.name}</div>
                      {r.company && <div className="text-xs text-muted-foreground wrap-break-word">{r.company}</div>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.contactNumber ?? "—"}
                      {r.email && <div className="text-xs wrap-break-word">{r.email}</div>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground tabular-nums">{r.tin ?? "—"}</TableCell>
                    <TableCell>
                      {r.status === "INACTIVE"
                        ? <Badge variant="outline" className="font-normal">Inactive</Badge>
                        : <Badge variant="secondary" className="font-normal">Active</Badge>}
                      {r.vatRegistered && <Badge variant="outline" className="ml-1 font-normal">VAT</Badge>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.creditTermDays ? `${r.creditTermDays}d` : "—"}
                      {r.creditLimit && <span className="tabular-nums"> · ₱{parseFloat(r.creditLimit).toLocaleString("en-PH")}</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{r.quotationCount} / {r.jobOrderCount}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap text-muted-foreground">{format(new Date(r.createdAt), "M/d/yyyy h:mma")}</TableCell>
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
    </div>
  );
}
