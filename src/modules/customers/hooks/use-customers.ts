"use client";

import { useInfiniteQuery, keepPreviousData } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api-client";
import type { CustomerListPageDto } from "../schemas/customer";

export function useCustomers(filters: {
  q?: string;
  status?: string;
  vatStatus?: string;
  individualsOnly?: boolean;
}) {
  return useInfiniteQuery({
    queryKey: ["customers", filters],
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams();
      if (filters.q) search.set("q", filters.q);
      if (filters.status) search.set("status", filters.status);
      if (filters.vatStatus) search.set("vatStatus", filters.vatStatus);
      if (filters.individualsOnly) search.set("individualsOnly", "true");
      if (pageParam) search.set("cursor", pageParam);
      return fetchJson<CustomerListPageDto>(`/api/customers/list?${search}`);
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // Keep prior rows visible while a debounced search / filter refetches.
    placeholderData: keepPreviousData,
  });
}
