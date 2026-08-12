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
import { addCustomerAction } from "@/app/(app)/customers/actions";
import { CompanyCombobox } from "./company-combobox";
import type { CompanyPickerDto } from "../schemas/company";

type Kind = "COMPANY" | "INDIVIDUAL";
type Vat = "" | "VAT" | "NON_VAT" | "NO_TIN";

export function CustomerCreateForm({
  creditTerms,
  initialCompany,
}: {
  creditTerms: number[];
  /** When set, the form opens in COMPANY mode locked to this company (adding a
   *  contact to it). */
  initialCompany?: CompanyPickerDto | null;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>(initialCompany ? "COMPANY" : "INDIVIDUAL");
  const [pending, start] = useTransition();
  const [attempted, setAttempted] = useState(false);

  // shared / individual
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [companyFree, setCompanyFree] = useState("");
  const [address, setAddress] = useState("");
  const [shipping, setShipping] = useState("");
  const [tin, setTin] = useState("");
  const [vat, setVat] = useState<Vat>("");
  const [terms, setTerms] = useState("");
  const [notes, setNotes] = useState("");

  // company
  const [coName, setCoName] = useState(initialCompany?.name ?? "");
  const [coTin, setCoTin] = useState(initialCompany?.tin ?? "");
  const [coVat, setCoVat] = useState<Vat>((initialCompany?.vatStatus ?? "") as Vat);
  const [coTerms, setCoTerms] = useState(initialCompany?.creditTermDays != null ? String(initialCompany.creditTermDays) : "");
  const [coAddress, setCoAddress] = useState(initialCompany?.address ?? "");
  const [coEmail, setCoEmail] = useState(initialCompany?.email ?? "");
  const [coContact, setCoContact] = useState(initialCompany?.contactNumber ?? "");
  const [companyId, setCompanyId] = useState<string | null>(initialCompany?.id ?? null); // set when an existing company is picked
  // first contact person
  const [cpName, setCpName] = useState("");
  const [cpDept, setCpDept] = useState("");
  const [cpPos, setCpPos] = useState("");
  const [cpEmail, setCpEmail] = useState("");
  const [cpContact, setCpContact] = useState("");

  const pickCompany = (c: CompanyPickerDto) => {
    setCompanyId(c.id);
    setCoName(c.name);
    setCoTin(c.tin ?? "");
    setCoVat((c.vatStatus ?? "") as Vat);
    setCoTerms(c.creditTermDays !== null ? String(c.creditTermDays) : "");
    setCoAddress(c.address ?? "");
    setCoEmail(c.email ?? "");
    setCoContact(c.contactNumber ?? "");
  };

  const submit = () => {
    setAttempted(true);
    if (kind === "INDIVIDUAL") {
      if (!name.trim()) { toast.error("Name is required."); return; }
      if (!isValidPhContact(contact)) { toast.error("A valid mobile number is required."); return; }
      start(async () => {
        const res = await addCustomerAction({
          kind: "INDIVIDUAL",
          name: name.trim(),
          contactNumber: contact.trim(),
          email: email.trim() || undefined,
          company: companyFree.trim() || undefined,
          address: address.trim() || undefined,
          shippingAddress: shipping.trim() || undefined,
          tin: tin.trim() || undefined,
          vatStatus: vat || undefined,
          creditTermDays: terms ? Number(terms) : undefined,
          notes: notes.trim() || undefined,
        });
        if (!res.ok) { toast.error(res.error); return; }
        toast.success("Customer added.");
        router.push(`/customers/${res.data.customerId}`);
        router.refresh();
      });
      return;
    }
    // COMPANY
    if (!companyId) {
      if (!coName.trim()) { toast.error("Company name is required."); return; }
      if (!coTin.trim()) { toast.error("Company TIN is required."); return; }
    }
    if (!cpName.trim()) { toast.error("Contact person name is required."); return; }
    if (!cpDept.trim()) { toast.error("Department is required."); return; }
    if (!cpPos.trim()) { toast.error("Position is required."); return; }
    if (!cpEmail.trim()) { toast.error("Official email is required."); return; }
    if (!isValidPhContact(cpContact)) { toast.error("A valid contact-person mobile is required."); return; }
    start(async () => {
      const res = await addCustomerAction({
        kind: "COMPANY",
        ...(companyId
          ? { companyId }
          : {
              company: {
                name: coName.trim(),
                tin: coTin.trim(),
                vatStatus: coVat || undefined,
                creditTermDays: coTerms ? Number(coTerms) : undefined,
                address: coAddress.trim() || undefined,
                email: coEmail.trim() || undefined,
                contactNumber: coContact.trim() || undefined,
              },
            }),
        contact: {
          name: cpName.trim(),
          department: cpDept.trim(),
          position: cpPos.trim(),
          email: cpEmail.trim(),
          contactNumber: cpContact.trim(),
        },
      });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Company + contact added.");
      router.push(`/customers/${res.data.customerId}`);
      router.refresh();
    });
  };

  return (
    <Card>
      <CardContent className="grid gap-5 pt-6">
        <div className="grid gap-1.5 sm:max-w-xs">
          <Label htmlFor="cc-kind">Customer type</Label>
          <Select value={kind} onValueChange={(v) => setKind((v as Kind) ?? "INDIVIDUAL")}>
            <SelectTrigger id="cc-kind" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="INDIVIDUAL">Non-company (individual)</SelectItem>
              <SelectItem value="COMPANY">Company</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {kind === "INDIVIDUAL" ? (
          <div className="grid gap-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} aria-invalid={attempted && !name.trim()} /></Field>
              <Field label="Company (optional)"><Input value={companyFree} onChange={(e) => setCompanyFree(e.target.value)} /></Field>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Mobile number" required>
                <ContactField value={contact} onChange={setContact} aria-invalid={attempted && !isValidPhContact(contact)} />
              </Field>
              <Field label="Email"><Input value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Billing address"><Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
              <Field label="Shipping address"><Textarea rows={2} value={shipping} onChange={(e) => setShipping(e.target.value)} /></Field>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <Field label="TIN"><TinField value={tin} onChange={setTin} /></Field>
              <Field label="Tax status"><VatSelect id="cc-vat" value={vat} onChange={setVat} /></Field>
              <Field label="Credit terms"><CreditTermsSelect id="cc-terms" value={terms} onChange={setTerms} creditTerms={creditTerms} /></Field>
            </div>
            <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </div>
        ) : (
          <div className="grid gap-5">
            <section className="grid gap-4 rounded-lg border border-border/60 p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Company (billed entity)</h3>
                {companyId && (
                  <button type="button" className="text-xs text-muted-foreground underline" onClick={() => { setCompanyId(null); setCoName(""); setCoTin(""); setCoVat(""); setCoTerms(""); setCoAddress(""); setCoEmail(""); setCoContact(""); }}>
                    Enter a new company instead
                  </button>
                )}
              </div>
              {companyId && (
                <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  Adding a new contact to <strong>{coName}</strong> — its billing is reused (edit it on the company profile).
                </p>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Company name" required>
                  <CompanyCombobox
                    id="cc-co-name"
                    value={coName}
                    onChange={(v) => { setCoName(v); setCompanyId(null); }}
                    onPick={pickCompany}
                    invalid={attempted && !companyId && !coName.trim()}
                  />
                </Field>
                <Field label="TIN" required>
                  <TinField value={coTin} onChange={setCoTin} aria-invalid={attempted && !companyId && !coTin.trim()} readOnly={!!companyId} className={companyId ? "bg-muted/50 text-muted-foreground" : undefined} />
                </Field>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <Field label="Tax status"><VatSelect id="cc-co-vat" value={coVat} onChange={setCoVat} disabled={!!companyId} /></Field>
                <Field label="Credit terms"><CreditTermsSelect id="cc-co-terms" value={coTerms} onChange={setCoTerms} creditTerms={creditTerms} disabled={!!companyId} /></Field>
                <Field label="Company contact #"><Input value={coContact} onChange={(e) => setCoContact(e.target.value)} readOnly={!!companyId} className={companyId ? "bg-muted/50 text-muted-foreground" : undefined} /></Field>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Company email"><Input value={coEmail} onChange={(e) => setCoEmail(e.target.value)} readOnly={!!companyId} className={companyId ? "bg-muted/50 text-muted-foreground" : undefined} /></Field>
                <Field label="Billing address"><Textarea rows={2} value={coAddress} onChange={(e) => setCoAddress(e.target.value)} readOnly={!!companyId} className={companyId ? "bg-muted/50 text-muted-foreground" : undefined} /></Field>
              </div>
            </section>
            <section className="grid gap-4 rounded-lg border border-border/60 p-4">
              <h3 className="text-sm font-semibold">First contact person</h3>
              <div className="grid gap-2 sm:grid-cols-3">
                <Field label="Name" required><Input value={cpName} onChange={(e) => setCpName(e.target.value)} aria-invalid={attempted && !cpName.trim()} /></Field>
                <Field label="Department" required><Input value={cpDept} onChange={(e) => setCpDept(e.target.value)} aria-invalid={attempted && !cpDept.trim()} /></Field>
                <Field label="Position" required><Input value={cpPos} onChange={(e) => setCpPos(e.target.value)} aria-invalid={attempted && !cpPos.trim()} /></Field>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Official email" required><Input value={cpEmail} onChange={(e) => setCpEmail(e.target.value)} aria-invalid={attempted && !cpEmail.trim()} /></Field>
                <Field label="Contact number" required>
                  <ContactField value={cpContact} onChange={setCpContact} aria-invalid={attempted && !isValidPhContact(cpContact)} />
                </Field>
              </div>
            </section>
          </div>
        )}

        <div className="flex gap-2">
          <Button onClick={submit} disabled={pending}>{pending ? "Saving…" : "Add customer"}</Button>
          <Button variant="ghost" nativeButton={false} render={<Link href="/customers" />}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}{required && <span className="text-destructive"> *</span>}</Label>
      {children}
    </div>
  );
}

function VatSelect({ value, onChange, id, disabled }: { value: Vat; onChange: (v: Vat) => void; id: string; disabled?: boolean }) {
  return (
    <Select value={value || "none"} onValueChange={(v) => onChange((!v || v === "none" ? "" : v) as Vat)} disabled={disabled}>
      <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="none">—</SelectItem>
        <SelectItem value="VAT">VAT</SelectItem>
        <SelectItem value="NON_VAT">Non-VAT</SelectItem>
        <SelectItem value="NO_TIN">No TIN</SelectItem>
      </SelectContent>
    </Select>
  );
}

function CreditTermsSelect({ value, onChange, id, creditTerms, disabled }: { value: string; onChange: (v: string) => void; id: string; creditTerms: number[]; disabled?: boolean }) {
  return (
    <Select value={value || "none"} onValueChange={(v) => onChange(v && v !== "none" ? v : "")} disabled={disabled}>
      <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="none">No terms</SelectItem>
        {creditTerms.map((d) => <SelectItem key={d} value={String(d)}>{d} days</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
