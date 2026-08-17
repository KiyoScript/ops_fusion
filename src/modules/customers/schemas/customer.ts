import { z } from "zod";
import { CustomerStatus, VatStatus } from "@/generated/prisma/enums";
import type { CompanyAttachmentDto } from "./company";

// ══════════════════════════════════════════════════════════════════════════
// Customer master directory. Customers are created upstream (the quotation
// flow's find-or-create); this module lists them, shows the full 360 (master
// record + every document they appear on), and edits the master fields.
// ══════════════════════════════════════════════════════════════════════════

// Structured person name — the source of truth for every person customer
// (individual or company contact). Last + First required; MI optional. The
// display `name` is composed from these (composePersonName).
export const personNameFields = {
  lastName: z.string().trim().min(1, "Last name is required.").max(100),
  firstName: z.string().trim().min(1, "First name is required.").max(100),
  middleInitial: z.string().trim().max(20).optional(),
};

export const customerListFilters = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(CustomerStatus).optional(),
  vatStatus: z.enum(VatStatus).optional(),
  /** Only non-company individuals (companyId null) — the Individuals tab. */
  individualsOnly: z.coerce.boolean().optional(),
  cursor: z.string().optional(),
  take: z.coerce.number().int().min(1).max(100).default(30),
});
export type CustomerListFilters = z.infer<typeof customerListFilters>;

// ——— Edit ———

export const customerUpdateInput = z.object({
  id: z.string().min(1),
  ...personNameFields,
  company: z.string().trim().max(200).optional(),
  // Mobile number is MANDATORY (PH format). 09XXXXXXXXX or +639XXXXXXXXX.
  contactNumber: z
    .string()
    .trim()
    .min(1, "Mobile number is required.")
    .regex(
      /^(09\d{9}|\+639\d{9})$/,
      "Enter an 11-digit mobile starting with 09 (or +63 format)."
    ),
  email: z.string().trim().max(200).optional(),
  address: z.string().trim().max(500).optional(), // billing
  shippingAddress: z.string().trim().max(500).optional(),
  // Contact-person fields (company contacts). Ignored for individuals.
  department: z.string().trim().max(120).optional(),
  position: z.string().trim().max(120).optional(),
  // Billing — for individuals these edit here; for company contacts the
  // company owns them (kept in sync), so the service ignores them.
  tin: z.string().trim().max(40).optional(),
  vatStatus: z.enum(VatStatus).optional(),
  creditTermDays: z.coerce.number().int().min(0).max(365).optional(),
  status: z.enum(CustomerStatus).default(CustomerStatus.ACTIVE),
  notes: z.string().trim().max(2000).optional(),
});
export type CustomerUpdateInput = z.infer<typeof customerUpdateInput>;

export type CustomerEditDto = {
  id: string;
  name: string;
  lastName: string | null;
  firstName: string | null;
  middleInitial: string | null;
  company: string | null;
  companyId: string | null;
  department: string | null;
  position: string | null;
  contactNumber: string | null;
  email: string | null;
  address: string | null;
  shippingAddress: string | null;
  tin: string | null;
  vatStatus: VatStatus | null;
  creditTermDays: number | null;
  status: CustomerStatus;
  notes: string | null;
};

// Soft-duplicate match returned by the name-check (non-blocking warning): an
// existing customer whose composed name equals the one being entered.
export type DuplicateNameMatch = {
  id: string;
  name: string;
  company: string | null;
  companyId: string | null;
  status: CustomerStatus;
  createdAt: string;
};

// ——— List ———

export type CustomerListRowDto = {
  id: string;
  name: string;
  company: string | null;
  companyId: string | null;
  contactNumber: string | null;
  email: string | null;
  tin: string | null;
  status: CustomerStatus;
  vatStatus: VatStatus | null;
  creditTermDays: number | null;
  creditLimit: string | null;
  quotationCount: number;
  jobOrderCount: number;
  createdAt: string;
};

export type CustomerListPageDto = {
  rows: CustomerListRowDto[];
  nextCursor: string | null;
};

// At-a-glance directory metrics for the Customers dashboard.
export type CustomerMetricsDto = {
  companies: number;
  individuals: number;
  contacts: number;
  totalCustomers: number;
  vat: number;
  nonVat: number;
  noTin: number;
  withTerms: number;
  active: number;
  inactive: number;
};

// ——— Detail (customer 360) ———

export type QuoteRefDto = { id: string; number: string; status: string; total: string; createdAt: string; summary: string; itemCount: number };
export type JoRefDto = { id: string; number: string; status: string; total: string; createdAt: string; summary: string; itemCount: number };
export type DrRefDto = { id: string; number: string; status: string; issuedAt: string; summary: string; itemCount: number };
export type SaleRefDto = {
  id: string;
  documentNo: string;
  type: string;
  paymentStatus: string;
  amount: string;
  /** `amount − amountPaid − settledAmount`, floored at zero — the only honest
   *  answer to "what is still owed on this receipt" (docs/sales-contract.md R3). */
  openBalance: string;
  vatAmount: string;
  dueDate: string | null;
  daysOverdue: number | null;
  saleDate: string;
};
export type CrRefDto = {
  id: string;
  number: string | null;
  /** False → money came in with no printed CR, so no booklet leaf was used. */
  documentIssued: boolean;
  amount: string;
  method: string;
  receivedAt: string;
};
export type ApRefDto = {
  id: string;
  amount: string;
  /** What is still available to spend — NOT `amount` (R6). */
  remaining: string;
  status: string;
  receivedAt: string;
};

/**
 * Lifetime money for one customer, aggregated server-side over every document.
 *
 * Separate from the capped document lists above precisely because it must not
 * be derived from them: those stop at 50 rows, and a total computed from a
 * page is wrong without ever looking wrong (R7).
 */
export type CustomerFinancialTotals = {
  /** Revenue booked to this customer across every live invoice. */
  lifetimeBilled: string;
  /** Counter payments plus later collections applied to their invoices. */
  lifetimeReceived: string;
  /** billed − received. The customer's own contribution to A/R. */
  openBalance: string;
  lifetimeVat: string;
  documentCount: number;
  /** Cancelled / voided / replaced receipts — excluded from every figure above,
   *  surfaced separately so the exclusion is visible rather than silent. */
  voidedCount: number;
};

export type CustomerDetailDto = {
  id: string;
  name: string;
  company: string | null;
  companyId: string | null;
  department: string | null;
  position: string | null;
  contactNumber: string | null;
  email: string | null;
  address: string | null;
  shippingAddress: string | null;
  tin: string | null;
  status: CustomerStatus;
  vatStatus: VatStatus | null;
  creditTermDays: number | null;
  creditLimit: string | null;
  notes: string | null;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  totals: CustomerFinancialTotals;
  counts: {
    quotations: number;
    jobOrders: number;
    deliveryReceipts: number;
    sales: number;
    collectionReceipts: number;
    advancePayments: number;
    inquiries: number;
  };
  attachments: CompanyAttachmentDto[];
  quotations: QuoteRefDto[];
  jobOrders: JoRefDto[];
  deliveries: DrRefDto[];
  sales: SaleRefDto[];
  collections: CrRefDto[];
  advancePayments: ApRefDto[];
};
