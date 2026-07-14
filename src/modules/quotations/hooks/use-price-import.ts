"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api-client";
import type { PriceImportSummaryDto } from "../schemas/price-list";
import type { WorkbookImportSummaryDto } from "../services/workbook-import-service";

export function useImportPriceList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.set("file", file);
      return fetchJson<PriceImportSummaryDto>("/api/products/import", {
        method: "POST",
        body: form,
      });
    },
    // The catalog + rules feed the quote form picker — refresh it.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  });
}

/** Full workbook: one .xlsx upload imports every product tab at once. */
export function useImportWorkbook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.set("file", file);
      return fetchJson<WorkbookImportSummaryDto>(
        "/api/products/import-workbook",
        { method: "POST", body: form }
      );
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  });
}
