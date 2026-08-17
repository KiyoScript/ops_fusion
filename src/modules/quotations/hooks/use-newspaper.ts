"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api-client";
import type { NewspaperPublicationDto } from "@/app/api/newspaper/publications/route";
import type {
  NewspaperPrice,
  NewspaperListRow,
} from "@/modules/quotations/services/newspaper-pricing";

export type { NewspaperPublicationDto, NewspaperPrice, NewspaperListRow };

/** Active publications for the newspaper calculator picker. */
export function useNewspaperPublications() {
  return useQuery({
    queryKey: ["newspaper", "publications"],
    queryFn: () =>
      fetchJson<NewspaperPublicationDto[]>("/api/newspaper/publications"),
    staleTime: 5 * 60_000,
  });
}

export type NewspaperPriceParams = {
  publicationId: string;
  kind: "FULL_ISSUE" | "LOOSE_PAGES";
  colorPages: number;
  bwPages: number;
  copies: number;
};

/** Live price (table hit → formula) for a spec. Callers pass debounced values. */
export function useNewspaperPrice(params: NewspaperPriceParams) {
  const ready =
    !!params.publicationId &&
    params.copies > 0 &&
    params.colorPages + params.bwPages > 0;
  return useQuery({
    queryKey: ["newspaper", "price", params],
    queryFn: () => {
      const s = new URLSearchParams({
        publicationId: params.publicationId,
        kind: params.kind,
        colorPages: String(params.colorPages),
        bwPages: String(params.bwPages),
        copies: String(params.copies),
      });
      return fetchJson<NewspaperPrice | null>(`/api/newspaper/price?${s}`);
    },
    enabled: ready,
    placeholderData: (prev) => prev,
  });
}

/** The approved price list for a publication + kind (quote-form picker). */
export function useNewspaperRows(
  publicationId: string,
  kind: "FULL_ISSUE" | "LOOSE_PAGES"
) {
  return useQuery({
    queryKey: ["newspaper", "rows", publicationId, kind],
    queryFn: () =>
      fetchJson<NewspaperListRow[]>(
        `/api/newspaper/rows?publicationId=${publicationId}&kind=${kind}`
      ),
    enabled: !!publicationId,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}
