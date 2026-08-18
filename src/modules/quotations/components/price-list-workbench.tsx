"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ColorBadge } from "@/components/color-badge";
import {
  EmptyState,
  ErrorState,
  TableSkeletonRows,
} from "@/components/data-states";
import { useDebounce } from "@/modules/shared/hooks/use-debounce";
import {
  useProductOptions,
  type ProductOptionDto,
} from "@/modules/shared/hooks/use-products";
import { removeAllProductsAction } from "@/app/(app)/maintenance/quotations/actions";
import { PriceListImportDialog } from "./price-list-import-dialog";
import { WorkbookImportDialog } from "./workbook-import-dialog";
import { ProductEditDialog } from "./product-edit-dialog";

// Product Masters directory — uniform with the other module list views: search
// + category filter + table, with the full product editor (basics + variants /
// tiers / add-ons) in a dialog per row (ProductEditDialog).

export function PriceListWorkbench({
  canMaintain,
  canRemoveAll = false,
}: {
  canMaintain: boolean;
  canRemoveAll?: boolean;
}) {
  const products = useProductOptions();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
  const debouncedQ = useDebounce(q);

  const categories = useMemo(
    () => [...new Set((products.data ?? []).map((p) => p.category))].sort(),
    [products.data]
  );
  const filtered = useMemo(() => {
    const needle = debouncedQ.trim().toLowerCase();
    return (products.data ?? []).filter((p) => {
      if (category !== "all" && p.category !== category) return false;
      if (!needle) return true;
      return (
        p.name.toLowerCase().includes(needle) ||
        p.category.toLowerCase().includes(needle)
      );
    });
  }, [products.data, debouncedQ, category]);

  const variantCount = (p: ProductOptionDto) =>
    new Set(p.rules.filter((r) => r.type === "VARIANT").map((r) => r.label)).size;
  const addonCount = (p: ProductOptionDto) =>
    p.rules.filter((r) => r.type === "ADDON").length;
  const php = (v: string) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0
      ? `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`
      : "—";
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search product or category…"
          aria-label="Search products"
          className="max-w-72"
        />
        <Select value={category} onValueChange={(v) => setCategory(v as string)}>
          <SelectTrigger aria-label="Filter by category" className="w-44">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canMaintain && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <ProductEditDialog />
            <PriceListImportDialog />
            <WorkbookImportDialog />
            {canRemoveAll && (
              <RemoveAllProductsButton count={products.data?.length ?? 0} />
            )}
          </div>
        )}
      </div>

      <Card className="py-0">
        <CardContent className="overflow-x-auto px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-56">Product</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>LFP</TableHead>
                <TableHead className="text-right">Base price</TableHead>
                <TableHead className="text-right">Variants</TableHead>
                <TableHead className="text-right">Add-ons</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.isPending ? (
                <TableSkeletonRows cols={8} />
              ) : products.isError ? (
                <TableRow>
                  <TableCell colSpan={8}>
                    <ErrorState
                      message={products.error.message}
                      onRetry={() => products.refetch()}
                    />
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8}>
                    <EmptyState
                      title="No products found"
                      description={
                        canMaintain
                          ? "Add a product or import the workbook."
                          : "Nothing matches the filters."
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium wrap-break-word">
                      {p.name}
                    </TableCell>
                    <TableCell>
                      <ColorBadge tone="gray" label={p.category} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.unit}</TableCell>
                    <TableCell>
                      {p.isLFP && <ColorBadge tone="blue" label="LFP" />}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {php(p.basePrice)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {variantCount(p) || "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {addonCount(p) || "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {canMaintain && <ProductEditDialog product={p} />}
                    </TableCell>
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

// Common add-ons — the shared-fee editor (rush / design / delivery …) in a
// dialog. Was a pinned "tab" in the old two-pane workbench.
// Admin-only reset: soft-deletes the whole catalog so it can be re-imported
// clean. Existing quotes/JOs keep their references, so it's recoverable.
function RemoveAllProductsButton({ count }: { count: number }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);

  async function handleRemove() {
    setWorking(true);
    const res = await removeAllProductsAction();
    setWorking(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(
      `Removed ${res.data.removed} product${res.data.removed === 1 ? "" : "s"}.`
    );
    setOpen(false);
    await queryClient.invalidateQueries({ queryKey: ["products"] });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="outline" size="sm" disabled={count === 0} />}
      >
        <Trash2Icon className="size-4" />
        Remove all
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove all products?</DialogTitle>
          <DialogDescription>
            This clears the whole price catalog ({count} product
            {count === 1 ? "" : "s"}) from the quote form. Existing quotations
            and job orders keep their prices, and you can re-import the workbook
            afterwards. This is admin-only.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            variant="destructive"
            onClick={handleRemove}
            disabled={working}
          >
            {working ? "Removing…" : "Remove all products"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
