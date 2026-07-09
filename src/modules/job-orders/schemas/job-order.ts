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

const lfpCheck = (ctx: {
  value: { isLFP: boolean; lfpWidth?: string; lfpHeight?: string };
  issues: z.core.$ZodRawIssue[];
}) => {
  if (ctx.value.isLFP && (!ctx.value.lfpWidth || !ctx.value.lfpHeight)) {
    ctx.issues.push({
      code: "custom",
      message: "Width and height are required for LFP items",
      path: ["lfpWidth"],
      input: ctx.value,
    });
  }
};

export const jobOrderItemInput = itemFields.check(lfpCheck);

// Per-item edit modal (legacy updateJORow): item fields + optional status
// change with remark, in one save.
export const itemEditInput = itemFields
  .extend({
    id: z.string().min(1),
    jobOrderId: z.string().min(1),
    remark: z.string().trim().max(500).optional(),
  })
  .check(lfpCheck);

// JO/PO typing (fusion-only, not in legacy): PO and non-JO numbers are typed
// manually; a plain JO gets an auto-generated "R-AD{yyyy}-{MM}-{dd}-{seq}".
const jobOrderBaseInput = z
  .object({
    joNumber: z.string().trim().max(60).optional(),
    isPO: z.boolean(),
    isNonJo: z.boolean(),
    customerName: z.string().trim().min(1, "Customer Name is required.").max(200),
    notes: z.string().trim().max(2000).optional(),
    planDateStart: dateString,
    planDateEnd: dateString,
    items: z.array(jobOrderItemInput).min(1, "At least one item is required."),
  })
  .check((ctx) => {
    if (ctx.value.isPO && ctx.value.isNonJo) {
      ctx.issues.push({
        code: "custom",
        message: "Pick either PO or Non-JO, not both.",
        path: ["isPO"],
        input: ctx.value,
      });
    }
    if ((ctx.value.isPO || ctx.value.isNonJo) && !ctx.value.joNumber) {
      ctx.issues.push({
        code: "custom",
        message: ctx.value.isPO
          ? "PO Number is required."
          : "Reference number is required.",
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
      "done",
      "all",
    ])
    .default("active"),
  cursor: z.string().optional(),
  take: z.coerce.number().int().min(1).max(100).default(25),
});

export const importRequestInput = z.object({
  source: z.enum(["lineup", "archive"]),
});

export const itemListFilters = jobOrderListFilters;

export const calendarMonthInput = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

// Calendar drag-drop moves the deadline of the WHOLE JO — every open item
// together, exactly like legacy updateJODeadlineFromCalendar.
export const moveDeadlineInput = z.object({
  jobOrderId: z.string().min(1),
  newDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format. Expected YYYY-MM-DD."),
});

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
  qty: number;
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

/** One board row = one line item (legacy JOWebApp table). */
export type JobOrderItemRowDto = JobOrderItemDto & {
  jobOrderId: string;
  joNumber: string;
  customerName: string;
  joIsPO: boolean;
  joIsNonJo: boolean;
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
  isNonJo: boolean;
  customer: { id: string; name: string };
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

export type ImportRowError = { line: number; message: string };

export type ImportSummaryDto = {
  jobOrdersCreated: number;
  itemsCreated: number;
  customersCreated: number;
  skippedExisting: string[];
  errors: ImportRowError[];
};
