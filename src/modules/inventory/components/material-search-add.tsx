"use client";

import { useState } from "react";
import { SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebounce } from "@/modules/shared/hooks/use-debounce";
import { useMaterialSearch } from "../hooks/use-inventory";
import type { MaterialDto } from "../schemas/material";

/** Type-ahead item search that adds a material to a stock-op line list.
 *  Items already picked are excluded from results. */
export function MaterialSearchAdd({
  onPick,
  excludeIds,
}: {
  onPick: (m: MaterialDto) => void;
  excludeIds: string[];
}) {
  const [q, setQ] = useState("");
  const debounced = useDebounce(q);
  const query = useMaterialSearch(debounced);
  const exclude = new Set(excludeIds);
  const results = (query.data ?? []).filter((m) => !exclude.has(m.id));

  return (
    <div className="grid gap-2">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search an item to add…"
          className="pl-8"
        />
      </div>
      {q.trim() !== "" && (
        <div className="grid max-h-52 gap-1 overflow-y-auto rounded-lg border p-1">
          {query.isPending ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)
          ) : results.length === 0 ? (
            <p className="px-2 py-3 text-center text-sm text-muted-foreground">No matching items.</p>
          ) : (
            results.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => { onPick(m); setQ(""); }}
                className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left hover:bg-muted"
              >
                <span className="min-w-0">
                  <span className="font-mono text-sm font-medium">{m.code}</span>
                  <span className="ml-2 text-sm wrap-break-word">{m.name}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {m.onHand.toLocaleString()} {m.unit}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
