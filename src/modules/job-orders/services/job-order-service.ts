import { format } from "date-fns";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { assertRole, type Actor } from "@/lib/authz";
import { JobOrderStatus, Role } from "@/generated/prisma/enums";
import type { ICustomerRepository } from "@/modules/shared/repositories/customer-repository";
import type { IActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import type {
  IJobOrderRepository,
  ItemCreateData,
  ItemProductionUpdateData,
  ItemUpdateData,
  JobOrderDetailRecord,
  JobOrderItemBoardRecord,
  JobOrderItemRecord,
  JobOrderListRecord,
} from "../repositories/job-order-repository";
import type {
  BoardMetricsDto,
  ItemEditInput,
  ItemStatusUpdateInput,
  MoveDeadlineInput,
  JobOrderCreateInput,
  JobOrderDetailDto,
  JobOrderItemDto,
  JobOrderItemInput,
  JobOrderItemRowDto,
  JobOrderItemsPageDto,
  JobOrderListFilters,
  JobOrderListPageDto,
  JobOrderListRowDto,
  JobOrderUpdateInput,
} from "../schemas/job-order";
import {
  appendHistory,
  departmentOf,
  isDoneStatus,
  isWaitingPickupStatus,
} from "./production-status";

const WRITER_ROLES = [Role.ADMIN, Role.MANAGER, Role.ENCODER] as const;
const DELETE_ROLES = [Role.ADMIN, Role.MANAGER] as const;

const DAY_MS = 86_400_000;

const parseDate = (value?: string): Date | null =>
  value ? new Date(`${value}T00:00:00`) : null;
const toIso = (d: Date | null): string | null => (d ? d.toISOString() : null);
// Date-only fields (deadlines, plan dates) serialize as LOCAL yyyy-MM-dd —
// UTC ISO would shift them a day back (legacy formatDate_ was local too).
const dateOnly = (d: Date | null): string | null =>
  d ? format(d, "yyyy-MM-dd") : null;
const money = (n: number): string => n.toFixed(2);

export class JobOrderService {
  constructor(
    private readonly jobOrders: IJobOrderRepository,
    private readonly customers: ICustomerRepository,
    private readonly activity: IActivityLogRepository
  ) {}

  async list(
    _actor: Actor,
    filters: JobOrderListFilters
  ): Promise<JobOrderListPageDto> {
    const { rows, nextCursor } = await this.jobOrders.listPage(filters);
    return { rows: rows.map(mapListRow), nextCursor };
  }

  /** Readable by every authenticated role (the route enforces the session). */
  async getBoardMetrics(): Promise<BoardMetricsDto> {
    return this.jobOrders.countBoardMetrics();
  }

  /** Calendar pins for one month (legacy getJODeadlinesForMonth). */
  async listCalendar(
    _actor: Actor,
    year: number,
    month: number
  ): Promise<JobOrderItemRowDto[]> {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);
    const rows = await this.jobOrders.listCalendarItems(start, end);
    return rows.map(mapItemRow);
  }

  /** Legacy updateJODeadlineFromCalendar: drag-drop moves the deadline of
   *  every open item of the JO together, with a no-op guard + audit entry. */
  async moveJoDeadline(
    actor: Actor,
    input: MoveDeadlineInput
  ): Promise<{ itemsMoved: number }> {
    assertRole(actor, DELETE_ROLES); // ADMIN/MANAGER ≈ legacy Admin/Production Planner

    const detail = await this.jobOrders.findDetail(input.jobOrderId);
    if (!detail) throw new NotFoundError("Job order not found.");

    const newDate = parseDate(input.newDate)!;
    const open = detail.items.filter((i) => i.archivedAt === null);
    if (open.length === 0) {
      throw new ValidationError("This JO has no active items to move.");
    }
    if (open.every((i) => dateOnly(i.deadline) === input.newDate)) {
      throw new ValidationError(`Deadline is already ${input.newDate}.`);
    }

    const oldDeadline = dateOnly(detail.deadline) ?? "(none)";

    return this.jobOrders.withTransaction(async (tx) => {
      const itemsMoved = await this.jobOrders.moveJoDeadline(
        input.jobOrderId,
        newDate,
        tx
      );
      await this.activity.log(
        {
          userId: actor.id,
          entityType: "JobOrder",
          entityId: input.jobOrderId,
          action: "deadline-moved",
          payload: {
            joNumber: detail.joNumber,
            oldDeadline,
            newDeadline: input.newDate,
            itemsMoved,
            source: "calendar_drag",
          },
        },
        tx
      );
      return { itemsMoved };
    });
  }

  /** Per-item board rows (legacy JOWebApp table: one row per line item). */
  async listItems(
    _actor: Actor,
    filters: JobOrderListFilters
  ): Promise<JobOrderItemsPageDto> {
    const { rows, nextCursor } = await this.jobOrders.listItemsPage(filters);
    return { rows: rows.map(mapItemRow), nextCursor };
  }

  /** Legacy updateJORow: edit an item's fields and (optionally) its status
   *  in one save — history merge, waiting stamp, done auto-archive included. */
  async updateItem(actor: Actor, input: ItemEditInput): Promise<void> {
    assertRole(actor, WRITER_ROLES);

    const detail = await this.jobOrders.findDetail(input.jobOrderId);
    if (!detail) throw new NotFoundError("Job order not found.");
    const item = detail.items.find((i) => i.id === input.id);
    if (!item) throw new NotFoundError("Job order item not found.");

    const amount = parseFloat(input.amount);
    const data: ItemUpdateData & Partial<ItemProductionUpdateData> =
      buildItemFields(input, item.sortOrder, item.lineItemId);

    // Status transition, only when it actually changed (same rules as the
    // dedicated status update).
    const status = input.productionStatus?.trim();
    const statusChanged = !!status && status !== item.productionStatus;
    if (statusChanged) {
      Object.assign(data, buildStatusTransition(item, status, input.remark));
    }

    // Recompute the JO header from the edited set of items.
    const items = detail.items.map((i) =>
      i.id === item.id
        ? {
            lineTotal: money(amount),
            deadline: data.deadline ?? null,
            isLFP: input.isLFP,
          }
        : { lineTotal: i.lineTotal.toString(), deadline: i.deadline, isLFP: i.isLFP }
    );
    const total = money(
      items.reduce((sum, i) => sum + parseFloat(i.lineTotal), 0)
    );
    const deadlines = items
      .map((i) => i.deadline)
      .filter((d): d is Date => d !== null);

    await this.jobOrders.withTransaction(async (tx) => {
      await this.jobOrders.updateItem(input.id, data, tx);
      await this.jobOrders.updateHeader(
        input.jobOrderId,
        {
          subtotal: total,
          total,
          deadline: deadlines.length
            ? new Date(Math.min(...deadlines.map((d) => d.getTime())))
            : null,
          isLFP: items.some((i) => i.isLFP),
        },
        tx
      );
      await this.syncJoStatus(actor, input.jobOrderId, detail.status, tx);
      await this.activity.log(
        {
          userId: actor.id,
          entityType: "JobOrderItem",
          entityId: input.id,
          action: "update",
          payload: {
            joNumber: detail.joNumber,
            statusChanged: statusChanged ? status : false,
          },
        },
        tx
      );
    });
  }

  async get(_actor: Actor, id: string): Promise<JobOrderDetailDto> {
    const detail = await this.jobOrders.findDetail(id);
    if (!detail) throw new NotFoundError("Job order not found.");
    return mapDetail(detail);
  }

  async create(
    actor: Actor,
    input: JobOrderCreateInput
  ): Promise<{ id: string }> {
    assertRole(actor, WRITER_ROLES);

    const joNumber = input.joNumber.trim();
    if (await this.jobOrders.existsJoNumber(joNumber)) {
      throw new ConflictError(`JO Number "${joNumber}" already exists.`);
    }

    const items = buildItems(joNumber, input.items, 0);
    const header = deriveHeader(items);

    return this.jobOrders.withTransaction(async (tx) => {
      const customer = await this.customers.findOrCreateByName(
        input.customerName,
        actor.id,
        tx
      );
      const created = await this.jobOrders.createWithItems(
        {
          joNumber,
          customerId: customer.id,
          // Matches legacy JOWebApp semantics: a submitted JO is already in
          // production. DRAFT/PENDING_REVIEW are reserved for the future
          // quotation-fed approval gate.
          status: JobOrderStatus.IN_PROGRESS,
          deadline: header.deadline,
          planDateStart: parseDate(input.planDateStart),
          planDateEnd: parseDate(input.planDateEnd),
          isLFP: header.isLFP,
          subtotal: header.total,
          total: header.total,
          notes: input.notes || null,
          createdById: actor.id,
          items,
        },
        tx
      );
      await this.jobOrders.addJoStatusHistory(
        {
          jobOrderId: created.id,
          fromStatus: null,
          toStatus: JobOrderStatus.IN_PROGRESS,
          changedById: actor.id,
        },
        tx
      );
      await this.activity.log(
        {
          userId: actor.id,
          entityType: "JobOrder",
          entityId: created.id,
          action: "create",
          payload: { joNumber, items: items.length },
        },
        tx
      );

      // TODO(PRISM): the legacy system inserted every LFP line item into the
      // PRISM production database HERE — on JO creation ONLY, never on update
      // (insertToPRISM_ in JobOrderCode.js, one row per isLFP item with
      // joNumber/customer/desc/category/qty/dims/deadline/rush/lineItemId).
      // Skipped until the PRISM module exists in ops_fusion.

      return { id: created.id };
    });
  }

  async update(actor: Actor, input: JobOrderUpdateInput): Promise<void> {
    assertRole(actor, WRITER_ROLES);

    const detail = await this.jobOrders.findDetail(input.id);
    if (!detail) throw new NotFoundError("Job order not found.");

    const existingIds = new Set(detail.items.map((i) => i.id));
    const keptIds = new Set(
      input.items.map((i) => i.id).filter((id): id is string => !!id)
    );
    const deleteIds = [...existingIds].filter((id) => !keptIds.has(id));

    const toUpdate: {
      id: string;
      data: ItemUpdateData & Partial<ItemProductionUpdateData>;
    }[] = [];
    const toCreate: ItemCreateData[] = [];
    input.items.forEach((item, index) => {
      const current = item.id
        ? detail.items.find((i) => i.id === item.id)
        : undefined;
      if (item.id && current) {
        const status = item.productionStatus?.trim();
        const data: ItemUpdateData & Partial<ItemProductionUpdateData> = {
          // never renumber an existing item
          ...buildItemFields(item, index, current.lineItemId),
          ...(status && status !== current.productionStatus
            ? buildStatusTransition(current, status, item.remark)
            : {}),
        };
        toUpdate.push({ id: item.id, data });
      } else {
        toCreate.push(buildItem(detail.joNumber, item, index));
      }
    });

    const all = buildItems(detail.joNumber, input.items, 0);
    const header = deriveHeader(all);

    await this.jobOrders.withTransaction(async (tx) => {
      const customer = await this.customers.findOrCreateByName(
        input.customerName,
        actor.id,
        tx
      );
      await this.jobOrders.updateHeader(
        input.id,
        {
          customerId: customer.id,
          deadline: header.deadline,
          planDateStart: parseDate(input.planDateStart),
          planDateEnd: parseDate(input.planDateEnd),
          isLFP: header.isLFP,
          subtotal: header.total,
          total: header.total,
          notes: input.notes || null,
        },
        tx
      );
      await this.jobOrders.replaceItems(
        input.id,
        { create: toCreate, update: toUpdate, deleteIds },
        tx
      );
      await this.syncJoStatus(actor, input.id, detail.status, tx);
      await this.activity.log(
        {
          userId: actor.id,
          entityType: "JobOrder",
          entityId: input.id,
          action: "update",
          payload: {
            joNumber: detail.joNumber,
            created: toCreate.length,
            updated: toUpdate.length,
            deleted: deleteIds.length,
          },
        },
        tx
      );
    });
  }

  async updateItemStatus(
    actor: Actor,
    input: ItemStatusUpdateInput
  ): Promise<void> {
    assertRole(actor, WRITER_ROLES);

    const detail = await this.jobOrders.findDetail(input.jobOrderId);
    if (!detail) throw new NotFoundError("Job order not found.");
    const item = detail.items.find((i) => i.id === input.itemId);
    if (!item) throw new NotFoundError("Job order item not found.");

    const status = input.productionStatus;
    const now = new Date();

    // Waiting-pickup timestamp: stamp on entry, keep while waiting, clear on
    // exit — exactly like legacy updateJORow.
    const wasWaiting = isWaitingPickupStatus(item.productionStatus);
    const nowWaiting = isWaitingPickupStatus(status);
    let waitingPickupSince = item.waitingPickupSince;
    if (nowWaiting && !wasWaiting) waitingPickupSince = now;
    else if (!nowWaiting) waitingPickupSince = null;

    const done = isDoneStatus(status);
    const historyEntry = input.remark ? `${status} — ${input.remark}` : status;

    await this.jobOrders.withTransaction(async (tx) => {
      await this.jobOrders.updateItemProduction(
        input.itemId,
        {
          productionStatus: status,
          department: departmentOf(status),
          statusHistory: appendHistory(item.statusHistory, historyEntry),
          waitingPickupSince,
          // Done items auto-archive (legacy behavior); reverting a done
          // status un-archives so the item shows on the board again.
          archivedAt: done ? (item.archivedAt ?? now) : null,
          actualDate: done ? (item.actualDate ?? now) : item.actualDate,
        },
        tx
      );
      await this.syncJoStatus(actor, input.jobOrderId, detail.status, tx);
      await this.activity.log(
        {
          userId: actor.id,
          entityType: "JobOrderItem",
          entityId: input.itemId,
          action: "status",
          payload: {
            joNumber: detail.joNumber,
            from: item.productionStatus,
            to: status,
            remark: input.remark ?? null,
          },
        },
        tx
      );
    });
  }

  async softDelete(actor: Actor, id: string): Promise<void> {
    assertRole(actor, DELETE_ROLES);
    const detail = await this.jobOrders.findDetail(id);
    if (!detail) throw new NotFoundError("Job order not found.");

    await this.jobOrders.withTransaction(async (tx) => {
      await this.jobOrders.softDelete(id, tx);
      await this.activity.log(
        {
          userId: actor.id,
          entityType: "JobOrder",
          entityId: id,
          action: "delete",
          payload: { joNumber: detail.joNumber },
        },
        tx
      );
    });
  }

  /** All items archived → JO COMPLETED; anything reopened → IN_PROGRESS. */
  private async syncJoStatus(
    actor: Actor,
    jobOrderId: string,
    currentStatus: JobOrderStatus,
    tx: Parameters<IJobOrderRepository["getItemsProduction"]>[1]
  ): Promise<void> {
    const items = await this.jobOrders.getItemsProduction(jobOrderId, tx);
    const allDone =
      items.length > 0 && items.every((i) => i.archivedAt !== null);

    const next = allDone
      ? JobOrderStatus.COMPLETED
      : currentStatus === JobOrderStatus.COMPLETED
        ? JobOrderStatus.IN_PROGRESS
        : currentStatus;

    if (next !== currentStatus) {
      await this.jobOrders.setJoStatus(
        jobOrderId,
        next,
        next === JobOrderStatus.COMPLETED ? new Date() : null,
        tx
      );
      await this.jobOrders.addJoStatusHistory(
        {
          jobOrderId,
          fromStatus: currentStatus,
          toStatus: next,
          changedById: actor.id,
        },
        tx
      );
    }
  }
}

// ——— input → persistence payloads ———

/** Editable field set of an existing item — production state excluded
 *  (that changes only via buildStatusTransition). */
function buildItemFields(
  item: Pick<
    JobOrderItemInput,
    | "description"
    | "qty"
    | "amount"
    | "deadline"
    | "assignedTo"
    | "category"
    | "isLFP"
    | "lfpWidth"
    | "lfpHeight"
    | "lfpUnit"
    | "isRush"
  >,
  sortOrder: number,
  lineItemId: string | null
): ItemUpdateData {
  const qty = parseInt(item.qty, 10);
  const amount = parseFloat(item.amount);
  return {
    description: item.description,
    qty,
    unitPrice: money(amount / qty),
    lineTotal: money(amount),
    deadline: parseDate(item.deadline),
    assignedTo: item.assignedTo || null,
    category: item.category || null,
    isLFP: item.isLFP,
    lfpWidth: item.isLFP ? item.lfpWidth || null : null,
    lfpHeight: item.isLFP ? item.lfpHeight || null : null,
    lfpUnit: item.isLFP ? item.lfpUnit || "ft" : null,
    isRush: item.isRush,
    lineItemId,
    sortOrder,
  };
}

/** Production-state changes when an item's status text changes (legacy
 *  updateJORow): history append with remark, waiting-pickup stamp/clear,
 *  done auto-archive (and un-archive on revert). */
function buildStatusTransition(
  item: JobOrderItemRecord,
  status: string,
  remark?: string
): ItemProductionUpdateData {
  const now = new Date();
  const wasWaiting = isWaitingPickupStatus(item.productionStatus);
  const nowWaiting = isWaitingPickupStatus(status);
  let waitingPickupSince = item.waitingPickupSince;
  if (nowWaiting && !wasWaiting) waitingPickupSince = now;
  else if (!nowWaiting) waitingPickupSince = null;
  const done = isDoneStatus(status);

  return {
    productionStatus: status,
    department: departmentOf(status),
    statusHistory: appendHistory(
      item.statusHistory,
      remark ? `${status} — ${remark}` : status
    ),
    waitingPickupSince,
    archivedAt: done ? (item.archivedAt ?? now) : null,
    actualDate: done ? (item.actualDate ?? now) : item.actualDate,
  };
}

function buildItem(
  joNumber: string,
  item: JobOrderItemInput,
  index: number
): ItemCreateData {
  const qty = parseInt(item.qty, 10);
  const amount = parseFloat(item.amount);
  return {
    description: item.description,
    qty,
    unitPrice: money(amount / qty),
    lineTotal: money(amount),
    deadline: parseDate(item.deadline),
    productionStatus: item.productionStatus || null,
    department: departmentOf(item.productionStatus),
    assignedTo: item.assignedTo || null,
    category: item.category || null,
    isLFP: item.isLFP,
    lfpWidth: item.isLFP ? item.lfpWidth || null : null,
    lfpHeight: item.isLFP ? item.lfpHeight || null : null,
    lfpUnit: item.isLFP ? item.lfpUnit || "ft" : null,
    isRush: item.isRush,
    lineItemId: `${joNumber}-${String(index + 1).padStart(2, "0")}`,
    sortOrder: index,
  };
}

function buildItems(
  joNumber: string,
  items: JobOrderItemInput[],
  startIndex: number
): ItemCreateData[] {
  return items.map((item, i) => {
    const data = buildItem(joNumber, item, startIndex + i);
    if (data.productionStatus) {
      data.statusHistory = appendHistory(null, data.productionStatus);
      data.waitingPickupSince = isWaitingPickupStatus(data.productionStatus)
        ? new Date()
        : null;
    }
    return data;
  });
}

function deriveHeader(items: ItemCreateData[]): {
  deadline: Date | null;
  isLFP: boolean;
  total: string;
} {
  const deadlines = items
    .map((i) => i.deadline)
    .filter((d): d is Date => d !== null && d !== undefined);
  const total = items.reduce((sum, i) => sum + parseFloat(i.lineTotal), 0);
  return {
    deadline: deadlines.length
      ? new Date(Math.min(...deadlines.map((d) => d.getTime())))
      : null,
    isLFP: items.some((i) => i.isLFP),
    total: money(total),
  };
}

// ——— record → DTO mapping (Decimal/Date never leave the server raw) ———

function mapItem(item: JobOrderItemRecord): JobOrderItemDto {
  const now = Date.now();
  const done = item.archivedAt !== null || isDoneStatus(item.productionStatus);
  const waiting =
    !done && isWaitingPickupStatus(item.productionStatus);
  const overdue =
    !done &&
    !waiting &&
    item.deadline !== null &&
    item.deadline.getTime() < now;

  return {
    id: item.id,
    description: item.description,
    qty: item.qty,
    lineTotal: item.lineTotal.toString(),
    productionStatus: item.productionStatus,
    department: item.department,
    deadline: dateOnly(item.deadline),
    daysLeft: item.deadline
      ? Math.ceil((item.deadline.getTime() - now) / DAY_MS)
      : null,
    actualDate: dateOnly(item.actualDate),
    assignedTo: item.assignedTo,
    category: item.category,
    isLFP: item.isLFP,
    lfpWidth: item.lfpWidth,
    lfpHeight: item.lfpHeight,
    lfpUnit: item.lfpUnit,
    isRush: item.isRush,
    statusHistory: item.statusHistory,
    waitingPickupSince: toIso(item.waitingPickupSince),
    archivedAt: toIso(item.archivedAt),
    lineItemId: item.lineItemId,
    isDone: done,
    isWaitingPickup: waiting,
    isOverdue: overdue,
  };
}

function mapItemRow(record: JobOrderItemBoardRecord): JobOrderItemRowDto {
  return {
    ...mapItem(record),
    jobOrderId: record.jobOrder.id,
    joNumber: record.jobOrder.joNumber,
    customerName: record.jobOrder.customer.name,
  };
}

function mapListRow(row: JobOrderListRecord): JobOrderListRowDto {
  const now = Date.now();
  const open = row.items.filter(
    (i) => i.archivedAt === null && !isDoneStatus(i.productionStatus)
  );
  const openDeadlines = open
    .map((i) => i.deadline)
    .filter((d): d is Date => d !== null);
  const deadline = openDeadlines.length
    ? new Date(Math.min(...openDeadlines.map((d) => d.getTime())))
    : row.deadline;

  return {
    id: row.id,
    joNumber: row.joNumber,
    customerName: row.customer.name,
    status: row.status,
    total: row.total.toString(),
    itemCount: row.items.length,
    openItemCount: open.length,
    deadline: dateOnly(deadline),
    isRush: open.some((i) => i.isRush),
    hasWaitingPickup: row.items.some(
      (i) => i.waitingPickupSince !== null && i.archivedAt === null
    ),
    isOverdue: open.some(
      (i) =>
        i.deadline !== null &&
        i.deadline.getTime() < now &&
        !isWaitingPickupStatus(i.productionStatus)
    ),
    createdAt: row.createdAt.toISOString(),
    imported: row.importedAt !== null,
  };
}

function mapDetail(detail: JobOrderDetailRecord): JobOrderDetailDto {
  return {
    id: detail.id,
    joNumber: detail.joNumber,
    status: detail.status,
    customer: detail.customer,
    notes: detail.notes,
    planDateStart: dateOnly(detail.planDateStart),
    planDateEnd: dateOnly(detail.planDateEnd),
    deadline: dateOnly(detail.deadline),
    total: detail.total.toString(),
    isLFP: detail.isLFP,
    imported: detail.importedAt !== null,
    createdAt: detail.createdAt.toISOString(),
    createdByName: detail.createdBy.name,
    completedAt: toIso(detail.completedAt),
    items: detail.items.map(mapItem),
  };
}
