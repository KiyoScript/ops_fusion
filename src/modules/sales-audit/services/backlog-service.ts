import { assertCan } from "@/lib/ability";
import type { Actor } from "@/lib/authz";
import type { IBacklogRepository, PipelineJobRecord } from "../repositories/backlog-repository";
import { PrismaBacklogRepository } from "../repositories/backlog-repository";
import {
  type PipelineDto,
  type PipelineFilters,
  type PipelineItemDto,
  type PipelineJobDto,
} from "../schemas/backlog";
import { toAmount, toCentavos } from "./money";

// ══════════════════════════════════════════════════════════════════════════
// THE PIPELINE — backlog, unbilled, invoiced.
//
// The whole point of this report is the middle state. Work that has been
// DELIVERED but not INVOICED is earned revenue sitting in nobody's report: it
// is not on the A/R ledger, because no invoice exists, and it is not backlog,
// because the job is done. It is simply money the shop has already worked for
// and nobody is chasing.
// ══════════════════════════════════════════════════════════════════════════

/**
 * Which receipt kinds BILL a job — all of them.
 *
 * A JO slip is issued for the amount actually paid and bills exactly that: a
 * ₱700 job taken as ₱230 down and ₱470 on release is two slips that add up to
 * the job. Treating the slip as a deposit outside the billing left ₱230 of a
 * finished job sitting in "backlog" forever.
 */
const BILLING_TYPES = new Set(["SI_VAT", "SI_NON_VAT", "SI_CHARGE", "JO_SLIP"]);

/**
 * Value of the part of a line that has physically left the building.
 *
 * Pro-rated by quantity, and rounded HALF-DOWN per line by truncating toward
 * the delivered fraction, so a part-delivered line can never be valued above
 * its own total. Delivering more than was ordered (a DR overshoot) is capped
 * rather than allowed to inflate the job.
 */
function deliveredValueOf(item: {
  qty: number;
  qtyDelivered: number;
  lineTotal: string;
}): number {
  const line = toCentavos(item.lineTotal);
  if (item.qty <= 0) return 0;
  if (item.qtyDelivered >= item.qty) return line;
  if (item.qtyDelivered <= 0) return 0;
  return Math.round((line * item.qtyDelivered) / item.qty);
}

function daysLateOf(deadline: Date | null, undelivered: boolean): number | null {
  if (!deadline || !undelivered) return null;
  const days = Math.floor((Date.now() - deadline.getTime()) / 86_400_000);
  return days > 0 ? days : null;
}

function toJob(r: PipelineJobRecord): PipelineJobDto {
  const total = toCentavos(r.total);

  let delivered = 0;
  const openItems: PipelineItemDto[] = [];
  for (const i of r.items) {
    const value = deliveredValueOf(i);
    delivered += value;
    if (i.qtyDelivered < i.qty) {
      openItems.push({
        id: i.id,
        description: i.description,
        qty: i.qty,
        qtyDelivered: i.qtyDelivered,
        lineTotal: i.lineTotal,
        deliveredValue: toAmount(value),
        deadline: i.deadline?.toISOString() ?? null,
        productionStatus: i.productionStatus,
      });
    }
  }

  let invoiced = 0;
  let deposits = 0;
  for (const s of r.sales) {
    if (BILLING_TYPES.has(s.type)) invoiced += toCentavos(s.amount);
    // Reported alongside, never subtracted: how much of what has been billed
    // is a downpayment from a customer who has not collected the job yet.
    if (s.isDownpayment) deposits += toCentavos(s.amount);
  }

  // The partition. `max(delivered, invoiced)` is what stops work billed in
  // advance being counted twice — once as A/R and again as backlog.
  const unbilled = Math.max(0, delivered - invoiced);
  const backlog = Math.max(0, total - Math.max(delivered, invoiced));

  return {
    jobOrderId: r.id,
    joNumber: r.joNumber,
    customerId: r.customerId,
    customerName: r.customerName,
    status: r.status,
    deadline: r.deadline?.toISOString() ?? null,
    daysLate: daysLateOf(r.deadline, openItems.length > 0),
    total: r.total,
    deliveredValue: toAmount(delivered),
    invoiced: toAmount(invoiced),
    backlog: toAmount(backlog),
    unbilled: toAmount(unbilled),
    deposits: toAmount(deposits),
    openItems,
  };
}

export class BacklogService {
  constructor(private readonly repo: IBacklogRepository) {}

  /**
   * R9: gated like every other money read. A pipeline report names customers,
   * what they ordered and what it is worth — the same commercial detail as the
   * A/R ledger, and no less confidential for being about work not yet billed.
   */
  async getPipeline(
    actor: Actor,
    filters: PipelineFilters
  ): Promise<PipelineDto> {
    assertCan(actor, "read", "Sale");

    const [rows, customers] = await Promise.all([
      this.repo.listPipeline({
        customerId: filters.customerId,
        search: filters.search,
      }),
      this.repo.listPipelineCustomers(),
    ]);

    const jobs = rows
      .map(toJob)
      // A job fully delivered AND fully billed has left the pipeline — it is
      // the A/R ledger's problem now. Keeping it here would bury the handful
      // of jobs that actually need attention.
      .filter((j) => toCentavos(j.backlog) > 0 || toCentavos(j.unbilled) > 0);

    const filtered = jobs.filter((j) => {
      if (filters.state === "BACKLOG") return toCentavos(j.backlog) > 0;
      if (filters.state === "UNBILLED") return toCentavos(j.unbilled) > 0;
      if (filters.state === "OVERDUE") return j.daysLate !== null;
      return true;
    });

    // Sorted by what is at stake, not by date: the biggest unbilled job is the
    // one worth walking over to someone's desk about.
    filtered.sort(
      (a, b) =>
        toCentavos(b.unbilled) - toCentavos(a.unbilled) ||
        toCentavos(b.backlog) - toCentavos(a.backlog)
    );

    const sum = (pick: (j: PipelineJobDto) => string) =>
      filtered.reduce((t, j) => t + toCentavos(pick(j)), 0);

    const backlog = sum((j) => j.backlog);
    const unbilled = sum((j) => j.unbilled);

    return {
      jobs: filtered,
      totals: {
        backlog: toAmount(backlog),
        unbilled: toAmount(unbilled),
        invoiced: toAmount(sum((j) => j.invoiced)),
        deposits: toAmount(sum((j) => j.deposits)),
        offLedger: toAmount(backlog + unbilled),
        jobCount: filtered.length,
        overdueCount: filtered.filter((j) => j.daysLate !== null).length,
      },
      customers,
    };
  }
}

let instance: BacklogService | undefined;

export function getBacklogService(): BacklogService {
  if (!instance) instance = new BacklogService(new PrismaBacklogRepository());
  return instance;
}
