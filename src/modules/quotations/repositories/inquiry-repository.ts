import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { InquiryStatus, type InquiryMedium } from "@/generated/prisma/enums";
import type { DbTx } from "@/modules/shared/repositories/types";

const rowSelect = {
  id: true,
  customerName: true,
  contactNumber: true,
  email: true,
  medium: true,
  status: true,
  closedReason: true,
  servicesRequested: true,
  notes: true,
  quotationId: true,
  createdAt: true,
  quotation: { select: { quoteNumber: true, status: true } },
  createdBy: { select: { name: true } },
} satisfies Prisma.InquirySelect;

export type InquiryRecord = Prisma.InquiryGetPayload<{ select: typeof rowSelect }>;

export type InquiryWriteData = {
  customerName: string;
  contactNumber?: string | null;
  email?: string | null;
  medium: InquiryMedium;
  servicesRequested: string;
  notes?: string | null;
};

export type InquiryListFilter = {
  q?: string;
  view: "open" | "quoted" | "closed" | "all";
  cursor?: string;
  take: number;
};

export type InquiryMetrics = {
  open: number;
  quoted: number;
  closed: number;
  total: number;
  byMedium: { medium: string; count: number }[];
};

export interface IInquiryRepository {
  listPage(
    filter: InquiryListFilter
  ): Promise<{ rows: InquiryRecord[]; nextCursor: string | null }>;
  findById(id: string, tx?: DbTx): Promise<InquiryRecord | null>;
  create(data: InquiryWriteData & { createdById: string }): Promise<{ id: string }>;
  update(id: string, data: InquiryWriteData): Promise<void>;
  /** Ties the inquiry to the quotation created from it (and the customer
   *  the quote resolved), and flips its status to QUOTED. */
  linkQuotation(
    inquiryId: string,
    quotationId: string,
    customerId: string,
    tx?: DbTx
  ): Promise<void>;
  close(id: string, reason: string | null, tx?: DbTx): Promise<void>;
  reopen(id: string, tx?: DbTx): Promise<void>;
  metrics(): Promise<InquiryMetrics>;
}

export class PrismaInquiryRepository implements IInquiryRepository {
  async listPage(
    filter: InquiryListFilter
  ): Promise<{ rows: InquiryRecord[]; nextCursor: string | null }> {
    const where: Prisma.InquiryWhereInput = {};

    if (filter.view === "open") where.status = InquiryStatus.OPEN;
    else if (filter.view === "quoted") where.status = InquiryStatus.QUOTED;
    else if (filter.view === "closed") where.status = InquiryStatus.CLOSED;

    if (filter.q) {
      where.OR = [
        { customerName: { contains: filter.q, mode: "insensitive" } },
        { servicesRequested: { contains: filter.q, mode: "insensitive" } },
      ];
    }

    const rows = await prisma.inquiry.findMany({
      where,
      select: rowSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: filter.take + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > filter.take;
    const page = hasMore ? rows.slice(0, filter.take) : rows;
    return {
      rows: page,
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    };
  }

  async findById(id: string, tx?: DbTx): Promise<InquiryRecord | null> {
    return (tx ?? prisma).inquiry.findUnique({
      where: { id },
      select: rowSelect,
    });
  }

  async create(
    data: InquiryWriteData & { createdById: string }
  ): Promise<{ id: string }> {
    return prisma.inquiry.create({ data, select: { id: true } });
  }

  async update(id: string, data: InquiryWriteData): Promise<void> {
    await prisma.inquiry.update({ where: { id }, data });
  }

  async linkQuotation(
    inquiryId: string,
    quotationId: string,
    customerId: string,
    tx?: DbTx
  ): Promise<void> {
    await (tx ?? prisma).inquiry.update({
      where: { id: inquiryId },
      data: { quotationId, customerId, status: InquiryStatus.QUOTED },
    });
  }

  async close(id: string, reason: string | null, tx?: DbTx): Promise<void> {
    await (tx ?? prisma).inquiry.update({
      where: { id },
      data: { status: InquiryStatus.CLOSED, closedReason: reason },
    });
  }

  async reopen(id: string, tx?: DbTx): Promise<void> {
    await (tx ?? prisma).inquiry.update({
      where: { id },
      data: { status: InquiryStatus.OPEN, closedReason: null },
    });
  }

  async metrics(): Promise<InquiryMetrics> {
    const [byStatus, byMedium] = await Promise.all([
      prisma.inquiry.groupBy({ by: ["status"], _count: true }),
      prisma.inquiry.groupBy({ by: ["medium"], _count: true }),
    ]);
    const stat = (s: InquiryStatus) =>
      byStatus.find((r) => r.status === s)?._count ?? 0;
    return {
      open: stat(InquiryStatus.OPEN),
      quoted: stat(InquiryStatus.QUOTED),
      closed: stat(InquiryStatus.CLOSED),
      total: byStatus.reduce((sum, r) => sum + r._count, 0),
      byMedium: byMedium
        .map((r) => ({ medium: r.medium, count: r._count }))
        .sort((a, b) => b.count - a.count),
    };
  }
}
