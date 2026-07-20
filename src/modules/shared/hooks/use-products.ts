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
 *  server-side (resolveWizardProduct) — this hook feeds the Maintenance tab
 *  and client-side merges (custom form calculators). */
export function useGlobalAddons() {
  return useQuery({
    queryKey: ["global-addons"],
    queryFn: () => fetchJson<ProductRuleDto[]>("/api/products/global-addons"),
    staleTime: 60_000,
  });
}

/** Fee-name normalization shared with the server merge (resolveWizardProduct):
 *  "Rush" == "Rush Fee" — global add-ons match product fees by this key. */
export function feeKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/\bfees?\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Global-wins merge: product rules minus same-fee ADDONs, plus the globals.
 *  Mirrors resolveWizardProduct so client calculators charge the same fees. */
export function mergeGlobalAddons(
  rules: ProductRuleDto[],
  globals: ProductRuleDto[] | undefined
): ProductRuleDto[] {
  if (!globals?.length) return rules;
  const globalKeys = new Set(globals.map((g) => feeKey(g.label)));
  return [
    ...rules.filter((r) => r.type !== "ADDON" || !globalKeys.has(feeKey(r.label))),
    ...globals,
  ];
}
