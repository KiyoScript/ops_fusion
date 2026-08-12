import { z } from "zod";
import { CustomerStatus } from "@/generated/prisma/enums";

// ══════════════════════════════════════════════════════════════════════════
// Customer master directory. Customers are created upstream (the quotation
// flow's find-or-create); this module lists them, shows the full 360 (master
// record + every document they appear on), and edits the master fields.
// ══════════════════════════════════════════════════════════════════════════

export const customerListFilters = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(CustomerStatus).optional(),
  cursor: z.string().optional(),
  take: z.coerce.number().int().min(1).max(100).default(30),
});
export type CustomerListFilters = z.infer<typeof customerListFilters>;

// ——— Edit ———

export const customerUpdateInput = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, "Name is required.").max(200),
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
  tin: z.string().trim().max(40).optional(),
  vatRegistered: z.coerce.boolean().default(false),
  status: z.enum(CustomerStatus).default(CustomerStatus.ACTIVE),
  notes: z.string().trim().max(2000).optional(),
});
export type CustomerUpdateInput = z.infer<typeof customerUpdateInput>;

export type CustomerEditDto = {
  id: string;
  name: string;
  company: string | null;
  contactNumber: string | null;
  email: string | null;
  address: string | null;
  shippingAddress: string | null;
  tin: string | null;
  vatRegistered: boolean;
  status: CustomerStatus;
  notes: string | null;
};

// ——— List ———

export type CustomerListRowDto = {
  id: string;
  name: string;
  company: string | null;
  contactNumber: string | null;
  email: string | null;
  tin: string | null;
  status: CustomerStatus;
  vatRegistered: boolean;
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

// ——— Detail (customer 360) ———

export type QuoteRefDto = { id: string; number: string; status: string; total: string; createdAt: string };
export type JoRefDto = { id: string; number: string; status: string; total: string; createdAt: string };
export type DrRefDto = { id: string; number: string; status: string; issuedAt: string };
export type SaleRefDto = { id: string; documentNo: string; paymentStatus: string; amount: string; saleDate: string };
export type CrRefDto = { id: string; number: string | null; amount: string; receivedAt: string };
export type ApRefDto = { id: string; amount: string; status: string; receivedAt: string };

export type CustomerDetailDto = {
  id: string;
  name: string;
  company: string | null;
  contactNumber: string | null;
  email: string | null;
  address: string | null;
  shippingAddress: string | null;
  tin: string | null;
  status: CustomerStatus;
  vatRegistered: boolean;
  creditTermDays: number | null;
  creditLimit: string | null;
  notes: string | null;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  counts: {
    quotations: number;
    jobOrders: number;
    deliveryReceipts: number;
    sales: number;
    collectionReceipts: number;
    advancePayments: number;
    inquiries: number;
  };
  quotations: QuoteRefDto[];
  jobOrders: JoRefDto[];
  deliveries: DrRefDto[];
  sales: SaleRefDto[];
  collections: CrRefDto[];
  advancePayments: ApRefDto[];
};
