"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api-client";
import type { BookletType } from "@/generated/prisma/enums";
import type { BookletDto, BookletSuggestionDto } from "../schemas/booklet";
import type {
  CollectFromCustomerInput,
  CollectOptionsDto,
  CollectResultDto,
  DailySalesSummaryDto,
  ReceiptListPageDto,
  ReceivePaymentInput,
  ReceivePaymentOptionsDto,
  VoidReceiptInput,
} from "../schemas/receipt";
import type { AuditReceiptInput } from "../schemas/audit";

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/**
 * Every cache a peso moving touches.
 *
 * Issuing, collecting and cancelling all change the SAME underlying numbers —
 * `Sale.voidedAt`, `Sale.settledAmount`, `CrAllocation` — and those numbers are
 * read by screens far outside Sales & Audit. The Job Orders board derives its
 * Payment badge from them (`getJoPaymentStatus`), the A/R ledger derives the
 * open balance from them (R3), the pipeline derives "unbilled" from them, and
 * the customer directory derives exposure from them.
 *
 * Invalidating only ["receipts"] left every one of those screens showing a
 * figure the database no longer agreed with — a cancelled receipt still read
 * as "✓ Paid" on the JO board until a hard refresh. So the whole set moves
 * together, always, rather than each mutation guessing which screens care.
 */
function invalidateMoney(qc: ReturnType<typeof useQueryClient>) {
  for (const key of [
    ["receipts"], // day log, payment options, summary, sales report
    ["receivables"], // A/R ledger, statements, customer account
    ["booklets"], // a leaf was consumed or cancelled in place
    ["job-orders"], // the JO board's Payment column — getJoPaymentStatus
    ["pipeline"], // backlog / unbilled partition moves when billing moves
    ["customers"], // customer directory shows balance + exposure
    ["companies"], // company-wide exposure aggregates across contacts (R15)
    ["delivery-receipts"], // DR issuance is gated on the payment position
  ]) {
    qc.invalidateQueries({ queryKey: key });
  }
}

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
      fetchJson<{
        id: string;
        /** Null when a collection was recorded without printing a CR. */
        documentNo: string | null;
        changeGiven: string;
        amountPaid: string;
        /** Unsettled remainder — straight to A/R. "0.00" on a cash sale. */
        balanceDue: string;
      }>("/api/receipts", json(input)),
    // A payment consumes a booklet number, lands on the day's log, moves the
    // JO's payment position, and — for a Charge Invoice — opens a receivable.
    onSuccess: () => invalidateMoney(qc),
  });
}

/**
 * Cancel or void an issued receipt. The JO's balance reopens, so its payment
 * options have to be refetched — that is what re-enables Receive Payment.
 */
export function useVoidReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: VoidReceiptInput) =>
      fetchJson<{ id: string; documentNo: string | null }>(
        "/api/receipts/void",
        json(input)
      ),
    // ["receipts"] is a prefix of the payment-options key, so this refetch is
    // what reopens the JO's balance in the dialog — but the cancellation also
    // reopens it on the JO board, the A/R ledger and the pipeline.
    onSuccess: () => invalidateMoney(qc),
  });
}

// ——— customer-level collection (accounts receivable) ———

/** Open invoices across every job order, plus credit held on account. */
export function useCollectOptions(customerId: string | null) {
  return useQuery({
    queryKey: ["receivables", "collect", customerId],
    queryFn: () =>
      fetchJson<CollectOptionsDto>(`/api/receivables/${customerId}/collect`),
    enabled: customerId !== null,
  });
}

export function useCollectFromCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      customerId,
      ...body
    }: CollectFromCustomerInput) =>
      fetchJson<CollectResultDto>(
        `/api/receivables/${customerId}/collect`,
        json(body)
      ),
    // The debt, the day's log and the booklet all move together — and so does
    // the Payment badge on every JO whose invoice this collection settled,
    // which is why a customer-level collection has to reach the JO board too.
    onSuccess: () => invalidateMoney(qc),
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
