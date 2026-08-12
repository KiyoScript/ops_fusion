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
import { TinField } from "@/components/validated-fields";
import { updateCompanyAction } from "@/app/(app)/customers/actions";
import type { CompanyDetailDto } from "../schemas/company";

type Vat = "" | "VAT" | "NON_VAT" | "NO_TIN";

export function CompanyEditForm({
  company,
  creditTerms,
}: {
  company: CompanyDetailDto;
  creditTerms: number[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [f, setF] = useState({
    name: company.name,
    tin: company.tin ?? "",
    vatStatus: (company.vatStatus ?? "") as Vat,
    creditTermDays: company.creditTermDays !== null ? String(company.creditTermDays) : "",
    creditLimit: company.creditLimit ?? "",
    address: company.address ?? "",
    email: company.email ?? "",
    contactNumber: company.contactNumber ?? "",
    notes: company.notes ?? "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const detailHref = `/customers/companies/${company.id}`;

  const submit = () => {
    if (!f.name.trim()) { toast.error("Company name is required."); return; }
    if (!f.tin.trim()) { toast.error("TIN is required."); return; }
    start(async () => {
      const res = await updateCompanyAction({
        id: company.id,
        name: f.name.trim(),
        tin: f.tin.trim(),
        vatStatus: f.vatStatus || undefined,
        creditTermDays: f.creditTermDays ? Number(f.creditTermDays) : undefined,
        creditLimit: f.creditLimit ? Number(f.creditLimit) : undefined,
        address: f.address.trim() || undefined,
        email: f.email.trim() || undefined,
        contactNumber: f.contactNumber.trim() || undefined,
        notes: f.notes.trim() || undefined,
      });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Company updated — billing synced to its contacts.");
      router.push(detailHref);
      router.refresh();
    });
  };

  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="ce-name">Company name</Label>
            <Input id="ce-name" value={f.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ce-tin">TIN</Label>
            <TinField id="ce-tin" value={f.tin} onChange={(v) => set("tin", v)} />
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="ce-vat">Tax status</Label>
            <Select value={f.vatStatus || "none"} onValueChange={(v) => set("vatStatus", (!v || v === "none" ? "" : v) as Vat)}>
              <SelectTrigger id="ce-vat" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                <SelectItem value="VAT">VAT</SelectItem>
                <SelectItem value="NON_VAT">Non-VAT</SelectItem>
                <SelectItem value="NO_TIN">No TIN</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ce-terms">Credit terms</Label>
            <Select value={f.creditTermDays || "none"} onValueChange={(v) => set("creditTermDays", v && v !== "none" ? v : "")}>
              <SelectTrigger id="ce-terms" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No terms</SelectItem>
                {creditTerms.map((d) => <SelectItem key={d} value={String(d)}>{d} days</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ce-limit">Credit limit (₱)</Label>
            <Input id="ce-limit" inputMode="decimal" value={f.creditLimit} onChange={(e) => set("creditLimit", e.target.value)} />
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="ce-email">Company email</Label>
            <Input id="ce-email" value={f.email} onChange={(e) => set("email", e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ce-contact">Company contact #</Label>
            <Input id="ce-contact" value={f.contactNumber} onChange={(e) => set("contactNumber", e.target.value)} />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ce-address">Billing address</Label>
          <Textarea id="ce-address" rows={2} value={f.address} onChange={(e) => set("address", e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ce-notes">Notes</Label>
          <Textarea id="ce-notes" rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">
          Saving updates every contact person&apos;s billing (TIN, tax status, credit terms) to match.
        </p>
        <div className="flex gap-2">
          <Button onClick={submit} disabled={pending || !f.name.trim()}>{pending ? "Saving…" : "Save changes"}</Button>
          <Button variant="ghost" nativeButton={false} render={<Link href={detailHref} />}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}
