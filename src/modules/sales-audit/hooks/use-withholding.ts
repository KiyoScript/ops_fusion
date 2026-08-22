"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api-client";
import type {
  CertificateDto,
  CertificateFilters,
  CreateCertificateInput,
  OutstandingWithholdingDto,
  UpdateCertificateInput,
  WithholdingRegisterDto,
} from "../schemas/withholding";

const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const REGISTER_KEY = ["withholding"] as const;

function toSearch(f: Partial<CertificateFilters>): string {
  const s = new URLSearchParams();
  if (f.customerId) s.set("customerId", f.customerId);
  if (f.kind) s.set("kind", f.kind);
  if (f.status && f.status !== "ALL") s.set("status", f.status);
  if (f.from) s.set("from", f.from);
  if (f.to) s.set("to", f.to);
  if (f.search) s.set("search", f.search);
  return s.toString();
}

export function useWithholdingRegister(filters: Partial<CertificateFilters>) {
  const search = toSearch(filters);
  return useQuery({
    queryKey: [...REGISTER_KEY, "register", search],
    queryFn: () =>
      fetchJson<WithholdingRegisterDto>(
        `/api/withholding-certificates${search ? `?${search}` : ""}`
      ),
    // The chase list is the reason to open this page; keeping the previous
    // rows on screen while a filter re-fetches stops the table flashing empty
    // and reading as "nothing outstanding".
    placeholderData: (prev) => prev,
  });
}

export function useCertificate(id: string | null) {
  return useQuery({
    queryKey: [...REGISTER_KEY, "certificate", id],
    queryFn: () =>
      fetchJson<CertificateDto>(`/api/withholding-certificates/${id}`),
    enabled: id !== null,
  });
}

/** Withholdings this certificate could still cover — same customer, same tax. */
export function useLinkableWithholdings(certificateId: string | null) {
  return useQuery({
    queryKey: [...REGISTER_KEY, "linkable", certificateId],
    queryFn: () =>
      fetchJson<OutstandingWithholdingDto[]>(
        `/api/withholding-certificates/${certificateId}/allocations`
      ),
    enabled: certificateId !== null,
  });
}

function useInvalidateRegister() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: REGISTER_KEY });
    // Linking a certificate does not move a peso, but the customer's A/R view
    // shows what has been withheld from them — leave it stale and the two
    // screens disagree about the same collection.
    qc.invalidateQueries({ queryKey: ["receivables"] });
  };
}

export function useRecordCertificate() {
  const invalidate = useInvalidateRegister();
  return useMutation({
    mutationFn: (input: CreateCertificateInput) =>
      fetchJson<{ id: string }>("/api/withholding-certificates", json(input)),
    onSuccess: invalidate,
  });
}

export function useAmendCertificate() {
  const invalidate = useInvalidateRegister();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateCertificateInput) =>
      fetchJson<{ id: string }>(
        `/api/withholding-certificates/${id}`,
        json(body, "PATCH")
      ),
    onSuccess: invalidate,
  });
}

export function useLinkWithholdings() {
  const invalidate = useInvalidateRegister();
  return useMutation({
    mutationFn: ({
      certificateId,
      allocationIds,
    }: {
      certificateId: string;
      allocationIds: string[];
    }) =>
      fetchJson<{ linked: number }>(
        `/api/withholding-certificates/${certificateId}/allocations`,
        json({ allocationIds })
      ),
    onSuccess: invalidate,
  });
}

export function useUnlinkWithholdings() {
  const invalidate = useInvalidateRegister();
  return useMutation({
    mutationFn: ({
      certificateId,
      allocationIds,
    }: {
      certificateId: string;
      allocationIds: string[];
    }) =>
      fetchJson<{ unlinked: number }>(
        `/api/withholding-certificates/${certificateId}/allocations`,
        json({ allocationIds }, "DELETE")
      ),
    onSuccess: invalidate,
  });
}

export function useVoidCertificate() {
  const invalidate = useInvalidateRegister();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      fetchJson<{ id: string }>(
        `/api/withholding-certificates/${id}`,
        json({ reason }, "DELETE")
      ),
    onSuccess: invalidate,
  });
}

export function useAttachCertificateScan() {
  const invalidate = useInvalidateRegister();
  return useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => {
      const form = new FormData();
      form.append("file", file);
      return fetchJson<{ id: string }>(
        `/api/withholding-certificates/${id}/file`,
        { method: "POST", body: form }
      );
    },
    onSuccess: invalidate,
  });
}
