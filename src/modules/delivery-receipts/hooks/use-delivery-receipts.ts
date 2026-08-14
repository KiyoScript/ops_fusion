"use client";

import {
  useInfiniteQuery,
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { fetchJson } from "@/lib/api-client";
import type {
  DeliverableJoDto,
  DrDetailDto,
  DrEditOptionsDto,
  DrListPageDto,
  DrMetricsDto,
} from "../schemas/delivery-receipt";

export function useDrMetrics() {
  return useQuery({
    queryKey: ["delivery-receipts", "metrics"],
    queryFn: () => fetchJson<DrMetricsDto>("/api/delivery-receipts/metrics"),
    staleTime: 30_000,
  });
}

export function useDrList(q: string) {
  return useInfiniteQuery({
    queryKey: ["delivery-receipts", q],
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams();
      if (q) search.set("q", q);
      if (pageParam) search.set("cursor", pageParam);
      return fetchJson<DrListPageDto>(`/api/delivery-receipts?${search}`);
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // Keep prior rows visible while a debounced search / filter refetches.
    placeholderData: keepPreviousData,
  });
}

/** Completed JO items still to deliver (issue picker). Pass `null` to disable.
 *  `q` searches the picker list; `jobOrderId` returns one JO's full item set. */
export function useDeliverable(
  params: { q?: string; jobOrderId?: string } | null
) {
  return useQuery({
    queryKey: ["delivery-receipts", "deliverable", params],
    queryFn: () => {
      const search = new URLSearchParams();
      if (params?.q) search.set("q", params.q);
      if (params?.jobOrderId) search.set("jobOrderId", params.jobOrderId);
      return fetchJson<DeliverableJoDto[]>(
        `/api/delivery-receipts/deliverable?${search}`
      );
    },
    enabled: params !== null,
  });
}

export function useDrDetail(id: string | null) {
  return useQuery({
    queryKey: ["delivery-receipts", "detail", id],
    queryFn: () => fetchJson<DrDetailDto>(`/api/delivery-receipts/${id}`),
    enabled: id !== null,
  });
}

/** JO line items as options for editing a DR's coverage. Pass `null` to skip
 *  (only fetched once the user enters edit mode). */
export function useDrEditOptions(drId: string | null) {
  return useQuery({
    queryKey: ["delivery-receipts", "edit-options", drId],
    queryFn: () =>
      fetchJson<DrEditOptionsDto>(
        `/api/delivery-receipts/${drId}/edit-options`
      ),
    enabled: drId !== null,
    staleTime: 0,
  });
}

export function useInvalidateDrs() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["delivery-receipts"] });
}
