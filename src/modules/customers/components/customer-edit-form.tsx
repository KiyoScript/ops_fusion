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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateCustomerAction } from "@/app/(app)/customers/actions";
import type { CustomerEditDto } from "../schemas/customer";

type FormState = {
  name: string;
  company: string;
  contactNumber: string;
  email: string;
  address: string;
  tin: string;
  vatRegistered: boolean;
  status: "ACTIVE" | "INACTIVE";
  notes: string;
};

export function CustomerEditForm({ customer }: { customer: CustomerEditDto }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({
    name: customer.name,
    company: customer.company ?? "",
    contactNumber: customer.contactNumber ?? "",
    email: customer.email ?? "",
    address: customer.address ?? "",
    tin: customer.tin ?? "",
    vatRegistered: customer.vatRegistered,
    status: customer.status,
    notes: customer.notes ?? "",
  });
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const detailHref = `/customers/${customer.id}`;

  const submit = () => {
    if (!form.name.trim()) { toast.error("Name is required."); return; }
    startTransition(async () => {
      const result = await updateCustomerAction({
        id: customer.id,
        name: form.name.trim(),
        company: form.company.trim() || undefined,
        contactNumber: form.contactNumber.trim() || undefined,
        email: form.email.trim() || undefined,
        address: form.address.trim() || undefined,
        tin: form.tin.trim() || undefined,
        vatRegistered: form.vatRegistered,
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
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="cf-name">Name</Label>
            <Input id="cf-name" value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cf-company">Company</Label>
            <Input id="cf-company" value={form.company} onChange={(e) => set("company", e.target.value)} />
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="cf-contact">Contact number</Label>
            <Input id="cf-contact" value={form.contactNumber} onChange={(e) => set("contactNumber", e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cf-email">Email</Label>
            <Input id="cf-email" value={form.email} onChange={(e) => set("email", e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cf-tin">TIN</Label>
            <Input id="cf-tin" value={form.tin} onChange={(e) => set("tin", e.target.value)} placeholder="000-000-000-000" />
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="cf-address">Address</Label>
          <Textarea id="cf-address" rows={2} value={form.address} onChange={(e) => set("address", e.target.value)} />
        </div>

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
          <div className="flex items-center gap-2 self-end pb-1">
            <Switch id="cf-vat" checked={form.vatRegistered} onCheckedChange={(v) => set("vatRegistered", v)} />
            <Label htmlFor="cf-vat" className="text-sm font-normal text-muted-foreground">VAT-registered</Label>
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="cf-notes">Notes</Label>
          <Textarea id="cf-notes" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </div>

        <div className="flex gap-2">
          <Button onClick={submit} disabled={pending || !form.name.trim()}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
          <Button variant="ghost" nativeButton={false} render={<Link href={detailHref} />}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}
