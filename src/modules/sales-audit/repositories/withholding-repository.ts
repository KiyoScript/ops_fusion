import { prisma } from "@/lib/prisma";
import { ConflictError } from "@/lib/errors";
import type { WithholdingKind } from "@/generated/prisma/enums";
import type { DbTx } from "@/modules/shared/repositories/types";

// ══════════════════════════════════════════════════════════════════════════
// WITHHOLDING CERTIFICATES — every Prisma call for the register lives here.
//
// Two tables meet in this file. `WithholdingCertificate` is the paper the
// customer hands over; `CrAllocation.ewtWithheld` / `.vatWithheld` is what we
// recorded at the counter. The register exists to prove those two agree, and
// to name every peso where they do not.
// ══════════════════════════════════════════════════════════════════════════

/** Which allocation column a certificate kind reconciles against. */
const AMOUNT_FIELD = {
  EWT_2307: "ewtWithheld",
  VAT_2306: "vatWithheld",
} as const;

/** Which link column a certificate kind occupies. */
const LINK_FIELD = {
  EWT_2307: "ewtCertificateId",
  VAT_2306: "vatCertificateId",
} as const;

export type WithheldAllocationRecord = {
  allocationId: string;
  /**
   * Which tax this row is. A single collection can appear TWICE in the same
   * result — once as income tax, once as VAT — so the kind travels with the
   * row rather than with the query. Losing it here would file withheld VAT
   * on the income-tax return.
   */
  kind: WithholdingKind;
  customerId: string;
  customerName: string;
  crId: string;
  crNumber: string | null;
  collectedAt: Date;
  saleId: string;
  documentNo: string | null;
  joNumber: string | null;
  /** Withheld under the kind that was queried. */
  withheld: string;
  vatableSales: string;
  certificateId: string | null;
};

export type CertificateRecord = {
  id: string;
  customerId: string;
  customerName: string;
  kind: WithholdingKind;
  certificateNo: string | null;
  periodFrom: Date | null;
  periodTo: Date | null;
  amount: string;
  taxBase: string | null;
  ratePct: string | null;
  receivedAt: Date | null;
  notes: string | null;
  fileName: string | null;
  fileSize: number | null;
  createdAt: Date;
  createdByName: string;
  allocations: WithheldAllocationRecord[];
};

export type CertificateCreateData = {
  customerId: string;
  kind: WithholdingKind;
  certificateNo: string | null;
  periodFrom: Date | null;
  periodTo: Date | null;
  amount: string;
  taxBase: string | null;
  ratePct: string | null;
  receivedAt: Date | null;
  notes: string | null;
  createdById: string;
};

export type CertificateUpdateData = {
  certificateNo: string | null;
  periodFrom: Date | null;
  periodTo: Date | null;
  amount: string;
  taxBase: string | null;
  ratePct: string | null;
  receivedAt: Date | null;
  notes: string | null;
};

export type CertificateQuery = {
  customerId?: string | null;
  kind?: WithholdingKind | null;
  /** Matches the certificate's PERIOD, not when it was captured. */
  from?: Date | null;
  to?: Date | null;
  search?: string | null;
};

export type WithheldQuery = {
  customerId?: string | null;
  kind?: WithholdingKind | null;
  /** Matches when the money was collected. */
  from?: Date | null;
  to?: Date | null;
  /** true → only allocations with no certificate linked. */
  uncertifiedOnly?: boolean;
};

export type CertificateFile = {
  fileName: string;
  mimeType: string;
  fileData: Uint8Array;
};

export interface IWithholdingRepository {
  list(q: CertificateQuery): Promise<CertificateRecord[]>;
  findById(id: string): Promise<CertificateRecord | null>;
  /**
   * Every withheld peso in range — certified or not. The register's totals are
   * built from this, so "uncertified" is a subtraction rather than a second
   * query that could drift out of step with the first.
   */
  listWithheld(q: WithheldQuery): Promise<WithheldAllocationRecord[]>;
  create(data: CertificateCreateData, tx?: DbTx): Promise<{ id: string }>;
  update(id: string, data: CertificateUpdateData): Promise<{ id: string }>;
  /**
   * Point allocations at a certificate. Guarded in-statement: the allocation
   * must belong to the same customer, carry a non-zero amount of that kind,
   * and not already be spoken for. Returns how many actually moved, so the
   * service can tell a partial link from a complete one instead of assuming.
   */
  link(
    certificateId: string,
    allocationIds: string[],
    tx?: DbTx
  ): Promise<number>;
  unlink(
    certificateId: string,
    allocationIds: string[],
    tx?: DbTx
  ): Promise<number>;
  /** Soft delete, releasing every allocation it held. */
  voidCertificate(id: string, tx?: DbTx): Promise<void>;
  /** Certificate numbers are unique across the register; blanks are not. */
  findByCertificateNo(certificateNo: string): Promise<{ id: string } | null>;
  attachFile(id: string, file: CertificateFile): Promise<void>;
  readFile(id: string): Promise<CertificateFile | null>;
  /** Customers who have ever had tax withheld, for the filter. */
  listWithholdingCustomers(): Promise<{ id: string; name: string }[]>;
}

const decimal = (v: unknown): string => String(v);
const optionalDecimal = (v: unknown): string | null =>
  v === null || v === undefined ? null : String(v);

const certificateSelect = {
  id: true,
  customerId: true,
  customer: { select: { name: true } },
  kind: true,
  certificateNo: true,
  periodFrom: true,
  periodTo: true,
  amount: true,
  taxBase: true,
  ratePct: true,
  receivedAt: true,
  notes: true,
  fileName: true,
  fileSize: true,
  createdAt: true,
  createdBy: { select: { name: true } },
} as const;

const allocationSelect = {
  id: true,
  amount: true,
  ewtWithheld: true,
  vatWithheld: true,
  ewtCertificateId: true,
  vatCertificateId: true,
  cr: {
    select: {
      id: true,
      crNumber: true,
      receivedAt: true,
      customerId: true,
      customer: { select: { name: true } },
    },
  },
  sale: {
    select: {
      id: true,
      documentNo: true,
      vatableSales: true,
      jobOrder: { select: { joNumber: true } },
    },
  },
} as const;

type AllocationRow = {
  id: string;
  ewtWithheld: unknown;
  vatWithheld: unknown;
  ewtCertificateId: string | null;
  vatCertificateId: string | null;
  cr: {
    id: string;
    crNumber: string | null;
    receivedAt: Date;
    customerId: string;
    customer: { name: string };
  };
  sale: {
    id: string;
    documentNo: string | null;
    vatableSales: unknown;
    jobOrder: { joNumber: string } | null;
  };
};

const toAllocation = (
  a: AllocationRow,
  kind: WithholdingKind
): WithheldAllocationRecord => ({
  allocationId: a.id,
  kind,
  customerId: a.cr.customerId,
  customerName: a.cr.customer.name,
  crId: a.cr.id,
  crNumber: a.cr.crNumber,
  collectedAt: a.cr.receivedAt,
  saleId: a.sale.id,
  documentNo: a.sale.documentNo,
  joNumber: a.sale.jobOrder?.joNumber ?? null,
  withheld: decimal(
    kind === "EWT_2307" ? a.ewtWithheld : a.vatWithheld
  ),
  vatableSales: decimal(a.sale.vatableSales),
  certificateId:
    kind === "EWT_2307" ? a.ewtCertificateId : a.vatCertificateId,
});

export class PrismaWithholdingRepository implements IWithholdingRepository {
  async list(q: CertificateQuery): Promise<CertificateRecord[]> {
    const rows = await prisma.withholdingCertificate.findMany({
      where: {
        deletedAt: null,
        ...(q.customerId ? { customerId: q.customerId } : {}),
        ...(q.kind ? { kind: q.kind } : {}),
        // A certificate falls in range when its period OVERLAPS the window.
        // Testing only periodFrom would drop a Q3 form from a September view.
        ...(q.from ? { OR: [{ periodTo: null }, { periodTo: { gte: q.from } }] } : {}),
        ...(q.to ? { periodFrom: { lte: q.to } } : {}),
        ...(q.search
          ? {
              OR: [
                { certificateNo: { contains: q.search, mode: "insensitive" } },
                { customer: { name: { contains: q.search, mode: "insensitive" } } },
                { notes: { contains: q.search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: {
        ...certificateSelect,
        ewtAllocations: { select: allocationSelect },
        vatAllocations: { select: allocationSelect },
      },
      orderBy: [{ periodTo: "desc" }, { createdAt: "desc" }],
    });
    return rows.map((c) => this.toRecord(c));
  }

  async findById(id: string): Promise<CertificateRecord | null> {
    const row = await prisma.withholdingCertificate.findFirst({
      where: { id, deletedAt: null },
      select: {
        ...certificateSelect,
        ewtAllocations: { select: allocationSelect },
        vatAllocations: { select: allocationSelect },
      },
    });
    return row ? this.toRecord(row) : null;
  }

  private toRecord(c: {
    id: string;
    customerId: string;
    customer: { name: string };
    kind: WithholdingKind;
    certificateNo: string | null;
    periodFrom: Date | null;
    periodTo: Date | null;
    amount: unknown;
    taxBase: unknown;
    ratePct: unknown;
    receivedAt: Date | null;
    notes: string | null;
    fileName: string | null;
    fileSize: number | null;
    createdAt: Date;
    createdBy: { name: string };
    ewtAllocations: AllocationRow[];
    vatAllocations: AllocationRow[];
  }): CertificateRecord {
    // Only the side matching this certificate's kind is its own. The other
    // relation is populated for the OTHER certificate covering the same
    // collection — a government job links both, to two different forms.
    const own =
      c.kind === "EWT_2307" ? c.ewtAllocations : c.vatAllocations;
    return {
      id: c.id,
      customerId: c.customerId,
      customerName: c.customer.name,
      kind: c.kind,
      certificateNo: c.certificateNo,
      periodFrom: c.periodFrom,
      periodTo: c.periodTo,
      amount: decimal(c.amount),
      taxBase: optionalDecimal(c.taxBase),
      ratePct: optionalDecimal(c.ratePct),
      receivedAt: c.receivedAt,
      notes: c.notes,
      fileName: c.fileName,
      fileSize: c.fileSize,
      createdAt: c.createdAt,
      createdByName: c.createdBy.name,
      allocations: own.map((a) => toAllocation(a, c.kind)),
    };
  }

  async listWithheld(q: WithheldQuery): Promise<WithheldAllocationRecord[]> {
    const kinds: WithholdingKind[] = q.kind
      ? [q.kind]
      : ["EWT_2307", "VAT_2306"];

    const out: WithheldAllocationRecord[] = [];
    for (const kind of kinds) {
      const amountField = AMOUNT_FIELD[kind];
      const linkField = LINK_FIELD[kind];
      const rows = await prisma.crAllocation.findMany({
        where: {
          // Withheld tax on a voided collection was never withheld. R2: the
          // register must filter the same way every other money view does, or
          // it will chase a customer for a certificate covering a cancelled
          // receipt.
          cr: {
            deletedAt: null,
            voidedAt: null,
            ...(q.customerId ? { customerId: q.customerId } : {}),
            ...(q.from || q.to
              ? {
                  receivedAt: {
                    ...(q.from ? { gte: q.from } : {}),
                    ...(q.to ? { lte: q.to } : {}),
                  },
                }
              : {}),
          },
          [amountField]: { gt: 0 },
          ...(q.uncertifiedOnly ? { [linkField]: null } : {}),
        },
        select: allocationSelect,
        orderBy: [{ cr: { receivedAt: "asc" } }, { id: "asc" }],
      });
      out.push(...rows.map((r) => toAllocation(r, kind)));
    }
    return out;
  }

  async create(
    data: CertificateCreateData,
    tx?: DbTx
  ): Promise<{ id: string }> {
    return (tx ?? prisma).withholdingCertificate.create({
      data,
      select: { id: true },
    });
  }

  async update(
    id: string,
    data: CertificateUpdateData
  ): Promise<{ id: string }> {
    const updated = await prisma.withholdingCertificate.updateMany({
      where: { id, deletedAt: null },
      data,
    });
    if (updated.count === 0) {
      throw new ConflictError("That certificate was removed while you were editing it.");
    }
    return { id };
  }

  async link(
    certificateId: string,
    allocationIds: string[],
    tx?: DbTx
  ): Promise<number> {
    if (allocationIds.length === 0) return 0;
    const db = tx ?? prisma;
    const cert = await db.withholdingCertificate.findFirst({
      where: { id: certificateId, deletedAt: null },
      select: { kind: true, customerId: true },
    });
    if (!cert) {
      throw new ConflictError("That certificate no longer exists.");
    }
    const amountField = AMOUNT_FIELD[cert.kind];
    const linkField = LINK_FIELD[cert.kind];

    // Every condition is re-checked in the same statement that writes the
    // link, so two people filing the same quarter cannot both claim one
    // withholding. A blind updateMany on the ids would let them.
    const moved = await db.crAllocation.updateMany({
      where: {
        id: { in: allocationIds },
        [linkField]: null,
        [amountField]: { gt: 0 },
        cr: {
          deletedAt: null,
          voidedAt: null,
          customerId: cert.customerId,
        },
      },
      data: { [linkField]: certificateId },
    });
    return moved.count;
  }

  async unlink(
    certificateId: string,
    allocationIds: string[],
    tx?: DbTx
  ): Promise<number> {
    if (allocationIds.length === 0) return 0;
    const db = tx ?? prisma;
    const cert = await db.withholdingCertificate.findFirst({
      where: { id: certificateId },
      select: { kind: true },
    });
    if (!cert) return 0;
    const linkField = LINK_FIELD[cert.kind];
    const released = await db.crAllocation.updateMany({
      where: { id: { in: allocationIds }, [linkField]: certificateId },
      data: { [linkField]: null },
    });
    return released.count;
  }

  async voidCertificate(id: string, tx?: DbTx): Promise<void> {
    const db = tx ?? prisma;
    const cert = await db.withholdingCertificate.findFirst({
      where: { id, deletedAt: null },
      select: { kind: true },
    });
    if (!cert) return;
    const linkField = LINK_FIELD[cert.kind];
    // The withholdings go back on the chase list. Leaving them pointed at a
    // deleted certificate would hide them from both views at once — the money
    // would look claimed and appear nowhere.
    await db.crAllocation.updateMany({
      where: { [linkField]: id },
      data: { [linkField]: null },
    });
    await db.withholdingCertificate.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async findByCertificateNo(
    certificateNo: string
  ): Promise<{ id: string } | null> {
    return prisma.withholdingCertificate.findFirst({
      where: { certificateNo, deletedAt: null },
      select: { id: true },
    });
  }

  async attachFile(id: string, file: CertificateFile): Promise<void> {
    await prisma.withholdingCertificate.update({
      where: { id },
      data: {
        fileName: file.fileName,
        mimeType: file.mimeType,
        fileSize: file.fileData.byteLength,
        fileData: Buffer.from(file.fileData),
      },
    });
  }

  async readFile(id: string): Promise<CertificateFile | null> {
    const row = await prisma.withholdingCertificate.findFirst({
      where: { id, deletedAt: null },
      select: { fileName: true, mimeType: true, fileData: true },
    });
    if (!row?.fileData || !row.fileName) return null;
    return {
      fileName: row.fileName,
      mimeType: row.mimeType ?? "application/octet-stream",
      fileData: row.fileData,
    };
  }

  async listWithholdingCustomers(): Promise<{ id: string; name: string }[]> {
    return prisma.customer.findMany({
      where: {
        deletedAt: null,
        OR: [{ isWithholdingAgent: true }, { withholdsVat: true }],
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  }
}
