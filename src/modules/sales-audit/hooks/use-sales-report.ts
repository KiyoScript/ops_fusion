"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api-client";
import type {
  SalesGranularity,
  SalesReportDto,
} from "../schemas/receipt";

export type SalesReportParams = {
  from: string;
  to: string;
  groupBy: SalesGranularity;
  customerId?: string | null;
};

function toSearch(p: SalesReportParams): URLSearchParams {
  const s = new URLSearchParams({
    from: p.from,
    to: p.to,
    groupBy: p.groupBy,
  });
  if (p.customerId) s.set("customerId", p.customerId);
  return s;
}

export function useSalesReport(params: SalesReportParams, enabled = true) {
  const search = toSearch(params).toString();
  return useQuery({
    queryKey: ["receipts", "sales-report", search],
    queryFn: () =>
      fetchJson<SalesReportDto>(`/api/receipts/sales-report?${search}`),
    enabled,
    // Changing the range re-queries; holding the previous figures stops the
    // page collapsing to zeros, which reads as "we sold nothing".
    placeholderData: (prev) => prev,
  });
}

/** The URL the Export button points at — same query, xlsx instead of JSON. */
export function salesReportXlsxUrl(params: SalesReportParams): string {
  const s = toSearch(params);
  s.set("format", "xlsx");
  return `/api/receipts/sales-report?${s}`;
}
