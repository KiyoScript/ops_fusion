import { z } from "zod";
import { VatStatus } from "@/generated/prisma/enums";
import { personNameFields } from "./customer";

const phMobile = z
  .string()
  .trim()
  .min(1, "Mobile number is required.")
  .regex(
    /^(09\d{9}|\+639\d{9})$/,
    "Enter an 11-digit mobile starting with 09 (or +63 format)."
  );

// ——— Company billing fields (create + update) ———
export const companyInput = z.object({
  name: z.string().trim().min(1, "Company name is required.").max(200),
  tin: z.string().trim().min(1, "TIN is required for a company.").max(40),
  vatStatus: z.enum(VatStatus).optional(),
  creditTermDays: z.coerce.number().int().min(0).max(365).optional(),
  creditLimit: z.coerce.number().min(0).optional(),
  address: z.string().trim().max(500).optional(),
  email: z.string().trim().max(200).optional(),
  contactNumber: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type CompanyInput = z.infer<typeof companyInput>;

export const companyUpdateInput = companyInput.extend({ id: z.string().min(1) });
export type CompanyUpdateInput = z.infer<typeof companyUpdateInput>;

// A contact person of a company (required fields per the spec).
const contactPersonInput = z.object({
  ...personNameFields,
  department: z.string().trim().min(1, "Department is required.").max(120),
  position: z.string().trim().min(1, "Position is required.").max(120),
  email: z.string().trim().min(1, "Official email is required.").max(200),
  contactNumber: phMobile,
});
export type ContactPersonInput = z.infer<typeof contactPersonInput>;

// ——— Add-customer flow: Company (company + first contact) or Individual ———
export const addCustomerInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("COMPANY"),
    // Set when adding a contact to an EXISTING company (its billing is reused);
    // otherwise `company` carries the details for a NEW company.
    companyId: z.string().optional(),
    company: companyInput.optional(),
    contact: contactPersonInput,
  }),
  z.object({
    kind: z.literal("INDIVIDUAL"),
    ...personNameFields,
    contactNumber: phMobile,
    email: z.string().trim().max(200).optional(),
    company: z.string().trim().max(200).optional(), // free-text (not an entity)
    address: z.string().trim().max(500).optional(),
    shippingAddress: z.string().trim().max(500).optional(),
    tin: z.string().trim().max(40).optional(),
    vatStatus: z.enum(VatStatus).optional(),
    creditTermDays: z.coerce.number().int().min(0).max(365).optional(),
    notes: z.string().trim().max(2000).optional(),
  }),
]);
export type AddCustomerInput = z.infer<typeof addCustomerInput>;

// ——— DTOs ———
export type CompanyListRowDto = {
  id: string;
  name: string;
  tin: string | null;
  vatStatus: VatStatus | null;
  creditTermDays: number | null;
  contactCount: number;
  createdAt: string;
};

export type CompanyContactRefDto = {
  id: string;
  name: string;
  department: string | null;
  position: string | null;
  contactNumber: string | null;
  email: string | null;
  status: string;
};

export type CompanyAttachmentDto = {
  id: string;
  kind: string;
  fileName: string;
  size: number;
  createdAt: string;
  uploadedByName: string;
};

export type CompanyDetailDto = {
  id: string;
  name: string;
  tin: string | null;
  vatStatus: VatStatus | null;
  creditTermDays: number | null;
  creditLimit: string | null;
  address: string | null;
  email: string | null;
  contactNumber: string | null;
  notes: string | null;
  createdByName: string;
  createdAt: string;
  contacts: CompanyContactRefDto[];
  attachments: CompanyAttachmentDto[];
};

export type CompanySearchDto = {
  id: string;
  name: string;
  contacts: { id: string; name: string; department: string | null; position: string | null }[];
};

// Company picker for the add-customer flow — carries billing so selecting an
// existing company auto-fills (read-only) and just adds a new contact person.
export type CompanyPickerDto = {
  id: string;
  name: string;
  tin: string | null;
  vatStatus: VatStatus | null;
  creditTermDays: number | null;
  creditLimit: string | null;
  address: string | null;
  email: string | null;
  contactNumber: string | null;
  contactCount: number;
};
