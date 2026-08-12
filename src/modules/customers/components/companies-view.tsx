"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryState } from "nuqs";
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
import { useCompanies } from "../hooks/use-companies";
import { VatBadge } from "./badges";

const COLS = 5;
const ALL = "ALL";

export function CompaniesView() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [vat, setVat] = useQueryState("vat", { defaultValue: ALL });
  const debouncedQ = useDebounce(q);
  const query = useCompanies({ q: debouncedQ, vatStatus: vat === ALL ? undefined : vat });
  const rows = query.data?.pages.flatMap((p) => p.rows) ?? [];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search company name or TIN…"
          className="max-w-80"
          aria-label="Search companies"
        />
        <Select value={vat} onValueChange={(v) => setVat(v ?? ALL)}>
          <SelectTrigger aria-label="Filter by tax status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All tax statuses</SelectItem>
            <SelectItem value="VAT">VAT</SelectItem>
            <SelectItem value="NON_VAT">Non-VAT</SelectItem>
            <SelectItem value="NO_TIN">No TIN</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="py-0">
        <CardContent className="overflow-x-auto px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>TIN</TableHead>
                <TableHead>Tax status</TableHead>
                <TableHead>Credit terms</TableHead>
                <TableHead className="text-right">Contacts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isPending ? (
                <TableSkeletonRows cols={COLS} />
              ) : query.isError ? (
                <TableRow><TableCell colSpan={COLS}><ErrorState message={query.error.message} onRetry={() => query.refetch()} /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={COLS}><EmptyState title="No companies" description="Add one with the New customer button (choose Company), or convert a customer." /></TableCell></TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => router.push(`/customers/companies/${r.id}`)}>
                    <TableCell className="min-w-48 max-w-sm font-medium wrap-break-word">{r.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground tabular-nums">{r.tin ?? "—"}</TableCell>
                    <TableCell>{r.vatStatus ? <VatBadge status={r.vatStatus} /> : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.creditTermDays ? `${r.creditTermDays} days` : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{r.contactCount}</TableCell>
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
