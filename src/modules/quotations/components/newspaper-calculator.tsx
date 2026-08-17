"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  useNewspaperPublications,
  useNewspaperRows,
} from "../hooks/use-newspaper";

// Newspaper picker — select a publication + Full/Loose, then pick a row from the
// approved price list. No spec typing: the chosen row fills the line item
// (qty = copies, unitPrice = per-copy) and its specs round-trip on edit. Only
// APPROVED prices are quotable; new sizes go through the maintenance calculator
// (submit → admin approval) first.

const KINDS = [
  { value: "FULL_ISSUE", label: "Full issue" },
  { value: "LOOSE_PAGES", label: "Loose pages" },
] as const;

export type NewspaperSpecs = {
  calculator: "newspaper";
  publicationId: string;
  publicationName: string;
  kind: "FULL_ISSUE" | "LOOSE_PAGES";
  colorPages: number;
  bwPages: number;
  copies: number;
  source: "TABLE" | "FORMULA";
  priceCode: string | null;
  total: number;
  perCopy: number;
};

const php = (n: number) =>
  `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;

export function NewspaperCalculator({
  initialSpecs,
  onApply,
}: {
  initialSpecs?: Record<string, unknown> | null;
  onApply: (result: {
    description: string;
    unitPrice: string;
    qty: string;
    specs: NewspaperSpecs;
  }) => void;
}) {
  const publications = useNewspaperPublications();
  const saved = (initialSpecs ?? {}) as Partial<NewspaperSpecs>;

  const [publicationId, setPublicationId] = useState(saved.publicationId ?? "");
  const [kind, setKind] = useState<"FULL_ISSUE" | "LOOSE_PAGES">(
    saved.kind ?? "FULL_ISSUE"
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Default to the first publication once loaded (derived — never setState in an
  // effect); a user click sets `publicationId` and takes over.
  const effectivePubId = publicationId || publications.data?.[0]?.id || "";
  const pubName =
    publications.data?.find((p) => p.id === effectivePubId)?.name ?? "";

  const rowsQuery = useNewspaperRows(effectivePubId, kind);
  const rows = rowsQuery.data ?? [];

  // Pre-highlight the row that matches a saved spec (edit round-trip) without a
  // setState-in-effect; a user click overrides it.
  const matchId =
    rows.find(
      (r) =>
        r.colorPages === saved.colorPages &&
        r.bwPages === saved.bwPages &&
        r.copies === saved.copies
    )?.id ?? null;
  const activeId = selectedId ?? matchId;

  const pick = (row: (typeof rows)[number]) => {
    setSelectedId(row.id);
    const totalPages = row.totalPages ?? row.colorPages + row.bwPages;
    const parts = [
      pubName,
      `${totalPages}pg (${row.colorPages} color / ${row.bwPages} BW)`,
      `${row.copies} copies`,
    ];
    if (kind === "LOOSE_PAGES") parts.push("loose pages");
    if (row.priceCode) parts.push(row.priceCode);
    onApply({
      description: parts.join(" · "),
      unitPrice: row.perCopy.toFixed(2),
      qty: String(row.copies),
      specs: {
        calculator: "newspaper",
        publicationId: effectivePubId,
        publicationName: pubName,
        kind,
        colorPages: row.colorPages,
        bwPages: row.bwPages,
        copies: row.copies,
        source: "TABLE",
        priceCode: row.priceCode,
        total: row.price,
        perCopy: row.perCopy,
      },
    });
  };

  return (
    <div className="grid gap-3 rounded-lg bg-muted/50 p-3">
      <p className="text-xs font-medium text-muted-foreground">
        Newspaper price list
      </p>

      <div className="grid gap-1.5">
        <Label className="text-xs">Publication</Label>
        <div
          role="radiogroup"
          aria-label="Publication"
          className="grid gap-2 grid-cols-[repeat(auto-fit,minmax(7rem,1fr))]"
        >
          {(publications.data ?? []).map((p) => {
            const selected = effectivePubId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  setPublicationId(p.id);
                  setSelectedId(null);
                }}
                className={cn(
                  "rounded-lg border bg-background p-2.5 text-sm font-semibold transition-colors",
                  selected
                    ? "border-primary ring-1 ring-primary"
                    : "hover:bg-accent/40"
                )}
              >
                {p.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {KINDS.map((k) => {
          const selected = kind === k.value;
          return (
            <button
              key={k.value}
              type="button"
              onClick={() => {
                setKind(k.value);
                setSelectedId(null);
              }}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-accent"
              )}
            >
              {k.label}
            </button>
          );
        })}
      </div>

      <div className="max-h-72 overflow-y-auto rounded-md border bg-background">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground">
            <tr className="[&_th]:px-3 [&_th]:py-2">
              <th className="text-left font-medium">Pages</th>
              <th className="text-right font-medium">Color</th>
              <th className="text-right font-medium">B/W</th>
              <th className="text-right font-medium">Copies</th>
              <th className="text-right font-medium">Price</th>
              <th className="text-right font-medium">/ copy</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-8 text-center text-muted-foreground"
                >
                  {rowsQuery.isLoading
                    ? "Loading price list…"
                    : `No approved prices for ${pubName || "this publication"} yet.`}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const active = activeId === r.id;
                return (
                  <tr
                    key={r.id}
                    onClick={() => pick(r)}
                    className={cn(
                      "cursor-pointer border-t transition-colors [&_td]:px-3 [&_td]:py-2",
                      active ? "bg-primary/10" : "hover:bg-accent/40"
                    )}
                  >
                    <td className="tabular-nums">{r.totalPages ?? "—"}</td>
                    <td className="text-right tabular-nums">{r.colorPages}</td>
                    <td className="text-right tabular-nums">{r.bwPages}</td>
                    <td className="text-right tabular-nums">{r.copies}</td>
                    <td className="text-right font-medium tabular-nums">
                      {php(r.price)}
                    </td>
                    <td className="text-right tabular-nums text-muted-foreground">
                      {php(r.perCopy)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Pick a row to fill the line item. Need a size that isn&apos;t here? Add it
        in <strong>Newspaper Pricing</strong> (needs admin approval) first.
      </p>
    </div>
  );
}
