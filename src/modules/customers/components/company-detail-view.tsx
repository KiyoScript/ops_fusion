"use client";

import { useState } from "react";
import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AttachmentsCard } from "./attachments-card";
import { CreditDocsCard } from "./credit-docs-card";
import { CompanyBadge, VatBadge } from "./badges";
import { VAT_STATUS_LABEL } from "../vat";
import type { CompanyDetailDto } from "../schemas/company";

export function CompanyDetailView({
  company,
  canEdit,
}: {
  company: CompanyDetailDto;
  canEdit: boolean;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const contacts = needle
    ? company.contacts.filter((c) =>
        [c.name, c.department, c.position, c.contactNumber, c.email].some(
          (f) => (f ?? "").toLowerCase().includes(needle)
        )
      )
    : company.contacts;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <CompanyBadge />
        {company.vatStatus && <VatBadge status={company.vatStatus} />}
        {company.creditTermDays !== null && (
          <Badge variant="outline" className="font-normal">{company.creditTermDays}-day terms</Badge>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Billing</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <Field label="TIN" value={company.tin} />
            <Field label="Tax status" value={company.vatStatus ? VAT_STATUS_LABEL[company.vatStatus] : null} />
            <Field label="Credit terms" value={company.creditTermDays !== null ? `${company.creditTermDays} days` : null} />
            <Field label="Credit limit" value={company.creditLimit ? `₱${Number(company.creditLimit).toLocaleString("en-PH")}` : null} />
            <Field label="Billing address" value={company.address} />
            <Field label="Company email" value={company.email} />
            <Field label="Company contact" value={company.contactNumber} />
            {company.notes && <Field label="Notes" value={company.notes} />}
          </CardContent>
        </Card>

        <AttachmentsCard
          attachments={company.attachments}
          target={{ companyId: company.id }}
          canEdit={canEdit}
        />
      </div>

      <CreditDocsCard
        companyId={company.id}
        companyName={company.name}
        companyEmail={company.email}
        docs={{
          docBusinessReg: company.docBusinessReg,
          docCreditAppForm: company.docCreditAppForm,
          docBir2303: company.docBir2303,
          docMayorPermit: company.docMayorPermit,
        }}
        canEdit={canEdit}
      />

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">
            Contact persons ({company.contacts.length})
          </CardTitle>
          <div className="flex items-center gap-2">
            {company.contacts.length > 3 && (
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name, department…"
                className="h-9 w-56"
              />
            )}
            {canEdit && (
              <Button size="sm" nativeButton={false} render={<Link href={`/customers/new?companyId=${company.id}`} />}>
                <PlusIcon /> Add contact
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="grid gap-1.5">
          {company.contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No contact persons yet.</p>
          ) : contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No contacts match your search.</p>
          ) : (
            contacts.map((c) => (
              <Link
                key={c.id}
                href={`/customers/${c.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5 text-sm hover:bg-accent/40"
              >
                <div>
                  <span className="font-medium">{c.name}</span>
                  {(c.department || c.position) && (
                    <span className="text-muted-foreground">
                      {" — "}{[c.position, c.department].filter(Boolean).join(", ")}
                    </span>
                  )}
                  {c.status === "INACTIVE" && (
                    <Badge variant="outline" className="ml-2 font-normal">Inactive</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {[c.contactNumber, c.email].filter(Boolean).join(" · ") || "—"}
                </div>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="wrap-break-word">{value || "—"}</span>
    </div>
  );
}
