"use client";

import {
  useInfiniteQuery,
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { fetchJson } from "@/lib/api-client";
import type {
  BoardMetricsDto,
  DeadlineMoveDto,
  EodReportDto,
  ImportSummaryDto,
  JobOrderDetailDto,
  JobOrderItemRowDto,
  JobOrderItemsPageDto,
  JobOrderListPageDto,
  ReorderCreateInput,
  ReorderItemDto,
  ReportRowDto,
} from "../schemas/job-order";

export type JobOrderListParams = { q: string; view: string };

/** Transactions History filters, layered on top of the item board query. */
export type TransactionFilterParams = {
  from?: string;
  to?: string;
  payment?: "PAID" | "PARTIAL" | "UNPAID";
  delivery?: "full" | "partial" | "none";
  production?: "done" | "in_progress";
  customerId?: string;
  type?: "JO" | "PO";
};

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
    // Keep prior rows visible while a debounced search / filter refetches.
    placeholderData: keepPreviousData,
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
    // Keep prior rows visible while a debounced search / filter refetches.
    placeholderData: keepPreviousData,
  });
}

/** Transactions History: the whole JO ledger (view "all") plus the filter bar. */
export function useTransactionsInfinite(
  params: { q: string } & TransactionFilterParams
) {
  return useInfiniteQuery({
    queryKey: ["job-orders", "transactions", params],
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams({ view: "all" });
      if (params.q) search.set("q", params.q);
      if (params.from) search.set("from", params.from);
      if (params.to) search.set("to", params.to);
      if (params.payment) search.set("payment", params.payment);
      if (params.delivery) search.set("delivery", params.delivery);
      if (params.production) search.set("production", params.production);
      if (params.customerId) search.set("customerId", params.customerId);
      if (params.type) search.set("type", params.type);
      if (pageParam) search.set("cursor", pageParam);
      return fetchJson<JobOrderItemsPageDto>(`/api/job-orders/items?${search}`);
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
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

/** JO / EOD reports for a chosen "as of" date (legacy JOsReport). */
export function useJoReports(asOf: string) {
  return useQuery({
    queryKey: ["job-orders", "reports", asOf],
    queryFn: () =>
      fetchJson<{ eod: EodReportDto; rows: ReportRowDto[] }>(
        `/api/job-orders/reports?asOf=${asOf}`
      ),
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

/** A customer's previously-ordered items, for the reorder picker. */
export function useReorderItems(customerId: string | null) {
  return useQuery({
    queryKey: ["job-orders", "reorder-items", customerId],
    queryFn: () =>
      fetchJson<ReorderItemDto[]>(
        `/api/job-orders/reorder-items?customerId=${encodeURIComponent(customerId ?? "")}`
      ),
    enabled: !!customerId,
    staleTime: 30_000,
  });
}

/** Create a JO from picked reorder items (lands in PENDING_REVIEW). */
export function useCreateReorder() {
  const invalidate = useInvalidateJobOrders();
  return useMutation({
    mutationFn: (input: ReorderCreateInput) =>
      fetchJson<{ id: string }>("/api/job-orders/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: () => invalidate(),
  });
}

/** Admin approve / reject a reorder JO awaiting review. */
export function useReviewJo() {
  const invalidate = useInvalidateJobOrders();
  return useMutation({
    mutationFn: (input: {
      joId: string;
      action: "approve" | "reject" | "resubmit";
      reason?: string;
    }) =>
      fetchJson<null>(`/api/job-orders/${input.joId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: input.action, reason: input.reason }),
      }),
    onSuccess: () => invalidate(),
  });
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
