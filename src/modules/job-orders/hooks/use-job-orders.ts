"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { fetchJson } from "@/lib/api-client";
import type {
  BoardMetricsDto,
  DeadlineMoveDto,
  ImportSummaryDto,
  JobOrderDetailDto,
  JobOrderItemRowDto,
  JobOrderItemsPageDto,
  JobOrderListPageDto,
} from "../schemas/job-order";

export type JobOrderListParams = { q: string; view: string };

export function useJobOrdersInfinite(params: JobOrderListParams) {
  return useInfiniteQuery({
    queryKey: ["job-orders", params],
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams({ view: params.view });
      if (params.q) search.set("q", params.q);
      if (pageParam) search.set("cursor", pageParam);
      return fetchJson<JobOrderListPageDto>(`/api/job-orders?${search}`);
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Per-item board rows (one row per line item, like legacy JOWebApp). */
export function useJoItemsInfinite(params: JobOrderListParams) {
  return useInfiniteQuery({
    queryKey: ["job-orders", "items", params],
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams({ view: params.view });
      if (params.q) search.set("q", params.q);
      if (pageParam) search.set("cursor", pageParam);
      return fetchJson<JobOrderItemsPageDto>(`/api/job-orders/items?${search}`);
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Full JO detail for the edit modal (enabled while the modal is open). */
export function useJoDetail(jobOrderId: string | null) {
  return useQuery({
    queryKey: ["job-orders", "detail", jobOrderId],
    queryFn: () => fetchJson<JobOrderDetailDto>(`/api/job-orders/${jobOrderId}`),
    enabled: jobOrderId !== null,
  });
}

/** Deadline-move history of one JO (shown in the item edit modal). */
export function useJoDeadlineHistory(jobOrderId: string | null) {
  return useQuery({
    queryKey: ["job-orders", "deadline-history", jobOrderId],
    queryFn: () =>
      fetchJson<DeadlineMoveDto[]>(
        `/api/job-orders/${jobOrderId}/deadline-history`
      ),
    enabled: jobOrderId !== null,
    staleTime: 30_000,
  });
}

/** Deadline pins for one month (legacy JO Calendar). */
export function useJoCalendar(year: number, month: number) {
  return useQuery({
    queryKey: ["job-orders", "calendar", year, month],
    queryFn: () =>
      fetchJson<JobOrderItemRowDto[]>(
        `/api/job-orders/calendar?year=${year}&month=${month}`
      ),
    staleTime: 30_000,
  });
}

export function useJoBoardMetrics() {
  return useQuery({
    // Prefixed by ["job-orders"] so every JO mutation invalidates it too.
    queryKey: ["job-orders", "metrics"],
    queryFn: () => fetchJson<BoardMetricsDto>("/api/job-orders/metrics"),
    staleTime: 30_000,
  });
}

export function useInvalidateJobOrders() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["job-orders"] });
}

export function useImportLegacyCsv() {
  const invalidate = useInvalidateJobOrders();
  return useMutation({
    mutationFn: async (input: { file: File; source: "lineup" | "archive" }) => {
      const form = new FormData();
      form.set("file", input.file);
      form.set("source", input.source);
      return fetchJson<ImportSummaryDto>("/api/job-orders/import", {
        method: "POST",
        body: form,
      });
    },
    onSuccess: () => invalidate(),
  });
}
