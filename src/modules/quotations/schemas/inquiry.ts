import { z } from "zod";

// Inquiry log (spec 1.2 step 1) — the pre-quote entry point. No customer
// record yet: the Customer master row is created when the quote is made,
// so casual inquiries never pollute the master.

export const INQUIRY_MEDIUMS = [
  "MESSENGER",
  "EMAIL",
  "WALK_IN",
  "CALL",
  "PORTAL",
] as const;

// PH mobile number: 11 digits starting 09 (blank allowed). The UI strips
// non-digits, but validate here too for the portal/API path.
const phContact = z
  .string()
  .trim()
  .regex(/^09\d{9}$/, "Enter an 11-digit number starting with 09.")
  .or(z.literal(""))
  .optional();

const inquiryFields = z.object({
  customerName: z
    .string()
    .trim()
    .min(1, "Customer Name is required.")
    .max(200),
  contactNumber: phContact,
  email: z.string().trim().max(200).optional(),
  medium: z.enum(INQUIRY_MEDIUMS),
  servicesRequested: z
    .string()
    .trim()
    .min(1, "What is the customer asking for?")
    .max(500),
  notes: z.string().trim().max(2000).optional(),
});

// The public quote-request page (anonymous). `website` is a honeypot: bots
// fill it, humans never see it.
export const portalRequestInput = z.object({
  customerName: z.string().trim().min(2, "Please tell us your name.").max(200),
  contactNumber: phContact,
  email: z
    .string()
    .trim()
    .email("Enter a valid email.")
    .max(200)
    .or(z.literal(""))
    .optional(),
  servicesRequested: z
    .string()
    .trim()
    .min(3, "Tell us what you need.")
    .max(500),
  notes: z.string().trim().max(2000).optional(),
  // Honeypot must VALIDATE when filled — the handler silently drops it; a
  // validation error here would tell bots which field tripped them.
  website: z.string().max(500).optional(),
});

export type PortalRequestInput = z.infer<typeof portalRequestInput>;

export const inquiryCreateInput = inquiryFields;

export const inquiryUpdateInput = inquiryFields.extend({
  id: z.string().min(1),
});

export const inquiryListFilters = z.object({
  q: z.string().trim().max(200).optional(),
  view: z.enum(["open", "quoted", "all"]).default("open"),
  cursor: z.string().optional(),
  take: z.coerce.number().int().min(1).max(100).default(25),
});

export type InquiryCreateInput = z.infer<typeof inquiryCreateInput>;
export type InquiryUpdateInput = z.infer<typeof inquiryUpdateInput>;
export type InquiryListFilters = z.infer<typeof inquiryListFilters>;

// ——— DTOs ———

export type InquiryRowDto = {
  id: string;
  customerName: string;
  contactNumber: string | null;
  email: string | null;
  medium: string;
  servicesRequested: string;
  notes: string | null;
  quotationId: string | null;
  quoteNumber: string | null;
  quoteStatus: string | null;
  createdAt: string;
  createdByName: string;
};

export type InquiryPageDto = {
  rows: InquiryRowDto[];
  nextCursor: string | null;
};
