import { z } from "zod";

// Zod schemas defined once and reused for Server Action validation, form
// validation (RHF resolver), and inferred types. Dates travel as "yyyy-MM-dd"
// strings (native date inputs); services convert to Date.

const dateString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date")
  .or(z.literal(""))
  .optional();

// qty/amount stay strings so the same schema types both the form values and
// the action payload; services convert to numbers.
const qtyString = z
  .string()
  .trim()
  .regex(/^[1-9]\d*$/, "Qty must be a whole number of at least 1");
const amountString = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Enter a valid amount")
  .refine((v) => parseFloat(v) > 0, "Amount must be greater than 0");

const itemFields = z.object({
  id: z.string().optional(), // present when editing an existing item
  // UI-only: quote-derived items lock the description AND the amount (which is
  // auto = qty × unitPrice). Both are ignored by the server on write.
  fromQuote: z.boolean().optional(),
  unitPrice: z.string().optional(),
  description: z.string().trim().min(1, "Job description is required"),
  qty: qtyString,
  amount: amountString, // line total, like the legacy "JO Amount"
  deadline: dateString,
  productionStatus: z.string().trim().max(120).optional(),
  remark: z.string().trim().max(500).optional(), // logged with a status change
  assignedTo: z.string().trim().max(300).optional(), // comma-separated codes
  category: z.string().trim().max(120).optional(),
  isLFP: z.boolean(),
  lfpWidth: z.string().trim().max(20).optional(),
  lfpHeight: z.string().trim().max(20).optional(),
  lfpUnit: z.string().trim().max(20).optional(),
  isRush: z.boolean(),
});

// NOTE: no LFP width/height validation — LFP is a product attribute now and its
// dimensions live in the item's specs (the tarp/area calculators). Neither the
// create nor edit form enters manual LFP dimensions, and the service derives
// isLFP from the catalog. Enforcing width/height would silently block saving any
// LFP item (tarpaulin etc.) whose lfpWidth/lfpHeight columns are null.
export const jobOrderItemInput = itemFields;

// Per-item edit modal (legacy updateJORow): item fields + optional status
// change with remark, in one save. NOTE: no lfpCheck here — LFP is a product
// attribute now and its dimensions live in the item's specs, so the edit dialog
// never shows width/height. Enforcing them would silently block saving ANY LFP
// item (tarpaulin etc.) whose lfpWidth/lfpHeight columns are null.
export const itemEditInput = itemFields.extend({
  id: z.string().min(1),
  jobOrderId: z.string().min(1),
  remark: z.string().trim().max(500).optional(),
});

// JO/PO typing (fusion-only, not in legacy): PO and non-JO numbers are typed
// manually; a plain JO gets an auto-generated "JO-ORM-{yymm}-{seq}".
const jobOrderBaseInput = z
  .object({
    joNumber: z.string().trim().max(60).optional(),
    isPO: z.boolean(),
    customerName: z.string().trim().min(1, "Customer Name is required.").max(200),
    notes: z.string().trim().max(2000).optional(),
    planDateStart: dateString,
    planDateEnd: dateString,
    items: z.array(jobOrderItemInput).min(1, "At least one item is required."),
  })
  .check((ctx) => {
    if (ctx.value.isPO && !ctx.value.joNumber) {
      ctx.issues.push({
        code: "custom",
        message: "PO Number is required.",
        path: ["joNumber"],
        input: ctx.value,
      });
    }
  });

// Legacy parity (submitNewJO): a NEW JO requires a deadline on every item.
// Edits don't re-validate it (updateJO never did) so imported historical
// items with blank deadlines stay editable.
export const jobOrderCreateInput = jobOrderBaseInput.check((ctx) => {
  ctx.value.items.forEach((item, index) => {
    if (!item.deadline) {
      ctx.issues.push({
        code: "custom",
        message: "Deadline is required.",
        path: ["items", index, "deadline"],
        input: ctx.value,
      });
    }
  });
});

export const jobOrderEditFormInput = jobOrderBaseInput;

export const jobOrderUpdateInput = jobOrderBaseInput.extend({
  id: z.string().min(1),
});

export const itemStatusUpdateInput = z.object({
  jobOrderId: z.string().min(1),
  itemId: z.string().min(1),
  productionStatus: z.string().trim().min(1, "Status is required").max(120),
  remark: z.string().trim().max(500).optional(),
});

export const jobOrderListFilters = z.object({
  q: z.string().trim().max(200).optional(),
  view: z
    .enum([
      "active",
      "ongoing",
      "waiting",
      "overdue",
      "custApproval",
      "smAlarming",
      "smOverdue",
      "review",
      "done",
      "all",
    ])
    .default("active"),
  cursor: z.string().optional(),
  take: z.coerce.number().int().min(1).max(100).default(25),
  // Transactions History filters (all optional; the board views ignore them).
  // Dates are inclusive and filter on the JO's createdAt (the booking date).
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  payment: z.enum(["PAID", "PARTIAL", "UNPAID"]).optional(),
  delivery: z.enum(["full", "partial", "none"]).optional(),
  production: z.enum(["done", "in_progress"]).optional(),
  customerId: z.string().trim().optional(),
  type: z.enum(["JO", "PO"]).optional(),
});

export const importRequestInput = z.object({
  source: z.enum(["lineup", "archive"]),
});

export const itemListFilters = jobOrderListFilters;

export const calendarMonthInput = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

// "As of" date for the JO / EOD reports (defaults to today). yyyy-MM-dd.
export const reportDateInput = z.object({
  asOf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

// Calendar drag-drop moves the deadline of the WHOLE JO — every open item
// together, exactly like legacy updateJODeadlineFromCalendar.
export const moveDeadlineInput = z.object({
  jobOrderId: z.string().min(1),
  newDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format. Expected YYYY-MM-DD."),
});

// ——— Reorder (New JO from a customer's order history) ———
// Staff pick a customer, then tick previously-ordered items (qty + price
// editable). The created JO lands in PENDING_REVIEW and needs the customer's
// sign-off (attach proof) AND an admin "review" before it enters production.
const reorderItemInput = z.object({
  description: z.string().trim().min(1, "Job description is required").max(2000),
  qty: qtyString,
  unitPrice: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Enter a valid price"),
  productId: z.string().nullable().optional(),
  category: z.string().trim().max(120).nullable().optional(),
  isLFP: z.boolean().default(false),
  lfpWidth: z.string().trim().max(20).nullable().optional(),
  lfpHeight: z.string().trim().max(20).nullable().optional(),
  lfpUnit: z.string().trim().max(20).nullable().optional(),
  // Carried verbatim from the past item so specs-driven views (tarp decode,
  // composed job description) keep working; opaque JSON, validated loosely.
  specs: z.unknown().optional(),
});

export const reorderCreateInput = z.object({
  customerId: z.string().min(1, "Pick a customer."),
  deadline: dateString,
  items: z.array(reorderItemInput).min(1, "Pick at least one item to reorder."),
});

export const reorderReviewInput = z.object({
  action: z.enum(["approve", "reject", "resubmit"]),
  reason: z.string().trim().max(500).optional(),
});

export type ReorderItemInput = z.infer<typeof reorderItemInput>;
export type ReorderCreateInput = z.infer<typeof reorderCreateInput>;
export type ReorderReviewInput = z.infer<typeof reorderReviewInput>;

// One distinct thing a customer has ordered before, for the reorder picker.
export type ReorderItemDto = {
  key: string; // stable row id (normalized description + specs)
  description: string;
  jobDescription: string; // composed, for display
  specs: Record<string, unknown> | null;
  productId: string | null;
  service: string | null; // product name, if catalog-linked
  category: string | null;
  isLFP: boolean;
  lfpWidth: string | null;
  lfpHeight: string | null;
  lfpUnit: string | null;
  unitPrice: string; // most-recent price
  lastQty: number;
  timesOrdered: number;
  lastOrderedAt: string; // ISO
  lastJoNumber: string;
};

export type JobOrderItemInput = z.infer<typeof jobOrderItemInput>;
export type ItemEditInput = z.infer<typeof itemEditInput>;
export type MoveDeadlineInput = z.infer<typeof moveDeadlineInput>;
export type JobOrderCreateInput = z.infer<typeof jobOrderCreateInput>;
export type JobOrderUpdateInput = z.infer<typeof jobOrderUpdateInput>;
export type ItemStatusUpdateInput = z.infer<typeof itemStatusUpdateInput>;
export type JobOrderListFilters = z.infer<typeof jobOrderListFilters>;
export type ImportSource = z.infer<typeof importRequestInput>["source"];

// ——— DTOs (what leaves the server — never raw Prisma models) ———

export type JobOrderItemDto = {
  id: string;
  description: string;
  // Live "Job Description" composed from the item's structured fields
  // (service · size · qty · price breakdown) — stays in sync with qty. Falls
  // back to `description` when the item has no usable specs. See job-description.ts.
  jobDescription: string;
  // Raw pieces the client re-composes the description from live (edit dialog):
  service: string | null; // product/service name
  specs: Record<string, unknown> | null; // quote-line specs
  fromQuote: boolean; // description is locked (copied from an approved quote)
  qty: number;
  qtyDelivered: number; // running total delivered via DRs (drives full/partial/none)
  unitPrice: string;
  lineTotal: string;
  productionStatus: string | null;
  department: string | null;
  deadline: string | null;
  daysLeft: number | null;
  actualDate: string | null;
  assignedTo: string | null;
  category: string | null;
  isLFP: boolean;
  lfpWidth: string | null;
  lfpHeight: string | null;
  lfpUnit: string | null;
  isRush: boolean;
  statusHistory: string | null;
  waitingPickupSince: string | null;
  archivedAt: string | null;
  lineItemId: string | null;
  isDone: boolean;
  isWaitingPickup: boolean;
  isOverdue: boolean;
};

export type JobOrderListRowDto = {
  id: string;
  joNumber: string;
  customerName: string;
  status: string;
  total: string;
  itemCount: number;
  openItemCount: number;
  deadline: string | null;
  isRush: boolean;
  hasWaitingPickup: boolean;
  isOverdue: boolean;
  createdAt: string;
  imported: boolean;
};

export type JobOrderListPageDto = {
  rows: JobOrderListRowDto[];
  nextCursor: string | null;
};

/** Per-JO payment standing (from Sales & Audit receipts), shown on the board
 *  so staff can see paid/unpaid without opening the Pay dialog. */
export type JoPaymentDto = {
  status: "PAID" | "PARTIAL" | "UNPAID";
  paid: string; // total received across the JO's non-voided receipts
  total: string; // the JO total
  balance: string; // max(total − paid, 0)
};

/** One board row = one line item (legacy JOWebApp table). */
export type JobOrderItemRowDto = JobOrderItemDto & {
  jobOrderId: string;
  joNumber: string;
  joCreatedAt: string; // JO booking date — the Transactions History "Date" column
  customerName: string;
  joIsPO: boolean;
  joIsApproved: boolean;
  /** Per-JO Capture toggle — adds the Capture production step to every item. */
  joNeedsCapture: boolean;
  /** Attached by the board list only (not the calendar). */
  payment?: JoPaymentDto;
};

export type AttachmentDto = {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  uploadedByName: string;
};

export type JobOrderItemsPageDto = {
  rows: JobOrderItemRowDto[];
  nextCursor: string | null;
};

export type JobOrderDetailDto = {
  id: string;
  joNumber: string;
  status: string;
  isPO: boolean;
  isApprovedByCustomer: boolean;
  customerApprovedAt: string | null;
  attachments: AttachmentDto[];
  customer: {
    id: string;
    name: string;
    company: string | null;
    contactNumber: string | null;
    email: string | null;
    address: string | null;
    tin: string | null;
  };
  notes: string | null;
  planDateStart: string | null;
  planDateEnd: string | null;
  deadline: string | null;
  total: string;
  isLFP: boolean;
  imported: boolean;
  createdAt: string;
  createdByName: string;
  completedAt: string | null;
  items: JobOrderItemDto[];
};

/** Counts for the board metric cards (per ITEM, legacy JO_METRICS parity). */
export type BoardMetricsDto = {
  all: number;
  ongoing: number;
  waiting: number;
  overdue: number;
  custApproval: number;
  smAlarming: number;
  smOverdue: number;
};

/** One calendar-drag deadline move (legacy getJODeadlineHistory). */
export type DeadlineMoveDto = {
  dateDisplay: string;
  user: string;
  oldDeadline: string;
  newDeadline: string;
};

// ——— Reports (legacy JOsReport) ———

type CountAmount = { count: number; amount: string };

/** End-of-day statistics (legacy computeEODStats_). */
export type EodReportDto = {
  asOf: string; // yyyy-MM-dd
  dateLabel: string; // "Jul 10, 2026"
  receivedToday: CountAmount;
  active: CountAmount;
  overdue: CountAmount;
  overdueSM: number;
  overdueYesterday: number | null;
  dueToday: CountAmount;
  dueTodaySM: number;
  due1to3: number;
  ongoing: number;
  waiting: number;
  noDeadline: number;
  releasedToday: number;
  cancelledToday: number;
  longestOverdueDays: number;
  longestOverdueCount: number;
  longestOverdueStatus: string;
  text: string; // monospace report matching the legacy layout
};

/** One row in the JO Report by Department (legacy getJOReportAllDepts). */
export type ReportRowDto = {
  id: string;
  lineItemId: string;
  joNumber: string;
  customerName: string;
  description: string;
  qty: number;
  lineTotal: string;
  statusDepartment: string | null;
  deadline: string | null;
  daysLeft: number | null;
  assignedTo: string | null;
};

export type ImportRowError = { line: number; message: string };

export type ImportSummaryDto = {
  jobOrdersCreated: number;
  itemsCreated: number;
  customersCreated: number;
  skippedExisting: string[];
  errors: ImportRowError[];
};
