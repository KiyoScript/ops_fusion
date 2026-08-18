"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ContactField, TinField, isValidPhContact } from "@/components/validated-fields";
import { updateCustomerAction } from "@/app/(app)/customers/actions";
import { PersonNameFields } from "./person-name-fields";
import { VAT_STATUS_LABEL } from "../vat";
import type { CustomerEditDto } from "../schemas/customer";

type VatValue = "" | "VAT" | "NON_VAT" | "NO_TIN";

type FormState = {
  lastName: string;
  firstName: string;
  middleInitial: string;
  company: string;
  department: string;
  position: string;
  contactNumber: string;
  email: string;
  address: string;
  shippingAddress: string;
  tin: string;
  vatStatus: VatValue;
  creditTermDays: string;
  status: "ACTIVE" | "INACTIVE";
  notes: string;
};

export function CustomerEditForm({
  customer,
  creditTerms,
}: {
  customer: CustomerEditDto;
  /** Active credit-term options (days) for the dropdown. */
  creditTerms: number[];
}) {
  const router = useRouter();
  const isContact = customer.companyId !== null;
  const [form, setForm] = useState<FormState>({
    // Legacy rows have only the free-text `name` (backfilled into lastName);
    // structured parts prefill when present, else fall back so nothing is lost.
    lastName: customer.lastName ?? customer.name,
    firstName: customer.firstName ?? "",
    middleInitial: customer.middleInitial ?? "",
    company: customer.company ?? "",
    department: customer.department ?? "",
    position: customer.position ?? "",
    contactNumber: customer.contactNumber ?? "",
    email: customer.email ?? "",
    address: customer.address ?? "",
    shippingAddress: customer.shippingAddress ?? "",
    tin: customer.tin ?? "",
    vatStatus: (customer.vatStatus ?? "") as VatValue,
    creditTermDays:
      customer.creditTermDays !== null ? String(customer.creditTermDays) : "",
    status: customer.status,
    notes: customer.notes ?? "",
  });
  const [pending, startTransition] = useTransition();
  const [attempted, setAttempted] = useState(false);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const detailHref = `/customers/${customer.id}`;
  const contactValid = isValidPhContact(form.contactNumber);

  const submit = () => {
    setAttempted(true);
    if (!form.lastName.trim() || !form.firstName.trim()) { toast.error("Last name and first name are required."); return; }
    if (!contactValid) {
      toast.error(
        form.contactNumber.trim()
          ? "Enter a valid PH mobile (09XXXXXXXXX or +639XXXXXXXXX)."
          : "Mobile number is required."
      );
      return;
    }
    startTransition(async () => {
      const result = await updateCustomerAction({
        id: customer.id,
        lastName: form.lastName.trim(),
        firstName: form.firstName.trim(),
        middleInitial: form.middleInitial.trim() || undefined,
        company: form.company.trim() || undefined,
        department: form.department.trim() || undefined,
        position: form.position.trim() || undefined,
        contactNumber: form.contactNumber.trim(),
        email: form.email.trim() || undefined,
        address: form.address.trim() || undefined,
        shippingAddress: form.shippingAddress.trim() || undefined,
        // Billing edits only apply to individuals; the server ignores them for
        // company contacts (billing is owned by the company).
        tin: form.tin.trim() || undefined,
        vatStatus: form.vatStatus || undefined,
        creditTermDays: form.creditTermDays ? Number(form.creditTermDays) : undefined,
        status: form.status,
        notes: form.notes.trim() || undefined,
      });
      if (!result.ok) { toast.error(result.error); return; }
      toast.success("Customer updated.");
      router.push(detailHref);
      router.refresh();
    });
  };

  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <PersonNameFields
          idPrefix="cf"
          lastName={form.lastName}
          firstName={form.firstName}
          middleInitial={form.middleInitial}
          onLast={(v) => set("lastName", v)}
          onFirst={(v) => set("firstName", v)}
          onMi={(v) => set("middleInitial", v)}
          attempted={attempted}
          excludeId={customer.id}
          companyId={customer.companyId}
        />

        <div className="grid gap-1.5">
          <Label htmlFor="cf-company">Company</Label>
          <Input
            id="cf-company"
            value={form.company}
            onChange={(e) => set("company", e.target.value)}
            readOnly={isContact}
            className={isContact ? "bg-muted/50 text-muted-foreground" : undefined}
          />
        </div>

        {isContact && (
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="cf-dept">Department</Label>
              <Input id="cf-dept" value={form.department} onChange={(e) => set("department", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cf-pos">Position</Label>
              <Input id="cf-pos" value={form.position} onChange={(e) => set("position", e.target.value)} />
            </div>
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="cf-contact">
              {isContact ? "Official contact number" : "Contact number"}{" "}
              <span className="text-destructive">*</span>
            </Label>
            <ContactField
              id="cf-contact"
              value={form.contactNumber}
              onChange={(v) => set("contactNumber", v)}
              aria-invalid={attempted && !contactValid}
            />
            {attempted && !contactValid && (
              <p className="text-sm text-destructive">
                {form.contactNumber.trim()
                  ? "Enter a valid PH mobile (09XXXXXXXXX or +639XXXXXXXXX)."
                  : "Mobile number is required."}
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cf-email">{isContact ? "Official email" : "Email"}</Label>
            <Input id="cf-email" value={form.email} onChange={(e) => set("email", e.target.value)} />
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="cf-address">Billing address</Label>
            <Textarea id="cf-address" rows={2} value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="What receipts are billed to" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cf-shipping">Shipping address</Label>
            <Textarea id="cf-shipping" rows={2} value={form.shippingAddress} onChange={(e) => set("shippingAddress", e.target.value)} placeholder="Where goods are delivered" />
          </div>
        </div>

        {/* Billing — company contacts inherit it from their company (read-only);
            individuals edit it here. */}
        {isContact ? (
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
            Billing (TIN, VAT status, credit terms) is managed on the{" "}
            <Link href={`/customers/companies/${customer.companyId}`} className="font-medium text-foreground underline">
              company profile
            </Link>
            . Current: TIN {customer.tin || "—"} ·{" "}
            {customer.vatStatus ? VAT_STATUS_LABEL[customer.vatStatus] : "—"} ·{" "}
            {customer.creditTermDays !== null ? `${customer.creditTermDays}-day terms` : "no terms"}.
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="cf-tin">TIN</Label>
              <TinField id="cf-tin" value={form.tin} onChange={(v) => set("tin", v)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cf-vat">Tax status</Label>
              <Select value={form.vatStatus || "none"} onValueChange={(v) => set("vatStatus", (!v || v === "none" ? "" : v) as VatValue)}>
                <SelectTrigger id="cf-vat" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  <SelectItem value="VAT">VAT</SelectItem>
                  <SelectItem value="NON_VAT">Non-VAT</SelectItem>
                  <SelectItem value="NO_TIN">No TIN</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cf-credit">Credit terms</Label>
              <Select value={form.creditTermDays || "none"} onValueChange={(v) => set("creditTermDays", v && v !== "none" ? v : "")}>
                <SelectTrigger id="cf-credit" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No terms</SelectItem>
                  {creditTerms.map((d) => (
                    <SelectItem key={d} value={String(d)}>{d} days</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="cf-status">Status</Label>
            <Select value={form.status} onValueChange={(v) => set("status", (v ?? "ACTIVE") as FormState["status"])}>
              <SelectTrigger id="cf-status" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="INACTIVE">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="cf-notes">Notes</Label>
          <Textarea id="cf-notes" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </div>

        <div className="flex gap-2">
          <Button onClick={submit} disabled={pending || !form.lastName.trim() || !form.firstName.trim()}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
          <Button variant="ghost" nativeButton={false} render={<Link href={detailHref} />}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}
