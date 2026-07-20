"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ContactField,
  isValidPhContact,
  todayISO,
} from "@/components/validated-fields";
import { CustomerCombobox } from "@/modules/job-orders/components/customer-combobox";

// Step 1 for every product wizard (legacy CLIENT INFO): name, contact,
// email, date needed. Kept as a shared piece so all wizards match.

export type ClientInfo = {
  customerName: string;
  contactNumber: string;
  email: string;
  dateNeeded: string;
};

export const EMPTY_CLIENT: ClientInfo = {
  customerName: "",
  contactNumber: "",
  email: "",
  dateNeeded: "",
};

export function isClientValid(client: ClientInfo): boolean {
  return client.customerName.trim().length > 0;
}

export function ClientInfoStep({
  value,
  onChange,
}: {
  value: ClientInfo;
  onChange: (next: ClientInfo) => void;
}) {
  const set = (patch: Partial<ClientInfo>) => onChange({ ...value, ...patch });

  return (
    <div className="grid gap-5">
      <div className="grid gap-1.5">
        <Label htmlFor="ci-name">
          Client Name <span className="text-destructive">*</span>
        </Label>
        <CustomerCombobox
          id="ci-name"
          value={value.customerName}
          onChange={(name) => set({ customerName: name })}
          // Returning customer: picking them auto-fills contact & email from
          // the customer master (typed values stay if the record is blank).
          onPick={(c) =>
            set({
              customerName: c.name,
              contactNumber: c.contactNumber ?? value.contactNumber,
              email: c.email ?? value.email,
            })
          }
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="ci-contact">Contact Number</Label>
          <ContactField
            id="ci-contact"
            value={value.contactNumber}
            onChange={(v) => set({ contactNumber: v })}
            aria-invalid={
              value.contactNumber.length > 0 &&
              !isValidPhContact(value.contactNumber)
            }
          />
          {value.contactNumber.length > 0 &&
            !isValidPhContact(value.contactNumber) && (
              <p className="text-xs text-destructive">
                Use 0917 123 4567 or +63 917 123 4567.
              </p>
            )}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ci-email">
            Email <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="ci-email"
            type="email"
            placeholder="email@example.com"
            value={value.email}
            onChange={(e) => set({ email: e.target.value })}
          />
        </div>
      </div>

      <div className="grid gap-1.5 sm:max-w-64">
        <Label htmlFor="ci-date">Date Needed</Label>
        <Input
          id="ci-date"
          type="date"
          min={todayISO()}
          value={value.dateNeeded}
          onChange={(e) => set({ dateNeeded: e.target.value })}
        />
      </div>
    </div>
  );
}
