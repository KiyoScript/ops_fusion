"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api-client";
import type { CustomerSuggestion } from "../repositories/customer-repository";
import { useDebounce } from "./use-debounce";

export function useCustomerSearch(query: string) {
  const debounced = useDebounce(query.trim());
  return useQuery({
    queryKey: ["customers", "search", debounced],
    queryFn: () =>
      fetchJson<CustomerSuggestion[]>(
        `/api/customers?q=${encodeURIComponent(debounced)}`
      ),
    enabled: debounced.length >= 2,
    placeholderData: (prev) => prev,
  });
}
