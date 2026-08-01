"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  createSupplierAction,
  updateSupplierAction,
} from "@/app/(app)/maintenance/inventory/actions";
import { useInvalidateInventory } from "../hooks/use-inventory";
import type { SupplierDto } from "../schemas/material";

type FormState = {
  code: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  status: "ACTIVE" | "INACTIVE";
};

const empty: FormState = { code: "", name: "", contactPerson: "", phone: "", email: "", address: "", notes: "", status: "ACTIVE" };

function fromSupplier(s: SupplierDto): FormState {
  return {
    code: s.code ?? "",
    name: s.name,
    contactPerson: s.contactPerson ?? "",
    phone: s.phone ?? "",
    email: s.email ?? "",
    address: s.address ?? "",
    notes: s.notes ?? "",
    status: s.status,
  };
}

export function SupplierFormDialog({
  open,
  onOpenChange,
  supplier,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  supplier?: SupplierDto | null;
}) {
  const router = useRouter();
  const invalidate = useInvalidateInventory();
  const [form, setForm] = useState<FormState>(empty);
  const [pending, startTransition] = useTransition();
  const isEdit = !!supplier;

  // Seed the form at render time (not in an effect) when the dialog opens.
  const formKey = open ? (supplier?.id ?? "new") : "closed";
  const [syncedKey, setSyncedKey] = useState(formKey);
  if (formKey !== syncedKey) {
    setSyncedKey(formKey);
    if (open) setForm(supplier ? fromSupplier(supplier) : empty);
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = () => {
    const payload = {
      ...(isEdit ? { id: supplier!.id } : {}),
      code: form.code.trim() || undefined,
      name: form.name.trim(),
      contactPerson: form.contactPerson.trim() || undefined,
      phone: form.phone.trim() || undefined,
      email: form.email.trim() || undefined,
      address: form.address.trim() || undefined,
      notes: form.notes.trim() || undefined,
      status: form.status,
    };
    startTransition(async () => {
      const result = isEdit ? await updateSupplierAction(payload) : await createSupplierAction(payload);
      if (!result.ok) { toast.error(result.error); return; }
      toast.success(isEdit ? "Supplier updated." : "Supplier added.");
      invalidate();
      router.refresh();
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit supplier" : "Add supplier"}</DialogTitle>
          <DialogDescription>Suppliers can be linked to items and (later) purchase orders.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2 sm:grid-cols-[1fr_2fr]">
            <div className="grid gap-1.5">
              <Label htmlFor="sf-code">Code</Label>
              <Input id="sf-code" value={form.code} onChange={(e) => set("code", e.target.value)} placeholder="optional" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sf-name">Name</Label>
              <Input id="sf-name" value={form.name} onChange={(e) => set("name", e.target.value)} />
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="sf-contact">Contact person</Label>
              <Input id="sf-contact" value={form.contactPerson} onChange={(e) => set("contactPerson", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sf-phone">Phone</Label>
              <Input id="sf-phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="sf-email">Email</Label>
              <Input id="sf-email" value={form.email} onChange={(e) => set("email", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sf-status">Status</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v as FormState["status"])}>
                <SelectTrigger id="sf-status" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="INACTIVE">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sf-address">Address</Label>
            <Textarea id="sf-address" rows={2} value={form.address} onChange={(e) => set("address", e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sf-notes">Notes</Label>
            <Textarea id="sf-notes" rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
        </div>

        <DialogFooter showCloseButton>
          <Button onClick={submit} disabled={pending || !form.name.trim()}>
            {pending ? "Saving…" : isEdit ? "Save changes" : "Add supplier"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
