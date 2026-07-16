"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api-client";
import type { BookletType } from "@/generated/prisma/enums";
import type { BookletDto, BookletSuggestionDto } from "../schemas/booklet";
import type {
  DailySalesSummaryDto,
  ReceiptListPageDto,
  ReceivePaymentInput,
  ReceivePaymentOptionsDto,
} from "../schemas/receipt";
import type { AuditReceiptInput } from "../schemas/audit";

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

// ——— booklets ———

export function useBooklets() {
  return useQuery({
    queryKey: ["booklets"],
    queryFn: () => fetchJson<BookletDto[]>("/api/booklets"),
  });
}

/** The next free range for a type — pre-fills the register form. */
export function useBookletSuggestion(type: BookletType | null) {
  return useQuery({
    queryKey: ["booklets", "suggest", type],
    queryFn: () =>
      fetchJson<BookletSuggestionDto>(`/api/booklets/suggest?type=${type}`),
    enabled: type !== null,
  });
}

export function useInvalidateBooklets() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["booklets"] });
}

export function useCreateBooklet() {
  const invalidate = useInvalidateBooklets();
  return useMutation({
    mutationFn: (input: {
      type: BookletType;
      seriesStart: number;
      seriesEnd: number;
      label?: string;
      gapExempt: boolean;
    }) => fetchJson<{ id: string }>("/api/booklets", json(input)),
    onSuccess: invalidate,
  });
}

export function useBookletAction() {
  const invalidate = useInvalidateBooklets();
  return useMutation({
    mutationFn: (input: {
      id: string;
      action: "approve" | "reject" | "re-request" | "close";
      note?: string;
    }) =>
      fetchJson<{ id: string }>(
        `/api/booklets/${input.id}`,
        json({ action: input.action, note: input.note })
      ),
    onSuccess: invalidate,
  });
}

export function useDeleteBooklet() {
  const invalidate = useInvalidateBooklets();
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ id: string }>(`/api/booklets/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

// ——— receive payment ———

/** What the dialog opens with. Pass `null` while it's closed. */
export function usePaymentOptions(jobOrderId: string | null) {
  return useQuery({
    queryKey: ["receipts", "payment-options", jobOrderId],
    queryFn: () =>
      fetchJson<ReceivePaymentOptionsDto>(
        `/api/job-orders/${jobOrderId}/payment-options`
      ),
    enabled: jobOrderId !== null,
  });
}

export function useReceivePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ReceivePaymentInput) =>
      fetchJson<{ id: string; documentNo: string; changeGiven: string }>(
        "/api/receipts",
        json(input)
      ),
    onSuccess: () => {
      // A payment consumes a booklet number and lands on the day's log.
      qc.invalidateQueries({ queryKey: ["receipts"] });
      qc.invalidateQueries({ queryKey: ["booklets"] });
    },
  });
}

// ——— daily sales + audit ———

export function useDailyReceipts(date: string, q: string) {
  return useQuery({
    queryKey: ["receipts", "day", date, q],
    queryFn: () => {
      const search = new URLSearchParams({ date });
      if (q) search.set("q", q);
      return fetchJson<ReceiptListPageDto>(`/api/receipts?${search}`);
    },
  });
}

export function useDailySummary(date: string) {
  return useQuery({
    queryKey: ["receipts", "summary", date],
    queryFn: () =>
      fetchJson<DailySalesSummaryDto>(`/api/receipts/summary?date=${date}`),
  });
}

export function useAuditReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AuditReceiptInput) =>
      fetchJson<{ id: string }>("/api/receipts/audit", json(input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["receipts"] }),
  });
}
