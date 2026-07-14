"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api-client";
import type { ItemStepRecord } from "@/modules/quotations/repositories/production-step-repository";

export type ItemStepDto = ItemStepRecord;

/** Production steps of one JO item (loaded while the item modal is open). */
export function useItemSteps(jobOrderItemId: string | null) {
  return useQuery({
    queryKey: ["item-steps", jobOrderItemId],
    queryFn: () =>
      fetchJson<ItemStepDto[]>(
        `/api/job-orders/items/${jobOrderItemId}/steps`
      ),
    enabled: jobOrderItemId !== null,
  });
}

export function useToggleItemStep(jobOrderItemId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { stepId: string; done: boolean }) =>
      fetchJson<null>(`/api/job-orders/items/${jobOrderItemId}/steps`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["item-steps", jobOrderItemId] });
      queryClient.invalidateQueries({ queryKey: ["job-orders"] });
    },
  });
}
