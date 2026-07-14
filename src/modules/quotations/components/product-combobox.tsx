"use client";

import { useMemo, useState } from "react";
import { ChevronsUpDownIcon, XIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ProductOptionDto } from "@/modules/shared/hooks/use-products";

/**
 * Type-to-search product picker: the box shows product NAMES (filtered as
 * you type); picking one loads its specs/variants below (handled by the
 * caller). "Custom item / service" clears the product for a free-text line.
 */
export function ProductCombobox({
  products,
  value,
  productName,
  onPick,
  id,
}: {
  products: ProductOptionDto[];
  /** Currently selected productId, or "" for a custom line. */
  value: string;
  /** Name of the selected product (shown when the box is not being typed in). */
  productName: string | null;
  onPick: (productId: string) => void;
  id?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        p.category.toLowerCase().includes(needle)
    );
  }, [products, query]);

  // Show the picked product's name when idle; the live query while typing.
  const display = focused ? query : (productName ?? "");
  const open = focused;

  return (
    <div className="relative">
      <div className="relative">
        <Input
          id={id}
          value={display}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!focused) setFocused(true);
          }}
          onFocus={() => {
            setFocused(true);
            setQuery("");
          }}
          onBlur={() => setFocused(false)}
          placeholder="Search a product…"
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          className="pr-8"
        />
        {value ? (
          <button
            type="button"
            aria-label="Clear product"
            className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-muted-foreground hover:text-foreground"
            onMouseDown={(e) => {
              e.preventDefault();
              onPick("");
              setQuery("");
              setFocused(false);
            }}
          >
            <XIcon className="size-4" />
          </button>
        ) : (
          <ChevronsUpDownIcon className="pointer-events-none absolute inset-y-0 right-0 my-auto mr-2.5 size-4 text-muted-foreground" />
        )}
      </div>

      {open && (
        <ul className="absolute z-40 mt-1 max-h-64 w-full overflow-y-auto rounded-lg bg-popover p-1 text-sm shadow-md ring-1 ring-foreground/10">
          <li>
            <button
              type="button"
              className={cn(
                "w-full rounded-md px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground",
                !value && "font-medium"
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick("");
                setFocused(false);
              }}
            >
              Custom item / service
            </button>
          </li>
          {filtered.length === 0 ? (
            <li className="px-2 py-1.5 text-muted-foreground">No match.</li>
          ) : (
            filtered.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground",
                    p.id === value && "font-medium"
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onPick(p.id);
                    setFocused(false);
                  }}
                >
                  <span className="truncate">{p.name}</span>
                  {parseFloat(p.basePrice) > 0 && (
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      ₱{p.basePrice}/{p.unit}
                    </span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
