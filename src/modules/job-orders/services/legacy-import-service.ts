import { ValidationError } from "@/lib/errors";
import { assertRole, type Actor } from "@/lib/authz";
import { JobOrderStatus, Role } from "@/generated/prisma/enums";
import type { ICustomerRepository } from "@/modules/shared/repositories/customer-repository";
import type { IActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import type {
  IJobOrderRepository,
  ItemCreateData,
  JobOrderCreateData,
} from "../repositories/job-order-repository";
import type { ImportSource, ImportSummaryDto } from "../schemas/job-order";
import {
  departmentOf,
  isDoneStatus,
  isWaitingPickupStatus,
} from "./production-status";

const IMPORT_ROLES = [Role.ADMIN, Role.MANAGER] as const;

// Legacy "Line-up JOs" / "Archive Line-up JOs" sheet columns (A–T). On the
// archive sheet col R is "Date Archive" instead of "Waiting Pickup Since".
const COL = {
  department: 0,
  statusDepartment: 1,
  planDateStart: 2,
  planDateEnd: 3,
  dateCreated: 4,
  deadline: 5,
  actualDate: 6,
  statusHistory: 7,
  specs: 8,
  employee: 10,
  joNumber: 11,
  joAmount: 12,
  category: 13,
  lfpWidth: 14,
  lfpHeight: 15,
  lfpUnit: 16,
  waitingOrArchive: 17,
  isRush: 18,
  lineItemId: 19,
} as const;

type ParsedRow = {
  line: number; // 1-based line in the CSV, for error reporting
  joNumber: string;
  customer: string;
  jobDesc: string;
  qtyRaw: string;
  qty: number;
  amount: number;
  statusDepartment: string | null;
  department: string | null;
  planDateStart: Date | null;
  planDateEnd: Date | null;
  dateCreated: Date | null;
  deadline: Date | null;
  actualDate: Date | null;
  statusHistory: string | null;
  employee: string | null;
  category: string | null;
  lfpWidth: string | null;
  lfpHeight: string | null;
  lfpUnit: string | null;
  colR: Date | null; // waiting-pickup-since (lineup) or date-archive (archive)
  isRush: boolean;
  lineItemId: string | null;
};

export class LegacyImportService {
  constructor(
    private readonly jobOrders: IJobOrderRepository,
    private readonly customers: ICustomerRepository,
    private readonly activity: IActivityLogRepository
  ) {}

  /** `rows` are positional cells (A–T) from fileToRows — CSV or XLSX. */
  async import(
    actor: Actor,
    rows: string[][],
    source: ImportSource
  ): Promise<ImportSummaryDto> {
    assertRole(actor, IMPORT_ROLES);

    const summary: ImportSummaryDto = {
      jobOrdersCreated: 0,
      itemsCreated: 0,
      customersCreated: 0,
      skippedExisting: [],
      errors: [],
    };

    if (rows.length === 0) throw new ValidationError("The file is empty.");

    // Parse rows → group by JO number (one legacy row = one line item).
    const groups = new Map<string, ParsedRow[]>();
    rows.forEach((cells, index) => {
      const joNumber = (cells[COL.joNumber] ?? "").trim();
      if (!joNumber) return; // blank/filler rows, like legacy getAllJobOrders
      if (joNumber.toLowerCase() === "jo number") return; // header row
      try {
        const parsed = parseRow(cells, index + 1);
        const key = joNumber.toLowerCase();
        const group = groups.get(key);
        if (group) group.push(parsed);
        else groups.set(key, [parsed]);
      } catch (err) {
        summary.errors.push({
          line: index + 1,
          message: err instanceof Error ? err.message : "Unparseable row",
        });
      }
    });
    if (groups.size === 0 && summary.errors.length === 0) {
      throw new ValidationError(
        "No job order rows found. Upload the 'Line-up JOs' or 'Archive Line-up JOs' sheet (or the whole workbook as .xlsx) with all 20 columns (A–T)."
      );
    }

    // Skip JO numbers that already exist (re-imports stay idempotent).
    const existing = await this.jobOrders.filterExistingJoNumbers(
      [...groups.values()].map((g) => g[0]!.joNumber)
    );
    for (const joNumber of existing) {
      groups.delete(joNumber.toLowerCase());
      summary.skippedExisting.push(joNumber);
    }

    // Resolve all customers in one batch (created once, reused across JOs).
    const { idByName, created } = await this.customers.findOrCreateManyByName(
      [...groups.values()].map((g) => g[0]!.customer),
      actor.id
    );
    summary.customersCreated = created;

    const importedAt = new Date();
    const payloads = [...groups.values()].map((group) =>
      buildJobOrder(group, idByName, actor.id, source, importedAt)
    );

    // Insert in chunks; if a chunk fails, retry its JOs one by one so a single
    // bad record doesn't sink the whole import.
    const CHUNK = 10;
    for (let i = 0; i < payloads.length; i += CHUNK) {
      const chunk = payloads.slice(i, i + CHUNK);
      try {
        await this.insertBatch(chunk, actor);
        for (const jo of chunk) {
          summary.jobOrdersCreated += 1;
          summary.itemsCreated += jo.data.items.length;
        }
      } catch {
        for (const jo of chunk) {
          try {
            await this.insertBatch([jo], actor);
            summary.jobOrdersCreated += 1;
            summary.itemsCreated += jo.data.items.length;
          } catch (err) {
            summary.errors.push({
              line: jo.firstLine,
              message: `${jo.data.joNumber}: ${
                err instanceof Error ? err.message : "insert failed"
              }`,
            });
          }
        }
      }
    }

    await this.activity.log({
      userId: actor.id,
      entityType: "JobOrder",
      entityId: "legacy-import",
      action: "import",
      payload: {
        source,
        jobOrdersCreated: summary.jobOrdersCreated,
        itemsCreated: summary.itemsCreated,
        customersCreated: summary.customersCreated,
        skippedExisting: summary.skippedExisting.length,
        errors: summary.errors.length,
      },
    });

    return summary;
  }

  // TODO(PRISM): no PRISM sync on import — legacy only inserted LFP items to
  // PRISM when a NEW JO was submitted, and imported rows already exist in the
  // legacy PRISM database. Revisit when the PRISM module lands in ops_fusion.
  private async insertBatch(
    jos: { data: JobOrderCreateData; firstLine: number }[],
    actor: Actor
  ): Promise<void> {
    await this.jobOrders.withTransaction(async (tx) => {
      for (const jo of jos) {
        const created = await this.jobOrders.createWithItems(jo.data, tx);
        await this.activity.log(
          {
            userId: actor.id,
            entityType: "JobOrder",
            entityId: created.id,
            action: "import",
            payload: { joNumber: jo.data.joNumber, items: jo.data.items.length },
          },
          tx
        );
      }
    });
  }
}

// ——— row parsing (tolerant: bad cells degrade to null, never crash) ———

/** Legacy specs format: "M/d | customer | qty |" then the description on the
 *  following lines (buildSpecs_/parseSpecs_ in JobOrderCode.js). */
function parseSpecs(specs: string): {
  customer: string;
  qty: string;
  jobDesc: string;
} {
  let customer = "";
  let qty = "";
  let jobDesc = specs;

  if (specs.includes("|")) {
    const parts = specs.split("|");
    customer = (parts[1] ?? "").trim();
    qty = (parts[2] ?? "").trim();
  }
  if (specs.includes("\n")) {
    jobDesc = specs.split("\n").slice(1).join("\n").trim();
  }
  return { customer, qty, jobDesc };
}

function parseSheetDate(value: string | undefined): Date | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  const d = new Date(v); // handles "1/7/2026", "2026-01-07", and datetimes
  return isNaN(d.getTime()) ? null : d;
}

function parseAmount(value: string | undefined): number {
  const v = (value ?? "").replace(/[₱,\s]/g, "");
  const n = parseFloat(v);
  return isNaN(n) || n < 0 ? 0 : n;
}

function parseRow(cells: string[], line: number): ParsedRow {
  const specs = cells[COL.specs] ?? "";
  const { customer, qty, jobDesc } = parseSpecs(specs);
  const qtyNum = parseInt(qty.replace(/[^\d]/g, ""), 10);
  const status = (cells[COL.statusDepartment] ?? "").trim() || null;

  return {
    line,
    joNumber: (cells[COL.joNumber] ?? "").trim(),
    customer: customer || "Unknown Customer",
    jobDesc: jobDesc.trim() || specs.trim() || "(no description)",
    qtyRaw: qty,
    qty: isNaN(qtyNum) || qtyNum < 1 ? 1 : qtyNum,
    amount: parseAmount(cells[COL.joAmount]),
    statusDepartment: status,
    department:
      (cells[COL.department] ?? "").trim() || departmentOf(status),
    planDateStart: parseSheetDate(cells[COL.planDateStart]),
    planDateEnd: parseSheetDate(cells[COL.planDateEnd]),
    dateCreated: parseSheetDate(cells[COL.dateCreated]),
    deadline: parseSheetDate(cells[COL.deadline]),
    actualDate: parseSheetDate(cells[COL.actualDate]),
    statusHistory: (cells[COL.statusHistory] ?? "").trim() || null,
    employee: (cells[COL.employee] ?? "").trim() || null,
    category: (cells[COL.category] ?? "").trim() || null,
    lfpWidth: (cells[COL.lfpWidth] ?? "").trim() || null,
    lfpHeight: (cells[COL.lfpHeight] ?? "").trim() || null,
    lfpUnit: (cells[COL.lfpUnit] ?? "").trim() || null,
    colR: parseSheetDate(cells[COL.waitingOrArchive]),
    isRush: (cells[COL.isRush] ?? "").trim().toLowerCase() === "true",
    lineItemId: (cells[COL.lineItemId] ?? "").trim() || null,
  };
}

function buildJobOrder(
  group: ParsedRow[],
  customerIdByName: Map<string, string>,
  createdById: string,
  source: ImportSource,
  importedAt: Date
): { data: JobOrderCreateData; firstLine: number } {
  const first = group[0]!;
  const customerId = customerIdByName.get(first.customer.toLowerCase());
  if (!customerId) {
    // findOrCreateManyByName covers every group's customer; missing means a bug.
    throw new Error(`Customer "${first.customer}" was not resolved`);
  }

  const items: ItemCreateData[] = group.map((row, index) => {
    const done =
      source === "archive" || isDoneStatus(row.statusDepartment);
    const archivedAt = done
      ? (source === "archive" ? row.colR : null) ??
        row.actualDate ??
        row.dateCreated ??
        importedAt
      : null;

    return {
      description: row.jobDesc,
      qty: row.qty,
      unitPrice: (row.amount / row.qty).toFixed(2),
      lineTotal: row.amount.toFixed(2),
      // Preserve the raw legacy cells we normalized, in case parsing was lossy.
      specs: { legacyQty: row.qtyRaw, importLine: row.line },
      productionStatus: row.statusDepartment,
      department: row.department,
      deadline: row.deadline,
      actualDate: row.actualDate ?? (done ? archivedAt : null),
      assignedTo: row.employee,
      category: row.category,
      isLFP: !!(row.lfpWidth || row.lfpHeight),
      lfpWidth: row.lfpWidth,
      lfpHeight: row.lfpHeight,
      lfpUnit: row.lfpUnit,
      isRush: row.isRush,
      statusHistory: row.statusHistory,
      waitingPickupSince:
        source === "lineup" && !done && isWaitingPickupStatus(row.statusDepartment)
          ? row.colR
          : null,
      archivedAt,
      lineItemId:
        row.lineItemId ??
        `${first.joNumber}-${String(index + 1).padStart(2, "0")}`,
      sortOrder: index,
    };
  });

  const allDone = items.every((i) => i.archivedAt !== null);
  const total = items.reduce((sum, i) => sum + parseFloat(i.lineTotal), 0);
  const openDeadlines = items
    .filter((i) => i.archivedAt === null && i.deadline)
    .map((i) => i.deadline!.getTime());
  const allDeadlines = items
    .filter((i) => i.deadline)
    .map((i) => i.deadline!.getTime());
  const deadlinePool = openDeadlines.length ? openDeadlines : allDeadlines;
  const createdDates = group
    .map((r) => r.dateCreated)
    .filter((d): d is Date => d !== null);
  const completedAt = allDone
    ? new Date(
        Math.max(...items.map((i) => i.archivedAt?.getTime() ?? 0)) ||
          importedAt.getTime()
      )
    : null;

  return {
    firstLine: first.line,
    data: {
      joNumber: first.joNumber,
      customerId,
      status: allDone ? JobOrderStatus.COMPLETED : JobOrderStatus.IN_PROGRESS,
      deadline: deadlinePool.length ? new Date(Math.min(...deadlinePool)) : null,
      planDateStart: first.planDateStart,
      planDateEnd: first.planDateEnd,
      isLFP: items.some((i) => i.isLFP),
      subtotal: total.toFixed(2),
      total: total.toFixed(2),
      createdById,
      createdAt: createdDates.length
        ? new Date(Math.min(...createdDates.map((d) => d.getTime())))
        : undefined,
      completedAt,
      importedAt,
      items,
    },
  };
}
