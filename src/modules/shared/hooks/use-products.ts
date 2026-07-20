"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api-client";
import type {
  ProductOptionDto,
  ProductRuleDto,
} from "@/app/api/products/route";

export type { ProductOptionDto, ProductRuleDto };

/** Active product catalog, for the quotation line-item picker. */
export function useProductOptions() {
  return useQuery({
    queryKey: ["products"],
    queryFn: () => fetchJson<ProductOptionDto[]>("/api/products"),
    staleTime: 60_000,
  });
}

/** Common add-ons offered on every product; the wizards receive them merged
 *  server-side (resolveWizardProduct) — this hook feeds the Maintenance tab. */
export function useGlobalAddons() {
  return useQuery({
    queryKey: ["global-addons"],
    queryFn: () => fetchJson<ProductRuleDto[]>("/api/products/global-addons"),
    staleTime: 60_000,
  });
}
