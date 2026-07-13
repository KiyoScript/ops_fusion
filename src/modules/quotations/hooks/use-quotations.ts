"use client";

import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { fetchJson } from "@/lib/api-client";
import type {
  QuotationDetailDto,
  QuotationListPageDto,
} from "../schemas/quotation";

export type QuotationListParams = { q: string; status: string; type: string };

export function useQuotationsInfinite(params: QuotationListParams) {
  return useInfiniteQuery({
    queryKey: ["quotations", params],
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams({
        status: params.status,
        type: params.type,
      });
      if (params.q) search.set("q", params.q);
      if (pageParam) search.set("cursor", pageParam);
      return fetchJson<QuotationListPageDto>(`/api/quotations?${search}`);
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useQuotationDetail(quotationId: string | null) {
  return useQuery({
    queryKey: ["quotations", "detail", quotationId],
    queryFn: () =>
      fetchJson<QuotationDetailDto>(`/api/quotations/${quotationId}`),
    enabled: quotationId !== null,
  });
}

export function useInvalidateQuotations() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["quotations"] });
}
