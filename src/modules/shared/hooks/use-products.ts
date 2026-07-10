"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api-client";
import type { ProductOptionDto } from "@/app/api/products/route";

export type { ProductOptionDto };

/** Active product catalog, for the quotation line-item picker. */
export function useProductOptions() {
  return useQuery({
    queryKey: ["products"],
    queryFn: () => fetchJson<ProductOptionDto[]>("/api/products"),
    staleTime: 60_000,
  });
}
