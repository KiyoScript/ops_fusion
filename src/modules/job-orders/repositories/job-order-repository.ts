import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { JobOrderStatus } from "@/generated/prisma/enums";
import type { DbTx } from "@/modules/shared/repositories/types";
import { DONE_KEYWORDS } from "../services/production-status";

// ——— selection shapes (single source of truth for what queries fetch) ———

const listSelect = {
  id: true,
  joNumber: true,
  status: true,
  total: true,
  deadline: true,
  createdAt: true,
  importedAt: true,
  customer: { select: { name: true } },
  items: {
    select: {
      productionStatus: true,
      deadline: true,
      isRush: true,
      archivedAt: true,
      waitingPickupSince: true,
    },
  },
} satisfies Prisma.JobOrderSelect;

const detailSelect = {
  id: true,
  joNumber: true,
  status: true,
  isPO: true,
  isNonJo: true,
  notes: true,
  planDateStart: true,
  planDateEnd: true,
  deadline: true,
  total: true,
  isLFP: true,
  importedAt: true,
  createdAt: true,
  completedAt: true,
  customer: { select: { id: true, name: true } },
  createdBy: { select: { name: true } },
  items: { orderBy: { sortOrder: "asc" as const } },
} satisfies Prisma.JobOrderSelect;

const itemBoardInclude = {
  jobOrder: {
    select: {
      id: true,
      joNumber: true,
      isPO: true,
      isNonJo: true,
      customer: { select: { name: true } },
    },
  },
} satisfies Prisma.JobOrderItemInclude;

export type JobOrderListRecord = Prisma.JobOrderGetPayload<{
  select: typeof listSelect;
}>;
export type JobOrderDetailRecord = Prisma.JobOrderGetPayload<{
  select: typeof detailSelect;
}>;
export type JobOrderItemRecord = JobOrderDetailRecord["items"][number];
export type JobOrderItemBoardRecord = Prisma.JobOrderItemGetPayload<{
  include: typeof itemBoardInclude;
}>;

// ——— write payloads (plain data in, no Prisma types leak to services) ———

export type ItemCreateData = {
  description: string;
  qty: number;
  unitPrice: string;
  lineTotal: string;
  specs?: Prisma.InputJsonValue;
  productionStatus?: string | null;
  department?: string | null;
  deadline?: Date | null;
  actualDate?: Date | null;
  assignedTo?: string | null;
  category?: string | null;
  isLFP?: boolean;
  lfpWidth?: string | null;
  lfpHeight?: string | null;
  lfpUnit?: string | null;
  isRush?: boolean;
  statusHistory?: string | null;
  waitingPickupSince?: Date | null;
  archivedAt?: Date | null;
  lineItemId?: string | null;
  sortOrder: number;
};

// Field edits never touch production state directly — status changes go
// through ItemProductionUpdateData (history merge, waiting stamp, archive).
export type ItemUpdateData = Omit<
  ItemCreateData,
  | "statusHistory"
  | "waitingPickupSince"
  | "archivedAt"
  | "actualDate"
  | "productionStatus"
  | "department"
>;

export type JobOrderCreateData = {
  joNumber: string;
  isPO?: boolean;
  isNonJo?: boolean;
  customerId: string;
  status: JobOrderStatus;
  deadline?: Date | null;
  planDateStart?: Date | null;
  planDateEnd?: Date | null;
  isLFP: boolean;
  subtotal: string;
  total: string;
  notes?: string | null;
  createdById: string;
  createdAt?: Date;
  completedAt?: Date | null;
  importedAt?: Date;
  items: ItemCreateData[];
};

export type JobOrderHeaderUpdateData = {
  customerId?: string;
  deadline?: Date | null;
  planDateStart?: Date | null;
  planDateEnd?: Date | null;
  isLFP?: boolean;
  subtotal?: string;
  total?: string;
  notes?: string | null;
};

export type ItemProductionUpdateData = {
  productionStatus: string;
  department: string | null;
  statusHistory: string;
  waitingPickupSince: Date | null;
  actualDate?: Date | null;
  archivedAt?: Date | null;
};

export type ItemProductionState = {
  id: string;
  productionStatus: string | null;
  archivedAt: Date | null;
  waitingPickupSince: Date | null;
};

export type BoardMetricKey =
  | "all"
  | "ongoing"
  | "waiting"
  | "overdue"
  | "custApproval"
  | "smAlarming"
  | "smOverdue";

export type ListFilter = {
  q?: string;
  view:
    | "active"
    | "ongoing"
    | "waiting"
    | "overdue"
    | "custApproval"
    | "smAlarming"
    | "smOverdue"
    | "done"
    | "all";
  cursor?: string;
  take: number;
};

// ——— board metrics (semantics ported 1:1 from legacy JO_METRICS in
// JobOrder.html — keyword matches on the "Status - Department" text) ———

const ONGOING_KEYWORDS = ["ongoing", "in progress", "in-progress", "running"];
const WAITING_PICKUP_KEYWORDS = [
  "waiting - for pick up",
  "waiting - for pickup",
  "for pick up / delivery",
  "for pickup / delivery",
  "waiting for pick up",
  "waiting for pickup",
];
const CUST_APPROVAL_KEYWORDS = ["customers approval", "customer approval"];
const SM_KEYWORDS = ["sales & marketing", "sales and marketing"];
// Canonical overdue exclusions: finished or awaiting collection items are
// never overdue (matches isWaitingPickupStatus/isDoneStatus in the domain).
const PICKUP_EXCLUDE_KEYWORDS = ["pick up", "pickup", "delivery"];

const containsAny = (
  keywords: readonly string[]
): Prisma.JobOrderItemWhereInput => ({
  OR: keywords.map((kw) => ({
    productionStatus: { contains: kw, mode: "insensitive" as const },
  })),
});

const notFinished: Prisma.JobOrderItemWhereInput = {
  NOT: [containsAny(PICKUP_EXCLUDE_KEYWORDS), containsAny(DONE_KEYWORDS)],
};

const startOfToday = (): Date => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const DAY_MS = 86_400_000;

/** Item-level filter for one metric (on top of the active-board base). */
export function boardMetricItemWhere(
  key: BoardMetricKey
): Prisma.JobOrderItemWhereInput {
  const today = startOfToday();
  switch (key) {
    case "all":
      return {};
    case "ongoing":
      return containsAny(ONGOING_KEYWORDS);
    case "waiting":
      return containsAny(WAITING_PICKUP_KEYWORDS);
    case "overdue":
      return { deadline: { lt: today }, ...notFinished };
    case "custApproval":
      return containsAny(CUST_APPROVAL_KEYWORDS);
    case "smAlarming":
      // Waiting on S&M, due today through +3 days (legacy jo_isAlarmingRow).
      return {
        AND: [
          containsAny(SM_KEYWORDS),
          { productionStatus: { contains: "waiting", mode: "insensitive" } },
        ],
        deadline: { gte: today, lt: new Date(today.getTime() + 4 * DAY_MS) },
        ...notFinished,
      };
    case "smOverdue":
      return {
        AND: [
          containsAny(SM_KEYWORDS),
          { productionStatus: { contains: "waiting", mode: "insensitive" } },
        ],
        deadline: { lt: today },
        ...notFinished,
      };
  }
}

/** Active board = unarchived items of non-deleted, non-cancelled JOs. */
const boardBase: Prisma.JobOrderItemWhereInput = {
  archivedAt: null,
  jobOrder: { deletedAt: null, status: { not: JobOrderStatus.CANCELLED } },
};

export interface IJobOrderRepository {
  withTransaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T>;
  countBoardMetrics(): Promise<Record<BoardMetricKey, number>>;
  listPage(
    filter: ListFilter
  ): Promise<{ rows: JobOrderListRecord[]; nextCursor: string | null }>;
  listItemsPage(
    filter: ListFilter
  ): Promise<{ rows: JobOrderItemBoardRecord[]; nextCursor: string | null }>;
  updateItem(
    itemId: string,
    data: ItemUpdateData & Partial<ItemProductionUpdateData>,
    tx?: DbTx
  ): Promise<void>;
  /** Active-board items with a deadline inside [start, end) — calendar pins.
   *  Waiting-pickup items are excluded (legacy: production is finished). */
  listCalendarItems(start: Date, end: Date): Promise<JobOrderItemBoardRecord[]>;
  /** Moves the deadline of every OPEN item of the JO + the JO header. */
  moveJoDeadline(jobOrderId: string, newDate: Date, tx?: DbTx): Promise<number>;
  findDetail(id: string): Promise<JobOrderDetailRecord | null>;
  existsJoNumber(
    joNumber: string,
    excludeId?: string,
    tx?: DbTx
  ): Promise<boolean>;
  /** Atomically increments and returns the named counter (JO numbering). */
  nextCounter(key: string, tx?: DbTx): Promise<number>;
  /** Returns the subset of joNumbers already in the DB (case-insensitive). */
  filterExistingJoNumbers(joNumbers: string[]): Promise<string[]>;
  createWithItems(
    data: JobOrderCreateData,
    tx?: DbTx
  ): Promise<{ id: string; joNumber: string }>;
  updateHeader(
    id: string,
    data: JobOrderHeaderUpdateData,
    tx?: DbTx
  ): Promise<void>;
  replaceItems(
    jobOrderId: string,
    ops: {
      create: ItemCreateData[];
      update: {
        id: string;
        data: ItemUpdateData & Partial<ItemProductionUpdateData>;
      }[];
      deleteIds: string[];
    },
    tx?: DbTx
  ): Promise<void>;
  findItem(
    jobOrderId: string,
    itemId: string,
    tx?: DbTx
  ): Promise<JobOrderItemRecord | null>;
  updateItemProduction(
    itemId: string,
    data: ItemProductionUpdateData,
    tx?: DbTx
  ): Promise<void>;
  getItemsProduction(jobOrderId: string, tx?: DbTx): Promise<ItemProductionState[]>;
  setJoStatus(
    id: string,
    status: JobOrderStatus,
    completedAt: Date | null,
    tx?: DbTx
  ): Promise<void>;
  addJoStatusHistory(
    entry: {
      jobOrderId: string;
      fromStatus: JobOrderStatus | null;
      toStatus: JobOrderStatus;
      changedById: string;
      remarks?: string;
    },
    tx?: DbTx
  ): Promise<void>;
  softDelete(id: string, tx?: DbTx): Promise<void>;
}

const OPEN_STATUSES: JobOrderStatus[] = [
  JobOrderStatus.DRAFT,
  JobOrderStatus.PENDING_REVIEW,
  JobOrderStatus.APPROVED,
  JobOrderStatus.IN_PROGRESS,
];

export class PrismaJobOrderRepository implements IJobOrderRepository {
  withTransaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T> {
    return prisma.$transaction(fn);
  }

  async countBoardMetrics(): Promise<Record<BoardMetricKey, number>> {
    const keys: BoardMetricKey[] = [
      "all",
      "ongoing",
      "waiting",
      "overdue",
      "custApproval",
      "smAlarming",
      "smOverdue",
    ];
    const counts = await Promise.all(
      keys.map((key) =>
        prisma.jobOrderItem.count({
          where: { ...boardBase, ...boardMetricItemWhere(key) },
        })
      )
    );
    return Object.fromEntries(keys.map((key, i) => [key, counts[i]])) as Record<
      BoardMetricKey,
      number
    >;
  }

  async listPage(
    filter: ListFilter
  ): Promise<{ rows: JobOrderListRecord[]; nextCursor: string | null }> {
    const where: Prisma.JobOrderWhereInput = { deletedAt: null };

    if (filter.q) {
      where.OR = [
        { joNumber: { contains: filter.q, mode: "insensitive" } },
        { customer: { name: { contains: filter.q, mode: "insensitive" } } },
      ];
    }

    switch (filter.view) {
      case "active":
        where.status = { in: OPEN_STATUSES };
        break;
      case "done":
        where.status = JobOrderStatus.COMPLETED;
        break;
      case "all":
        break;
      default:
        // Metric views: JOs with at least one active-board item matching the
        // metric — same semantics as the cards.
        where.status = { not: JobOrderStatus.CANCELLED };
        where.items = {
          some: { archivedAt: null, ...boardMetricItemWhere(filter.view) },
        };
        break;
    }

    const rows = await prisma.jobOrder.findMany({
      where,
      select: listSelect,
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

  async listItemsPage(
    filter: ListFilter
  ): Promise<{ rows: JobOrderItemBoardRecord[]; nextCursor: string | null }> {
    const where: Prisma.JobOrderItemWhereInput = {
      jobOrder: { deletedAt: null },
    };

    switch (filter.view) {
      case "done":
        where.archivedAt = { not: null };
        break;
      case "all":
        break;
      case "active":
        where.archivedAt = null;
        where.jobOrder = {
          deletedAt: null,
          status: { not: JobOrderStatus.CANCELLED },
        };
        break;
      default:
        Object.assign(where, boardMetricItemWhere(filter.view));
        where.archivedAt = null;
        where.jobOrder = {
          deletedAt: null,
          status: { not: JobOrderStatus.CANCELLED },
        };
        break;
    }

    if (filter.q) {
      where.AND = [
        {
          OR: [
            { description: { contains: filter.q, mode: "insensitive" } },
            { lineItemId: { contains: filter.q, mode: "insensitive" } },
            {
              jobOrder: {
                joNumber: { contains: filter.q, mode: "insensitive" },
              },
            },
            {
              jobOrder: {
                customer: {
                  name: { contains: filter.q, mode: "insensitive" },
                },
              },
            },
          ],
        },
      ];
    }

    // Active work sorts by soonest deadline (blank deadlines last); finished
    // views sort newest first.
    const orderBy: Prisma.JobOrderItemOrderByWithRelationInput[] =
      filter.view === "done"
        ? [{ archivedAt: "desc" }, { id: "desc" }]
        : filter.view === "all"
          ? [{ jobOrder: { createdAt: "desc" } }, { id: "desc" }]
          : [{ deadline: { sort: "asc", nulls: "last" } }, { id: "asc" }];

    const rows = await prisma.jobOrderItem.findMany({
      where,
      include: itemBoardInclude,
      orderBy,
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

  async updateItem(
    itemId: string,
    data: ItemUpdateData & Partial<ItemProductionUpdateData>,
    tx?: DbTx
  ): Promise<void> {
    await (tx ?? prisma).jobOrderItem.update({ where: { id: itemId }, data });
  }

  async listCalendarItems(
    start: Date,
    end: Date
  ): Promise<JobOrderItemBoardRecord[]> {
    return prisma.jobOrderItem.findMany({
      where: {
        archivedAt: null,
        deadline: { gte: start, lt: end },
        // Legacy getJODeadlinesForMonth skips waiting-pickup items.
        NOT: containsAny(PICKUP_EXCLUDE_KEYWORDS),
        jobOrder: {
          deletedAt: null,
          status: { not: JobOrderStatus.CANCELLED },
        },
      },
      include: itemBoardInclude,
      orderBy: [{ deadline: "asc" }, { id: "asc" }],
    });
  }

  async moveJoDeadline(
    jobOrderId: string,
    newDate: Date,
    tx?: DbTx
  ): Promise<number> {
    const db = tx ?? prisma;
    const result = await db.jobOrderItem.updateMany({
      where: { jobOrderId, archivedAt: null },
      data: { deadline: newDate },
    });
    await db.jobOrder.update({
      where: { id: jobOrderId },
      data: { deadline: newDate },
    });
    return result.count;
  }

  async findDetail(id: string): Promise<JobOrderDetailRecord | null> {
    return prisma.jobOrder.findFirst({
      where: { id, deletedAt: null },
      select: detailSelect,
    });
  }

  async existsJoNumber(
    joNumber: string,
    excludeId?: string,
    tx?: DbTx
  ): Promise<boolean> {
    const found = await (tx ?? prisma).jobOrder.findFirst({
      where: {
        joNumber: { equals: joNumber, mode: "insensitive" },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    return !!found;
  }

  async nextCounter(key: string, tx?: DbTx): Promise<number> {
    const counter = await (tx ?? prisma).counter.upsert({
      where: { key },
      create: { key, value: 1 },
      update: { value: { increment: 1 } },
    });
    return counter.value;
  }

  async filterExistingJoNumbers(joNumbers: string[]): Promise<string[]> {
    if (joNumbers.length === 0) return [];
    const found = await prisma.jobOrder.findMany({
      where: { joNumber: { in: joNumbers, mode: "insensitive" } },
      select: { joNumber: true },
    });
    return found.map((f) => f.joNumber);
  }

  async createWithItems(
    data: JobOrderCreateData,
    tx?: DbTx
  ): Promise<{ id: string; joNumber: string }> {
    const { items, ...header } = data;
    return (tx ?? prisma).jobOrder.create({
      data: { ...header, items: { create: items } },
      select: { id: true, joNumber: true },
    });
  }

  async updateHeader(
    id: string,
    data: JobOrderHeaderUpdateData,
    tx?: DbTx
  ): Promise<void> {
    await (tx ?? prisma).jobOrder.update({ where: { id }, data });
  }

  async replaceItems(
    jobOrderId: string,
    ops: {
      create: ItemCreateData[];
      update: {
        id: string;
        data: ItemUpdateData & Partial<ItemProductionUpdateData>;
      }[];
      deleteIds: string[];
    },
    tx?: DbTx
  ): Promise<void> {
    const db = tx ?? prisma;
    if (ops.deleteIds.length > 0) {
      await db.jobOrderItem.deleteMany({
        where: { id: { in: ops.deleteIds }, jobOrderId },
      });
    }
    for (const { id, data } of ops.update) {
      await db.jobOrderItem.update({ where: { id }, data });
    }
    if (ops.create.length > 0) {
      await db.jobOrderItem.createMany({
        data: ops.create.map((item) => ({ ...item, jobOrderId })),
      });
    }
  }

  async findItem(
    jobOrderId: string,
    itemId: string,
    tx?: DbTx
  ): Promise<JobOrderItemRecord | null> {
    return (tx ?? prisma).jobOrderItem.findFirst({
      where: { id: itemId, jobOrderId },
    });
  }

  async updateItemProduction(
    itemId: string,
    data: ItemProductionUpdateData,
    tx?: DbTx
  ): Promise<void> {
    await (tx ?? prisma).jobOrderItem.update({ where: { id: itemId }, data });
  }

  async getItemsProduction(
    jobOrderId: string,
    tx?: DbTx
  ): Promise<ItemProductionState[]> {
    return (tx ?? prisma).jobOrderItem.findMany({
      where: { jobOrderId },
      select: {
        id: true,
        productionStatus: true,
        archivedAt: true,
        waitingPickupSince: true,
      },
    });
  }

  async setJoStatus(
    id: string,
    status: JobOrderStatus,
    completedAt: Date | null,
    tx?: DbTx
  ): Promise<void> {
    await (tx ?? prisma).jobOrder.update({
      where: { id },
      data: { status, completedAt },
    });
  }

  async addJoStatusHistory(
    entry: {
      jobOrderId: string;
      fromStatus: JobOrderStatus | null;
      toStatus: JobOrderStatus;
      changedById: string;
      remarks?: string;
    },
    tx?: DbTx
  ): Promise<void> {
    await (tx ?? prisma).jobOrderStatusHistory.create({ data: entry });
  }

  async softDelete(id: string, tx?: DbTx): Promise<void> {
    await (tx ?? prisma).jobOrder.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
