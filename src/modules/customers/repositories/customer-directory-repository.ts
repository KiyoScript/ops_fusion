import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type {
  CustomerListFilters,
  CustomerUpdateInput,
} from "../schemas/customer";

const editSelect = {
  id: true,
  name: true,
  company: true,
  contactNumber: true,
  email: true,
  address: true,
  tin: true,
  vatRegistered: true,
  status: true,
  notes: true,
} satisfies Prisma.CustomerSelect;

export type CustomerEditRecord = Prisma.CustomerGetPayload<{ select: typeof editSelect }>;

const listSelect = {
  id: true,
  name: true,
  company: true,
  contactNumber: true,
  email: true,
  tin: true,
  status: true,
  vatRegistered: true,
  creditTermDays: true,
  creditLimit: true,
  createdAt: true,
  _count: { select: { quotations: true, jobOrders: true } },
} satisfies Prisma.CustomerSelect;

const detailSelect = {
  id: true,
  name: true,
  company: true,
  contactNumber: true,
  email: true,
  address: true,
  tin: true,
  status: true,
  vatRegistered: true,
  creditTermDays: true,
  creditLimit: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { name: true } },
  _count: {
    select: {
      quotations: true,
      jobOrders: true,
      deliveryReceipts: true,
      sales: true,
      collectionReceipts: true,
      advancePayments: true,
      inquiries: true,
    },
  },
  quotations: {
    select: { id: true, quoteNumber: true, status: true, total: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 15,
  },
  jobOrders: {
    select: { id: true, joNumber: true, status: true, total: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 15,
  },
  deliveryReceipts: {
    select: { id: true, drNumber: true, status: true, issuedAt: true },
    orderBy: { issuedAt: "desc" },
    take: 15,
  },
  sales: {
    select: { id: true, documentNo: true, paymentStatus: true, amount: true, saleDate: true },
    orderBy: { saleDate: "desc" },
    take: 15,
  },
  collectionReceipts: {
    select: { id: true, crNumber: true, amount: true, receivedAt: true },
    orderBy: { receivedAt: "desc" },
    take: 15,
  },
  advancePayments: {
    select: { id: true, amount: true, status: true, receivedAt: true },
    orderBy: { receivedAt: "desc" },
    take: 15,
  },
} satisfies Prisma.CustomerSelect;

export type CustomerListRecord = Prisma.CustomerGetPayload<{ select: typeof listSelect }>;
export type CustomerDetailRecord = Prisma.CustomerGetPayload<{ select: typeof detailSelect }>;

export interface ICustomerDirectoryRepository {
  listPage(
    filter: CustomerListFilters
  ): Promise<{ rows: CustomerListRecord[]; nextCursor: string | null }>;
  findDetail(id: string): Promise<CustomerDetailRecord | null>;
  findForEdit(id: string): Promise<CustomerEditRecord | null>;
  update(input: CustomerUpdateInput): Promise<void>;
}

export class PrismaCustomerDirectoryRepository
  implements ICustomerDirectoryRepository
{
  async listPage(
    filter: CustomerListFilters
  ): Promise<{ rows: CustomerListRecord[]; nextCursor: string | null }> {
    const where: Prisma.CustomerWhereInput = { deletedAt: null };
    if (filter.status) where.status = filter.status;
    if (filter.q) {
      where.OR = [
        { name: { contains: filter.q, mode: "insensitive" } },
        { company: { contains: filter.q, mode: "insensitive" } },
        { contactNumber: { contains: filter.q, mode: "insensitive" } },
        { email: { contains: filter.q, mode: "insensitive" } },
        { tin: { contains: filter.q, mode: "insensitive" } },
      ];
    }
    const rows = await prisma.customer.findMany({
      where,
      select: listSelect,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: filter.take + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > filter.take;
    const page = hasMore ? rows.slice(0, filter.take) : rows;
    return { rows: page, nextCursor: hasMore ? page[page.length - 1]!.id : null };
  }

  async findDetail(id: string): Promise<CustomerDetailRecord | null> {
    return prisma.customer.findFirst({
      where: { id, deletedAt: null },
      select: detailSelect,
    });
  }

  async findForEdit(id: string): Promise<CustomerEditRecord | null> {
    return prisma.customer.findFirst({
      where: { id, deletedAt: null },
      select: editSelect,
    });
  }

  async update(input: CustomerUpdateInput): Promise<void> {
    await prisma.customer.update({
      where: { id: input.id },
      data: {
        name: input.name,
        company: input.company || null,
        contactNumber: input.contactNumber || null,
        email: input.email || null,
        address: input.address || null,
        tin: input.tin || null,
        vatRegistered: input.vatRegistered,
        status: input.status,
        notes: input.notes || null,
      },
    });
  }
}
