"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { archiveSupplierAction } from "@/app/(app)/maintenance/inventory/actions";
import { useSuppliers, useInvalidateInventory } from "../hooks/use-inventory";
import { SupplierFormDialog } from "./supplier-form-dialog";
import type { SupplierDto } from "../schemas/material";

const COLS = 6;

export function SuppliersView({ canMaintain }: { canMaintain: boolean }) {
  const router = useRouter();
  const invalidate = useInvalidateInventory();
  const [q, setQ] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const debouncedQ = useDebounce(q);
  const [editing, setEditing] = useState<SupplierDto | null>(null);
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();

  const query = useSuppliers({ q: debouncedQ, includeInactive });
  const rows = query.data ?? [];

  const archive = (s: SupplierDto) => {
    startTransition(async () => {
      const result = await archiveSupplierAction({ id: s.id });
      if (!result.ok) { toast.error(result.error); return; }
      toast.success("Supplier archived.");
      invalidate();
      router.refresh();
    });
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search suppliers…" className="max-w-64" aria-label="Search suppliers" />
        <div className="flex items-center gap-2">
          <Switch id="sup-inactive" checked={includeInactive} onCheckedChange={setIncludeInactive} />
          <Label htmlFor="sup-inactive" className="text-sm text-muted-foreground">Show inactive</Label>
        </div>
        {canMaintain && (
          <Button className="ml-auto" onClick={() => setAdding(true)}><PlusIcon /> Add supplier</Button>
        )}
      </div>

      <Card className="py-0">
        <CardContent className="overflow-x-auto px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isPending ? (
                <TableSkeletonRows cols={COLS} />
              ) : query.isError ? (
                <TableRow><TableCell colSpan={COLS}><ErrorState message={query.error.message} onRetry={() => query.refetch()} /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={COLS}><EmptyState title="No suppliers" description="Add the suppliers you buy materials from." /></TableCell></TableRow>
              ) : (
                rows.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">
                      {s.name}
                      {s.code && <span className="ml-2 font-mono text-xs text-muted-foreground">{s.code}</span>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{s.contactPerson ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{s.phone ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{s.materialCount}</TableCell>
                    <TableCell>
                      {s.status === "ACTIVE" ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Inactive</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      {canMaintain && (
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing(s)} aria-label={`Edit ${s.name}`}>
                            <PencilIcon className="size-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => archive(s)} disabled={pending} aria-label={`Archive ${s.name}`}>
                            <Trash2Icon className="size-4" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <SupplierFormDialog open={adding} onOpenChange={setAdding} />
      <SupplierFormDialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} supplier={editing} />
    </div>
  );
}
