"use client";

import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { fetchJson } from "@/lib/api-client";
import type {
  MaterialDetailDto,
  MaterialFormOptionsDto,
  MaterialListPageDto,
  ReorderRowDto,
  SupplierDto,
} from "../schemas/material";
import type {
  AdjustmentDetailDto,
  AdjustmentListPageDto,
  CycleCountDetailDto,
  CycleCountListPageDto,
} from "../schemas/stock";

const KEY = "inventory";

// ——— Item master ———

export function useMaterials(filters: {
  q?: string;
  category?: string;
  status?: string;
}) {
  return useInfiniteQuery({
    queryKey: [KEY, "materials", filters],
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams();
      if (filters.q) search.set("q", filters.q);
      if (filters.category) search.set("category", filters.category);
      if (filters.status) search.set("status", filters.status);
      if (pageParam) search.set("cursor", pageParam);
      return fetchJson<MaterialListPageDto>(
        `/api/inventory/materials?${search}`
      );
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Flat material search for the adjustment / cycle-count line pickers. */
export function useMaterialSearch(q: string, enabled = true) {
  return useQuery({
    queryKey: [KEY, "material-search", q],
    queryFn: () => {
      const search = new URLSearchParams({ take: "20" });
      if (q) search.set("q", q);
      return fetchJson<MaterialListPageDto>(
        `/api/inventory/materials?${search}`
      ).then((p) => p.rows);
    },
    enabled,
    staleTime: 10_000,
  });
}

export function useMaterialDetail(id: string | null) {
  return useQuery({
    queryKey: [KEY, "material", id],
    queryFn: () => fetchJson<MaterialDetailDto>(`/api/inventory/materials/${id}`),
    enabled: id !== null,
    staleTime: 0,
  });
}

export function useMaterialOptions(enabled = true) {
  return useQuery({
    queryKey: [KEY, "material-options"],
    queryFn: () =>
      fetchJson<MaterialFormOptionsDto & { suggestedCode: string | null }>(
        `/api/inventory/materials/options`
      ),
    enabled,
    staleTime: 60_000,
  });
}

export function useReorder() {
  return useQuery({
    queryKey: [KEY, "reorder"],
    queryFn: () => fetchJson<ReorderRowDto[]>(`/api/inventory/reorder`),
    staleTime: 30_000,
  });
}

// ——— Stock adjustments ———

export function useAdjustments(filters: { q?: string; status?: string }) {
  return useInfiniteQuery({
    queryKey: [KEY, "adjustments", filters],
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams();
      if (filters.q) search.set("q", filters.q);
      if (filters.status) search.set("status", filters.status);
      if (pageParam) search.set("cursor", pageParam);
      return fetchJson<AdjustmentListPageDto>(
        `/api/inventory/adjustments?${search}`
      );
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useAdjustmentDetail(id: string | null) {
  return useQuery({
    queryKey: [KEY, "adjustment", id],
    queryFn: () =>
      fetchJson<AdjustmentDetailDto>(`/api/inventory/adjustments/${id}`),
    enabled: id !== null,
    staleTime: 0,
  });
}

// ——— Cycle counts ———

export function useCycleCounts(filters: { q?: string; status?: string }) {
  return useInfiniteQuery({
    queryKey: [KEY, "cycle-counts", filters],
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams();
      if (filters.q) search.set("q", filters.q);
      if (filters.status) search.set("status", filters.status);
      if (pageParam) search.set("cursor", pageParam);
      return fetchJson<CycleCountListPageDto>(
        `/api/inventory/cycle-counts?${search}`
      );
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useCycleCountDetail(id: string | null) {
  return useQuery({
    queryKey: [KEY, "cycle-count", id],
    queryFn: () =>
      fetchJson<CycleCountDetailDto>(`/api/inventory/cycle-counts/${id}`),
    enabled: id !== null,
    staleTime: 0,
  });
}

// ——— Suppliers ———

export function useSuppliers(filters: { q?: string; includeInactive?: boolean }) {
  return useQuery({
    queryKey: [KEY, "suppliers", filters],
    queryFn: () => {
      const search = new URLSearchParams();
      if (filters.q) search.set("q", filters.q);
      if (filters.includeInactive) search.set("includeInactive", "true");
      return fetchJson<SupplierDto[]>(`/api/inventory/suppliers?${search}`);
    },
  });
}

export function useInvalidateInventory() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: [KEY] });
}
