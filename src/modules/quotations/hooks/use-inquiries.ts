"use client";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api-client";
import type { InquiryPageDto } from "../schemas/inquiry";

export type InquiryListParams = { q: string; view: string };

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
