"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCreditTerms } from "../hooks/use-customers";
import { CustomerCreateForm } from "./customer-create-form";

/** Inline "create customer" used from a picker (e.g. New Quotation) when the
 *  typed customer isn't found. Hosts the full create form — non-company
 *  individual, a company + first contact, or a contact added to an existing
 *  company — and hands the created customer back to the caller instead of
 *  navigating away. */
export function CustomerCreateDialog({
  open,
  initialName,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  initialName?: string;
  onOpenChange: (open: boolean) => void;
  onCreated: (customer: {
    id: string;
    name: string;
    contactNumber: string | null;
  }) => void;
}) {
  const creditTerms = useCreditTerms();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New customer</DialogTitle>
          <DialogDescription>
            Add a non-company individual, or a company with its contact person.
            The new customer is selected on the quotation.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <CustomerCreateForm
            key={initialName ?? ""}
            creditTerms={creditTerms.data ?? []}
            initialName={initialName}
            onCreated={(c) => {
              onCreated(c);
              onOpenChange(false);
            }}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
