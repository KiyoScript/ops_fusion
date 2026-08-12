"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api-client";
import { useDebounce } from "@/modules/shared/hooks/use-debounce";
import type { CompanyPickerDto } from "../schemas/company";

/** Debounced company search for the add-customer picker. */
export function useCompanySearch(query: string) {
  const debounced = useDebounce(query.trim());
  return useQuery({
    queryKey: ["companies", "search", debounced],
    queryFn: () =>
      fetchJson<CompanyPickerDto[]>(
        `/api/customers/companies?q=${encodeURIComponent(debounced)}`
      ),
    enabled: debounced.length >= 2,
    placeholderData: (prev) => prev,
  });
}
