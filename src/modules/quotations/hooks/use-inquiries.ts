"use client";

import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { fetchJson } from "@/lib/api-client";
import type {
  InquiryMetricsDto,
  InquiryPageDto,
} from "../schemas/inquiry";

export type InquiryListParams = { q: string; view: string };

export function useInquiryMetrics() {
  return useQuery({
    // Prefixed by ["inquiries"] so any inquiry mutation invalidates it too.
    queryKey: ["inquiries", "metrics"],
    queryFn: () => fetchJson<InquiryMetricsDto>("/api/inquiries/metrics"),
    staleTime: 30_000,
  });
}

export function useInquiriesInfinite(params: InquiryListParams) {
  return useInfiniteQuery({
    queryKey: ["inquiries", params],
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams({ view: params.view });
      if (params.q) search.set("q", params.q);
      if (pageParam) search.set("cursor", pageParam);
      return fetchJson<InquiryPageDto>(`/api/inquiries?${search}`);
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useInvalidateInquiries() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["inquiries"] });
}
