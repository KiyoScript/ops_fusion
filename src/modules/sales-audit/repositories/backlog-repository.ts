import { prisma } from "@/lib/prisma";
import type { JobOrderStatus, SaleType } from "@/generated/prisma/enums";
import { PIPELINE_STATUSES } from "../schemas/backlog";

// ══════════════════════════════════════════════════════════════════════════
// PIPELINE — reading the job-order side of the money.
//
// This is the finance track reading core dev's tables, the same way
// `joForReceiptSelect` already does. It reads and never writes: delivery is
// maintained by DR issuance, and the invoices are the sales ledger's.
// ══════════════════════════════════════════════════════════════════════════

export type PipelineItemRecord = {
  id: string;
  description: string;
  qty: number;
  qtyDelivered: number;
  lineTotal: string;
  deadline: Date | null;
  productionStatus: string | null;
};

export type PipelineJobRecord = {
  id: string;
  joNumber: string;
  status: JobOrderStatus;
  deadline: Date | null;
  total: string;
  customerId: string;
  customerName: string;
  items: PipelineItemRecord[];
  /** Live receipts raised against this job — voided ones already dropped. */
  sales: { type: SaleType; amount: string; isDownpayment: boolean }[];
};

export type PipelineQuery = {
  customerId?: string | null;
  search?: string | null;
};

export interface IBacklogRepository {
  listPipeline(q: PipelineQuery): Promise<PipelineJobRecord[]>;
  listPipelineCustomers(): Promise<{ id: string; name: string }[]>;
}

export class PrismaBacklogRepository implements IBacklogRepository {
  async listPipeline(q: PipelineQuery): Promise<PipelineJobRecord[]> {
    const rows = await prisma.jobOrder.findMany({
      where: {
        deletedAt: null,
        // Drafts and reviews are not commitments; a cancelled job is not
        // coming. Neither belongs in a figure the shop plans against.
        status: { in: [...PIPELINE_STATUSES] },
        ...(q.customerId ? { customerId: q.customerId } : {}),
        ...(q.search
          ? {
              OR: [
                { joNumber: { contains: q.search, mode: "insensitive" } },
                { customer: { name: { contains: q.search, mode: "insensitive" } } },
                {
                  items: {
                    some: {
                      description: { contains: q.search, mode: "insensitive" },
                    },
                  },
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        joNumber: true,
        status: true,
        deadline: true,
        total: true,
        customerId: true,
        customer: { select: { name: true } },
        items: {
          select: {
            id: true,
            description: true,
            qty: true,
            qtyDelivered: true,
            lineTotal: true,
            deadline: true,
            productionStatus: true,
          },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        },
        sales: {
          // A voided invoice bills nothing. Counting one here would report
          // delivered work as already invoiced and hide it from the unbilled
          // list — the exact work that then never gets billed at all.
          where: { deletedAt: null, voidedAt: null },
          select: { type: true, amount: true, isDownpayment: true },
        },
      },
      orderBy: [{ deadline: "asc" }, { joNumber: "asc" }],
    });

    return rows.map((r) => ({
      id: r.id,
      joNumber: r.joNumber,
      status: r.status,
      deadline: r.deadline,
      total: r.total.toString(),
      customerId: r.customerId,
      customerName: r.customer.name,
      items: r.items.map((i) => ({
        id: i.id,
        description: i.description,
        qty: i.qty,
        qtyDelivered: i.qtyDelivered,
        lineTotal: i.lineTotal.toString(),
        deadline: i.deadline,
        productionStatus: i.productionStatus,
      })),
      sales: r.sales.map((s) => ({
        type: s.type,
        amount: s.amount.toString(),
        isDownpayment: s.isDownpayment,
      })),
    }));
  }

  async listPipelineCustomers(): Promise<{ id: string; name: string }[]> {
    const rows = await prisma.customer.findMany({
      where: {
        deletedAt: null,
        jobOrders: {
          some: { deletedAt: null, status: { in: [...PIPELINE_STATUSES] } },
        },
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return rows;
  }
}
