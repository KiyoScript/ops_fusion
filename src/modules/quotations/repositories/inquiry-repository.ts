import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { InquiryMedium } from "@/generated/prisma/enums";
import type { DbTx } from "@/modules/shared/repositories/types";

const rowSelect = {
  id: true,
  customerName: true,
  contactNumber: true,
  email: true,
  medium: true,
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
  view: "open" | "quoted" | "all";
  cursor?: string;
  take: number;
};

export interface IInquiryRepository {
  listPage(
    filter: InquiryListFilter
  ): Promise<{ rows: InquiryRecord[]; nextCursor: string | null }>;
  findById(id: string, tx?: DbTx): Promise<InquiryRecord | null>;
  create(data: InquiryWriteData & { createdById: string }): Promise<{ id: string }>;
  update(id: string, data: InquiryWriteData): Promise<void>;
  /** Ties the inquiry to the quotation created from it (and the customer
   *  the quote resolved, so the inquiry gains its master-record link). */
  linkQuotation(
    inquiryId: string,
    quotationId: string,
    customerId: string,
    tx?: DbTx
  ): Promise<void>;
}

export class PrismaInquiryRepository implements IInquiryRepository {
  async listPage(
    filter: InquiryListFilter
  ): Promise<{ rows: InquiryRecord[]; nextCursor: string | null }> {
    const where: Prisma.InquiryWhereInput = {};

    if (filter.view === "open") where.quotationId = null;
    else if (filter.view === "quoted") where.quotationId = { not: null };

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
      data: { quotationId, customerId },
    });
  }
}
