"use client";

import { useInfiniteQuery, keepPreviousData } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api-client";
import type { CompanyListRowDto } from "../schemas/company";

type Page = { rows: CompanyListRowDto[]; nextCursor: string | null };

export function useCompanies(filters: { q?: string; vatStatus?: string }) {
  return useInfiniteQuery({
    queryKey: ["companies", "list", filters],
    queryFn: ({ pageParam }) => {
      const s = new URLSearchParams();
      if (filters.q) s.set("q", filters.q);
      if (filters.vatStatus) s.set("vatStatus", filters.vatStatus);
      if (pageParam) s.set("cursor", pageParam);
      return fetchJson<Page>(`/api/customers/companies/list?${s}`);
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // Keep prior rows visible while a debounced search / filter refetches.
    placeholderData: keepPreviousData,
  });
}
