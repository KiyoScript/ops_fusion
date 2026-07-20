"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PlusIcon, SaveIcon, SearchIcon, Trash2Icon } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { NumberField } from "@/components/validated-fields";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import {
  EmptyState,
  ErrorState,
} from "@/components/data-states";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/modules/shared/hooks/use-debounce";
import {
  useGlobalAddons,
  useProductOptions,
  type ProductOptionDto,
  type ProductRuleDto,
} from "@/modules/shared/hooks/use-products";
import {
  removeAllProductsAction,
  saveGlobalAddonsAction,
  savePriceListProductAction,
} from "@/app/(app)/maintenance/quotations/actions";
import { PriceListImportDialog } from "./price-list-import-dialog";
import { WorkbookImportDialog } from "./workbook-import-dialog";
import { ProductEditDialog } from "./product-edit-dialog";
import { ProductionStepsDialog } from "./production-steps-dialog";

// Spreadsheet-style maintenance: a tab per product (like the workbook's
// sheets), and the selected product's price rules edited inline in a grid.

type Row = {
  type: "VARIANT" | "ADDON";
  label: string;
  unitPrice: string;
  minQty: string;
  minCharge: string;
  amount: string;
  pct: string;
  notes: string;
};

const toRow = (r: ProductRuleDto): Row => ({
  type: r.type,
  label: r.label,
  unitPrice: r.unitPrice ?? "",
  minQty: r.minQty > 1 ? String(r.minQty) : "",
  minCharge: r.minCharge ?? "",
  amount: r.amount ?? "",
  pct: r.pct ?? "",
  notes: r.notes ?? "",
});

const EMPTY_ROW: Row = {
  type: "VARIANT",
  label: "",
  unitPrice: "",
  minQty: "",
  minCharge: "",
  amount: "",
  pct: "",
  notes: "",
};

export function PriceListWorkbench({
  canMaintain,
  canRemoveAll = false,
}: {
  canMaintain: boolean;
  canRemoveAll?: boolean;
}) {
  const products = useProductOptions();
  const globalAddons = useGlobalAddons();
  const [q, setQ] = useState("");
  const debouncedQ = useDebounce(q);
  // "__global__" selects the pinned Common add-ons tab.
  const [activeId, setActiveId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const all = products.data ?? [];
    const needle = debouncedQ.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        p.category.toLowerCase().includes(needle)
    );
  }, [products.data, debouncedQ]);

  // Active product is derived: the selected one if it's still in the filtered
  // list, otherwise the first — no effect/setState needed.
  const globalActive = activeId === "__global__";
  const active = globalActive
    ? null
    : (filtered.find((p) => p.id === activeId) ?? filtered[0] ?? null);

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      {/* product tabs (like spreadsheet sheet tabs) */}
      <div className="grid h-fit gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search product…"
          aria-label="Search products"
        />
        <button
          type="button"
          onClick={() => setActiveId("__global__")}
          className={cn(
            "flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm font-medium",
            globalActive
              ? "border-primary bg-primary text-primary-foreground"
              : "hover:bg-accent"
          )}
        >
          <span>Common add-ons</span>
          <span
            className={cn(
              "shrink-0 text-xs tabular-nums",
              globalActive
                ? "text-primary-foreground/70"
                : "text-muted-foreground"
            )}
          >
            {globalAddons.data?.length ?? 0}
          </span>
        </button>
        <Card className="py-0">
          <CardContent className="max-h-[70vh] overflow-y-auto p-1">
            {products.isPending ? (
              <div className="grid gap-1 p-1">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">No products.</p>
            ) : (
              <ul className="grid gap-0.5">
                {filtered.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setActiveId(p.id)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm",
                        p.id === active?.id
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-accent"
                      )}
                    >
                      <span className="truncate">{p.name}</span>
                      <span
                        className={cn(
                          "shrink-0 text-xs tabular-nums",
                          p.id === active?.id
                            ? "text-primary-foreground/70"
                            : "text-muted-foreground"
                        )}
                      >
                        {p.rules.length}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        {canMaintain && (
          <div className="flex flex-wrap gap-2">
            <ProductEditDialog />
            <PriceListImportDialog />
            <WorkbookImportDialog />
            {canRemoveAll && (
              <RemoveAllProductsButton count={products.data?.length ?? 0} />
            )}
          </div>
        )}
      </div>

      {/* selected product's editable grid */}
      <div>
        {globalActive ? (
          globalAddons.isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : globalAddons.isError ? (
            <ErrorState
              message={globalAddons.error.message}
              onRetry={() => globalAddons.refetch()}
            />
          ) : (
            <GlobalAddonsSheet
              addons={globalAddons.data}
              canMaintain={canMaintain}
            />
          )
        ) : products.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : products.isError ? (
          <ErrorState
            message={products.error.message}
            onRetry={() => products.refetch()}
          />
        ) : !active ? (
          <EmptyState
            title="No product selected"
            description="Pick a product from the list, or add one."
          />
        ) : (
          <ProductSheet
            key={active.id}
            product={active}
            canMaintain={canMaintain}
          />
        )}
      </div>
    </div>
  );
}

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

// Common add-ons — fees offered on EVERY product (rush, design, delivery…).
// A product-level add-on with the same label overrides the global one.
type AddonRow = { label: string; amount: string; pct: string; notes: string };

function GlobalAddonsSheet({
  addons,
  canMaintain,
}: {
  addons: ProductRuleDto[];
  canMaintain: boolean;
}) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<AddonRow[]>(
    addons.map((a) => ({
      label: a.label,
      amount: a.amount ?? "",
      pct: a.pct ?? "",
      notes: a.notes ?? "",
    }))
  );
  const [saving, setSaving] = useState(false);

  const setRow = (i: number, patch: Partial<AddonRow>) =>
    setRows((rs) => rs.map((r, x) => (x === i ? { ...r, ...patch } : r)));

  const save = async () => {
    setSaving(true);
    const result = await saveGlobalAddonsAction({
      addons: rows
        .filter((r) => r.label.trim())
        .map((r) => ({
          label: r.label,
          amount: r.amount,
          pct: r.pct,
          notes: r.notes,
        })),
    });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Common add-ons saved.");
    queryClient.invalidateQueries({ queryKey: ["global-addons"] });
  };

  return (
    <Card>
      <CardContent className="grid gap-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">Common add-ons</h2>
            <p className="text-xs text-muted-foreground">
              Offered on every product — a product&apos;s own add-on with the
              same label overrides these.
            </p>
          </div>
          {canMaintain && (
            <Button onClick={save} disabled={saving} size="sm">
              <SaveIcon /> {saving ? "Saving…" : "Save"}
            </Button>
          )}
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[36rem]">
            <div className="grid grid-cols-[1fr_7rem_5rem_1fr_2.5rem] gap-2 border-b pb-1 text-xs font-medium text-muted-foreground">
              <span>Label</span>
              <span>Amount</span>
              <span>%</span>
              <span>Notes</span>
              <span className="sr-only">Remove</span>
            </div>
            <div className="grid gap-1.5 pt-2">
              {rows.length === 0 && (
                <p className="py-2 text-sm text-muted-foreground">
                  No common add-ons yet — add fees like Rush or Design fee that
                  apply to every product.
                </p>
              )}
              {rows.map((r, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_7rem_5rem_1fr_2.5rem] items-center gap-2"
                >
                  <Input
                    value={r.label}
                    onChange={(e) => setRow(i, { label: e.target.value })}
                    placeholder="e.g. Rush fee"
                    readOnly={!canMaintain}
                  />
                  <NumberField
                    decimal
                    value={r.amount}
                    onChange={(v) => setRow(i, { amount: v })}
                    placeholder="Amount"
                    disabled={!canMaintain}
                  />
                  <NumberField
                    decimal
                    value={r.pct}
                    onChange={(v) => setRow(i, { pct: v })}
                    placeholder="%"
                    disabled={!canMaintain}
                  />
                  <Input
                    value={r.notes}
                    onChange={(e) => setRow(i, { notes: e.target.value })}
                    placeholder="Notes"
                    readOnly={!canMaintain}
                  />
                  {canMaintain && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove add-on ${i + 1}`}
                      onClick={() =>
                        setRows((rs) => rs.filter((_, x) => x !== i))
                      }
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {canMaintain && (
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setRows((rs) => [
                  ...rs,
                  { label: "", amount: "", pct: "", notes: "" },
                ])
              }
            >
              <PlusIcon /> Add common add-on
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ProductSheet({
  product,
  canMaintain,
}: {
  product: ProductOptionDto;
  canMaintain: boolean;
}) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Row[]>(product.rules.map(toRow));
  const [saving, setSaving] = useState(false);
  const [ruleQ, setRuleQ] = useState("");
  const ruleNeedle = useDebounce(ruleQ).trim().toLowerCase();

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, x) => (x === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) =>
    setRows((rs) => rs.filter((_, x) => x !== i));

  // Filter keeps the ORIGINAL index so inline edits/removals still hit the
  // right row — long price DBs (e.g. Receipt Booklet) are searched, not paged.
  const visible = rows
    .map((r, i) => ({ r, i }))
    .filter(
      ({ r }) =>
        !ruleNeedle ||
        r.label.toLowerCase().includes(ruleNeedle) ||
        r.notes.toLowerCase().includes(ruleNeedle)
    );

  const addRow = (type: Row["type"]) => {
    setRuleQ(""); // a fresh row must not be hidden by an active filter
    setRows((rs) => [...rs, { ...EMPTY_ROW, type }]);
  };

  const save = async () => {
    setSaving(true);
    const result = await savePriceListProductAction({
      id: product.id,
      name: product.name,
      category: product.category,
      unit: product.unit,
      basePrice: "",
      description: product.description ?? "",
      rules: rows
        .filter((r) => r.label.trim())
        .map((r) => ({
          type: r.type,
          label: r.label,
          unitPrice: r.unitPrice,
          minQty: r.minQty,
          minCharge: r.minCharge,
          amount: r.amount,
          pct: r.pct,
          notes: r.notes,
        })),
    });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`${product.name} saved.`);
    queryClient.invalidateQueries({ queryKey: ["products"] });
  };

  return (
    <Card>
      <CardContent className="grid gap-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">{product.name}</h2>
            <p className="text-xs text-muted-foreground">
              {product.category} · priced per {product.unit}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={ruleQ}
                onChange={(e) => setRuleQ(e.target.value)}
                placeholder="Search rules…"
                aria-label={`Search ${product.name} rules`}
                className="h-8 w-44 pl-8"
              />
            </div>
            {canMaintain && (
              <div className="flex items-center gap-1">
                <ProductionStepsDialog product={product} />
                <ProductEditDialog product={product} />
                <Button onClick={save} disabled={saving} size="sm">
                  <SaveIcon /> {saving ? "Saving…" : "Save"}
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* grid header */}
        <div className="overflow-x-auto">
          <div className="min-w-[42rem]">
            <div className="grid grid-cols-[7rem_1fr_6rem_5rem_6rem_5rem_2.5rem] gap-2 border-b pb-1 text-xs font-medium text-muted-foreground">
              <span>Type</span>
              <span>Label</span>
              <span>Unit price</span>
              <span>Min qty</span>
              <span>Min charge</span>
              <span>%</span>
              <span className="sr-only">Remove</span>
            </div>
            <div className="grid gap-1.5 pt-2">
              {rows.length === 0 && (
                <p className="py-2 text-sm text-muted-foreground">
                  No rules — add a variant or add-on below.
                </p>
              )}
              {rows.length > 0 && visible.length === 0 && (
                <p className="py-2 text-sm text-muted-foreground">
                  No rules match “{ruleQ}” — {rows.length} hidden.
                </p>
              )}
              {ruleNeedle && visible.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Showing {visible.length} of {rows.length} rules
                </p>
              )}
              {visible.map(({ r, i }) => (
                <div
                  key={i}
                  className="grid grid-cols-[7rem_1fr_6rem_5rem_6rem_5rem_2.5rem] items-center gap-2"
                >
                  <Select
                    value={r.type}
                    onValueChange={(v) =>
                      canMaintain && setRow(i, { type: (v as Row["type"]) ?? "VARIANT" })
                    }
                    disabled={!canMaintain}
                  >
                    <SelectTrigger aria-label="Rule type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="VARIANT">Variant</SelectItem>
                      <SelectItem value="ADDON">Add-on</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    value={r.label}
                    onChange={(e) => setRow(i, { label: e.target.value })}
                    placeholder="Label"
                    readOnly={!canMaintain}
                  />
                  {r.type === "VARIANT" ? (
                    <>
                      <NumberField
                        decimal
                        value={r.unitPrice}
                        onChange={(v) => setRow(i, { unitPrice: v })}
                        placeholder="Price"
                        disabled={!canMaintain}
                      />
                      <NumberField
                        value={r.minQty}
                        onChange={(v) => setRow(i, { minQty: v })}
                        placeholder="1"
                        disabled={!canMaintain}
                      />
                      <NumberField
                        decimal
                        value={r.minCharge}
                        onChange={(v) => setRow(i, { minCharge: v })}
                        placeholder="—"
                        disabled={!canMaintain}
                      />
                      <span className="text-center text-muted-foreground">—</span>
                    </>
                  ) : (
                    <>
                      <NumberField
                        decimal
                        value={r.amount}
                        onChange={(v) => setRow(i, { amount: v })}
                        placeholder="Amount"
                        disabled={!canMaintain}
                      />
                      <span className="text-center text-muted-foreground">—</span>
                      <span className="text-center text-muted-foreground">—</span>
                      <NumberField
                        decimal
                        value={r.pct}
                        onChange={(v) => setRow(i, { pct: v })}
                        placeholder="%"
                        disabled={!canMaintain}
                      />
                    </>
                  )}
                  {canMaintain && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove row ${i + 1}`}
                      onClick={() => removeRow(i)}
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {canMaintain && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => addRow("VARIANT")}
            >
              <PlusIcon /> Add variant
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => addRow("ADDON")}
            >
              <PlusIcon /> Add-on fee
            </Button>
          </div>
        )}

        {product.productionSteps.length > 0 && (
          <div className="border-t pt-3">
            <Label className="text-xs text-muted-foreground">
              Production steps
            </Label>
            <p className="mt-1 text-sm">
              {product.productionSteps.join(" → ")}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
