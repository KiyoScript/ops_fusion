import { z } from "zod";
import { JobOrderStatus } from "@/generated/prisma/enums";

// ══════════════════════════════════════════════════════════════════════════
// THE PIPELINE — a job order's value passes through THREE states, and only
// two of them are receivables.
//
//   Backlog   in production, not delivered   → owed to us, but not earned.
//                                              Nothing in the ledger yet.
//   Unbilled  delivered, not yet invoiced    → earned. Dr 1142, Cr Revenue.
//   Invoiced  billed                         → A/R proper: aged, due-dated,
//                                              and counted against a limit.
//
// Merging them is what makes a month look good because an order was TAKEN
// rather than because work was DONE. Backlog has no due date to age against,
// and no credit has been extended on work that has not been billed — so an
// aging report or a credit check that swallowed either one stops meaning
// anything. See docs/chart-of-accounts.md.
//
// The three are a PARTITION of the job's value, never overlapping:
//
//   invoiced = I
//   unbilled = max(0, delivered − I)
//   backlog  = max(0, total − max(delivered, I))
//
// The `max(delivered, I)` is what stops work billed in advance being counted
// twice — once as A/R and again as backlog still on the floor.
// ══════════════════════════════════════════════════════════════════════════

/**
 * Job orders that are real work. Drafts and reviews are not commitments yet,
 * and a cancelled job is not coming.
 */
export const PIPELINE_STATUSES = [
  JobOrderStatus.APPROVED,
  JobOrderStatus.IN_PROGRESS,
  JobOrderStatus.COMPLETED,
  JobOrderStatus.INVOICED,
] as const;

export const PIPELINE_STATE = {
  ALL: "ALL",
  /** Still on the shop floor. */
  BACKLOG: "BACKLOG",
  /** Delivered and earned, but nobody has written the invoice. */
  UNBILLED: "UNBILLED",
  /** Past its deadline and still not delivered. */
  OVERDUE: "OVERDUE",
} as const;

export type PipelineState =
  (typeof PIPELINE_STATE)[keyof typeof PIPELINE_STATE];

export const pipelineFilters = z.object({
  state: z.enum(PIPELINE_STATE).default("ALL"),
  customerId: z.string().nullish(),
  search: z.string().trim().max(200).nullish(),
});

export type PipelineFilters = z.infer<typeof pipelineFilters>;

export type PipelineItemDto = {
  id: string;
  description: string;
  qty: number;
  qtyDelivered: number;
  lineTotal: string;
  /** Value of the part that has actually left the building. */
  deliveredValue: string;
  deadline: string | null;
  productionStatus: string | null;
};

export type PipelineJobDto = {
  jobOrderId: string;
  joNumber: string;
  customerId: string;
  customerName: string;
  status: JobOrderStatus;
  deadline: string | null;
  /** Days past the job's deadline with work still undelivered. Null if none. */
  daysLate: number | null;
  total: string;
  deliveredValue: string;
  invoiced: string;
  /** The three states. They sum to the job's total. */
  backlog: string;
  unbilled: string;
  /**
   * Downpayments taken on a JO slip. Money we hold, NOT revenue and NOT a
   * reduction of what is still owed — it is a customer deposit until an
   * invoice is raised (decided 2026-08-19).
   */
  deposits: string;
  /** Every item still short of full delivery. Empty once the job ships. */
  openItems: PipelineItemDto[];
};

export type PipelineDto = {
  jobs: PipelineJobDto[];
  totals: {
    backlog: string;
    unbilled: string;
    invoiced: string;
    deposits: string;
    /** backlog + unbilled — what is owed to us but not yet on the A/R ledger. */
    offLedger: string;
    jobCount: number;
    overdueCount: number;
  };
  customers: { id: string; name: string }[];
};
