"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FileTextIcon, SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useProductOptions } from "@/modules/shared/hooks/use-products";
import { WIZARD_SLUGS } from "./registry";

// Landing for /quotations/new: pick the product to quote. Products with a
// dedicated wizard route there; everything else opens the generic line-item
// form (?product=<id>).
export function ProductChooser({ inquiryId }: { inquiryId?: string }) {
  const products = useProductOptions();
  const [q, setQ] = useState("");

  const suffix = inquiryId ? `&inquiryId=${inquiryId}` : "";
  const grouped = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = (products.data ?? []).filter(
      (p) =>
        !needle ||
        p.name.toLowerCase().includes(needle) ||
        p.category.toLowerCase().includes(needle)
    );
    const byCat = new Map<string, typeof rows>();
    for (const p of rows) {
      const list = byCat.get(p.category) ?? [];
      list.push(p);
      byCat.set(p.category, list);
    }
    return [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [products.data, q]);

  return (
    <div className="grid gap-5">
      <div className="relative max-w-sm">
        <SearchIcon className="pointer-events-none absolute inset-y-0 left-0 my-auto ml-3 size-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a product…"
          className="pl-9"
          aria-label="Search products"
        />
      </div>

      <Card className="flex flex-col gap-1 p-3">
        <Link
          href={`/quotations/new/custom?${suffix.slice(1)}`}
          className="flex items-center gap-3 rounded-md px-3 py-2.5 hover:bg-accent"
        >
          <FileTextIcon className="size-5 text-muted-foreground" />
          <div>
            <p className="font-medium">Custom item / service</p>
            <p className="text-xs text-muted-foreground">
              Free-form line items — full quotation form
            </p>
          </div>
        </Link>
      </Card>

      {products.isPending ? (
        <p className="text-sm text-muted-foreground">Loading products…</p>
      ) : grouped.length === 0 ? (
        <p className="text-sm text-muted-foreground">No products match.</p>
      ) : (
        grouped.map(([category, rows]) => (
          <div key={category} className="grid gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {category}
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((p) => {
                // Special wizards for Tarp/Signage; every other product uses
                // the generic guided wizard.
                const slug = WIZARD_SLUGS[p.name];
                const href = slug
                  ? `/quotations/new/${slug}?product=${p.id}${suffix}`
                  : `/quotations/new/product?product=${p.id}${suffix}`;
                return (
                  <Link
                    key={p.id}
                    href={href}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-lg border p-3 text-sm hover:border-primary hover:bg-accent"
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{p.name}</p>
                      <p className="text-xs text-primary">Guided calculator</p>
                    </div>
                    {parseFloat(p.basePrice) > 0 && (
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        ₱{p.basePrice}/{p.unit}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
