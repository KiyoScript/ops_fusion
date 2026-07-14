"use client";

import { useQueryState } from "nuqs";
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
import {
  EmptyState,
  ErrorState,
  TableSkeletonRows,
} from "@/components/data-states";
import { ColorBadge } from "@/components/color-badge";
import { useDebounce } from "@/modules/shared/hooks/use-debounce";
import {
  useProductOptions,
  type ProductOptionDto,
  type ProductRuleDto,
} from "@/modules/shared/hooks/use-products";
import { PriceListImportDialog } from "./price-list-import-dialog";
import { WorkbookImportDialog } from "./workbook-import-dialog";
import { ProductEditDialog } from "./product-edit-dialog";
import { ProductionStepsDialog } from "./production-steps-dialog";

const COLS = 7;

/** Quotation Maintenance — the price database (products + rules), the new
 *  home of the legacy price spreadsheet. Data changes come in via import;
 *  the table is the read view the quote form's pickers run on. */
export function PriceListView({ canMaintain }: { canMaintain: boolean }) {
  const [q, setQ] = useQueryState("q", { defaultValue: "" });
  const debouncedQ = useDebounce(q);
  const products = useProductOptions();

  const needle = debouncedQ.trim().toLowerCase();
  const rows = (products.data ?? []).filter(
    (p) =>
      !needle ||
      p.name.toLowerCase().includes(needle) ||
      p.category.toLowerCase().includes(needle)
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search product or category…"
          className="max-w-72"
          aria-label="Search price list"
        />
        {canMaintain && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <ProductEditDialog />
            <PriceListImportDialog />
            <WorkbookImportDialog />
          </div>
        )}
      </div>

      <Card className="py-0">
        <CardContent className="overflow-x-auto px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-44">Product</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="min-w-56">Variants &amp; tiers</TableHead>
                <TableHead className="min-w-44">Add-ons</TableHead>
                <TableHead className="text-right">Base price</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.isPending ? (
                <TableSkeletonRows cols={COLS} />
              ) : products.isError ? (
                <TableRow>
                  <TableCell colSpan={COLS}>
                    <ErrorState
                      message={products.error.message}
                      onRetry={() => products.refetch()}
                    />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={COLS}>
                    <EmptyState
                      title="No products found"
                      description={
                        canMaintain
                          ? "Import the price spreadsheet to fill the catalog."
                          : "Nothing matches the search."
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((product) => (
                  <ProductRow
                    key={product.id}
                    product={product}
                    canMaintain={canMaintain}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function ProductRow({
  product,
  canMaintain,
}: {
  product: ProductOptionDto;
  canMaintain: boolean;
}) {
  const variants = groupVariants(
    product.rules.filter((r) => r.type === "VARIANT")
  );
  const addons = product.rules.filter((r) => r.type === "ADDON");

  return (
    <TableRow>
      <TableCell>
        <p className="font-medium">{product.name}</p>
        {product.description && (
          <p className="max-w-72 truncate text-xs text-muted-foreground">
            {product.description}
          </p>
        )}
      </TableCell>
      <TableCell>
        <ColorBadge label={product.category} />
      </TableCell>
      <TableCell className="text-muted-foreground">{product.unit}</TableCell>
      <TableCell className="text-sm">
        {variants.length === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <div className="grid gap-0.5">
            {variants.map((v) => (
              <p key={v.label} className="tabular-nums">
                <span className="font-medium">{v.label}:</span> {v.tiers}
              </p>
            ))}
          </div>
        )}
      </TableCell>
      <TableCell className="text-sm">
        {addons.length === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <div className="grid gap-0.5">
            {addons.map((a, i) => (
              <p key={i} className="tabular-nums">
                <span className="font-medium">{a.label}:</span>{" "}
                {[
                  a.amount ? `₱${a.amount}` : null,
                  a.pct ? `+${a.pct}%` : null,
                ]
                  .filter(Boolean)
                  .join(" / ")}
              </p>
            ))}
          </div>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {parseFloat(product.basePrice) > 0
          ? `₱${product.basePrice}/${product.unit}`
          : "—"}
      </TableCell>
      <TableCell>
        {canMaintain && (
          <div className="flex items-center justify-end">
            <ProductionStepsDialog product={product} />
            <ProductEditDialog product={product} />
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

/** "White Mug ₱180 @5+ · ₱150 @10+" — tiers grouped per variant label. */
function groupVariants(
  rules: ProductRuleDto[]
): { label: string; tiers: string }[] {
  const byLabel = new Map<string, ProductRuleDto[]>();
  for (const rule of rules) {
    const list = byLabel.get(rule.label) ?? [];
    list.push(rule);
    byLabel.set(rule.label, list);
  }
  return [...byLabel.entries()].map(([label, tiers]) => ({
    label,
    tiers: tiers
      .sort((a, b) => a.minQty - b.minQty)
      .map(
        (t) =>
          `₱${t.unitPrice ?? "?"}${t.minQty > 1 ? ` @${t.minQty}+` : ""}${
            t.minCharge ? ` (min ₱${t.minCharge})` : ""
          }`
      )
      .join(" · "),
  }));
}
