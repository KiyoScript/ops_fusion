import { assertCan } from "@/lib/ability";
import type { Actor } from "@/lib/authz";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import type { WithholdingKind } from "@/generated/prisma/enums";
import type { IActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import { PrismaActivityLogRepository } from "@/modules/shared/repositories/activity-log-repository";
import type {
  CertificateFile,
  CertificateRecord,
  IWithholdingRepository,
} from "../repositories/withholding-repository";
import { PrismaWithholdingRepository } from "../repositories/withholding-repository";
import {
  WITHHOLDING_KIND_LABEL,
  type CertificateDto,
  type CertificateFilters,
  type CreateCertificateInput,
  type LinkAllocationsInput,
  type OutstandingWithholdingDto,
  type UnlinkAllocationsInput,
  type UpdateCertificateInput,
  type VoidCertificateInput,
  type WithholdingRegisterDto,
} from "../schemas/withholding";
import { toAmount, toCentavos } from "./money";

// ══════════════════════════════════════════════════════════════════════════
// WITHHOLDING CERTIFICATE REGISTER
//
// Two figures for the same money, from two sources, that must agree:
//
//   what we RECORDED  — CrAllocation.ewtWithheld / .vatWithheld, entered at
//                       the counter the moment the customer short-paid
//   what we can PROVE — the certificate they hand over weeks later
//
// The register's whole job is the gap between them. Uncertified withholding is
// a tax credit we are on course to lose; a certificate whose total disagrees
// with the payments under it is either their error or ours, and the system
// never guesses which — it flags it and leaves the reconciliation to a person.
// ══════════════════════════════════════════════════════════════════════════

const MAX_FILE_BYTES = 5 * 1024 * 1024;

const ACCEPTED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];

/** "2026-08-20" → a Date at local midnight. Null passes through. */
function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) {
    throw new ValidationError("That is not a valid date.");
  }
  return d;
}

/** End of the given day, so a range's last day is included. */
function endOfDay(value: string | null | undefined): Date | null {
  const d = parseDate(value);
  if (!d) return null;
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Money as typed — "1,234.50" — to a decimal string Prisma accepts. */
function normalizeMoney(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  return toAmount(toCentavos(value));
}

function daysSince(d: Date): number {
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

const emptyKindTotals = () => ({ withheld: 0, certified: 0, uncertified: 0 });

export class WithholdingService {
  constructor(
    private readonly repo: IWithholdingRepository,
    private readonly activity: IActivityLogRepository
  ) {}

  // ——— reads ————————————————————————————————————————————————————————
  //
  // R9: every read is gated too. A withholding certificate names a customer,
  // what they bought and what they paid — the same commercial detail the
  // receipt itself carries, and no less confidential for being a tax form.

  async getRegister(
    actor: Actor,
    filters: CertificateFilters
  ): Promise<WithholdingRegisterDto> {
    assertCan(actor, "read", "WithholdingCertificate");

    const from = parseDate(filters.from);
    const to = endOfDay(filters.to);

    const [certificates, withheld, customers] = await Promise.all([
      this.repo.list({
        customerId: filters.customerId,
        kind: filters.kind,
        from,
        to,
        search: filters.search,
      }),
      // Every withheld peso in range, certified or not. Totals are derived
      // from this ONE list so `certified + uncertified === withheld` is an
      // identity rather than a coincidence between two queries.
      this.repo.listWithheld({
        customerId: filters.customerId,
        kind: filters.kind,
        from,
        to,
      }),
      this.repo.listWithholdingCustomers(),
    ]);

    const byKind: Record<WithholdingKind, ReturnType<typeof emptyKindTotals>> = {
      EWT_2307: emptyKindTotals(),
      VAT_2306: emptyKindTotals(),
    };

    const outstanding: OutstandingWithholdingDto[] = [];
    for (const a of withheld) {
      const kind = a.kind;
      const cents = toCentavos(a.withheld);
      byKind[kind].withheld += cents;
      if (a.certificateId) {
        byKind[kind].certified += cents;
      } else {
        byKind[kind].uncertified += cents;
        outstanding.push({
          allocationId: a.allocationId,
          customerId: a.customerId,
          customerName: a.customerName,
          kind,
          crNumber: a.crNumber,
          collectedAt: a.collectedAt,
          documentNo: a.documentNo,
          joNumber: a.joNumber,
          withheld: a.withheld,
          vatableSales: a.vatableSales,
          daysWaiting: daysSince(a.collectedAt),
        });
      }
    }

    // Oldest first: a certificate not chased within the year it was withheld
    // is the one that stops being claimable.
    outstanding.sort((x, y) => y.daysWaiting - x.daysWaiting);

    const dtos = certificates.map(toDto);
    const filtered =
      filters.status === "ALL"
        ? dtos
        : dtos.filter((c) => {
            if (filters.status === "RECEIVED") return c.receivedAt !== null;
            if (filters.status === "AWAITED") return c.receivedAt === null;
            return toCentavos(c.variance) !== 0;
          });

    const totals = {
      withheld: 0,
      certified: 0,
      uncertified: 0,
    };
    for (const k of Object.keys(byKind) as WithholdingKind[]) {
      totals.withheld += byKind[k].withheld;
      totals.certified += byKind[k].certified;
      totals.uncertified += byKind[k].uncertified;
    }

    return {
      certificates: filtered,
      outstanding,
      totals: {
        withheld: toAmount(totals.withheld),
        certified: toAmount(totals.certified),
        uncertified: toAmount(totals.uncertified),
        byKind: {
          EWT_2307: {
            withheld: toAmount(byKind.EWT_2307.withheld),
            certified: toAmount(byKind.EWT_2307.certified),
            uncertified: toAmount(byKind.EWT_2307.uncertified),
          },
          VAT_2306: {
            withheld: toAmount(byKind.VAT_2306.withheld),
            certified: toAmount(byKind.VAT_2306.certified),
            uncertified: toAmount(byKind.VAT_2306.uncertified),
          },
        },
      },
      customers,
    };
  }

  async get(actor: Actor, id: string): Promise<CertificateDto> {
    assertCan(actor, "read", "WithholdingCertificate");
    const found = await this.repo.findById(id);
    if (!found) throw new NotFoundError("Certificate not found.");
    return toDto(found);
  }

  /**
   * What this certificate could still cover: the customer's own withholdings
   * of the matching kind that nothing else has claimed.
   *
   * Scoped to the customer and the kind on purpose — a 2306 can never cover
   * income tax, and no form covers another company's tax. Offering the choice
   * at all would be offering a way to file a wrong return.
   */
  async listLinkable(
    actor: Actor,
    certificateId: string
  ): Promise<OutstandingWithholdingDto[]> {
    assertCan(actor, "read", "WithholdingCertificate");
    const cert = await this.repo.findById(certificateId);
    if (!cert) throw new NotFoundError("Certificate not found.");

    const rows = await this.repo.listWithheld({
      customerId: cert.customerId,
      kind: cert.kind,
      uncertifiedOnly: true,
    });
    return rows.map((a) => ({
      allocationId: a.allocationId,
      customerId: a.customerId,
      customerName: a.customerName,
      kind: cert.kind,
      crNumber: a.crNumber,
      collectedAt: a.collectedAt,
      documentNo: a.documentNo,
      joNumber: a.joNumber,
      withheld: a.withheld,
      vatableSales: a.vatableSales,
      daysWaiting: daysSince(a.collectedAt),
    }));
  }

  // ——— writes ———————————————————————————————————————————————————————

  async create(
    actor: Actor,
    input: CreateCertificateInput
  ): Promise<{ id: string }> {
    assertCan(actor, "create", "WithholdingCertificate");

    const certificateNo = input.certificateNo?.trim() || null;
    if (certificateNo) {
      const clash = await this.repo.findByCertificateNo(certificateNo);
      if (clash) {
        throw new ConflictError(
          `Certificate ${certificateNo} is already in the register.`
        );
      }
    }

    const amount = normalizeMoney(input.amount);
    if (!amount || toCentavos(amount) <= 0) {
      throw new ValidationError("A certificate for zero tax is not a certificate.");
    }

    const created = await this.repo.create({
      customerId: input.customerId,
      kind: input.kind,
      certificateNo,
      periodFrom: parseDate(input.periodFrom),
      periodTo: parseDate(input.periodTo),
      amount,
      taxBase: normalizeMoney(input.taxBase),
      ratePct:
        input.ratePct === null || input.ratePct === undefined
          ? null
          : input.ratePct.toFixed(2),
      receivedAt: parseDate(input.receivedAt),
      notes: input.notes?.trim() || null,
      createdById: actor.id,
    });

    let linked = 0;
    if (input.allocationIds.length > 0) {
      linked = await this.repo.link(created.id, input.allocationIds);
      if (linked < input.allocationIds.length) {
        // Not fatal — the certificate is recorded and the rest stay on the
        // chase list. Silence would be worse: the user would believe the
        // quarter was fully covered.
        await this.activity.log({
          userId: actor.id,
          entityType: "WithholdingCertificate",
          entityId: created.id,
          action: "certificate-link-partial",
          payload: {
            requested: input.allocationIds.length,
            linked,
            reason: "already claimed, voided, or a different customer",
          },
        });
      }
    }

    await this.activity.log({
      userId: actor.id,
      entityType: "WithholdingCertificate",
      entityId: created.id,
      action: "record-certificate",
      payload: {
        kind: WITHHOLDING_KIND_LABEL[input.kind],
        certificateNo: certificateNo ?? "(awaited)",
        amount,
        period:
          input.periodFrom && input.periodTo
            ? `${input.periodFrom} to ${input.periodTo}`
            : "unspecified",
        collectionsCovered: linked,
      },
    });

    return created;
  }

  async update(
    actor: Actor,
    input: UpdateCertificateInput
  ): Promise<{ id: string }> {
    assertCan(actor, "update", "WithholdingCertificate");

    const existing = await this.repo.findById(input.id);
    if (!existing) throw new NotFoundError("Certificate not found.");

    const certificateNo = input.certificateNo?.trim() || null;
    if (certificateNo && certificateNo !== existing.certificateNo) {
      const clash = await this.repo.findByCertificateNo(certificateNo);
      if (clash && clash.id !== input.id) {
        throw new ConflictError(
          `Certificate ${certificateNo} is already in the register.`
        );
      }
    }

    const amount = normalizeMoney(input.amount);
    if (!amount || toCentavos(amount) <= 0) {
      throw new ValidationError("A certificate for zero tax is not a certificate.");
    }

    await this.repo.update(input.id, {
      certificateNo,
      periodFrom: parseDate(input.periodFrom),
      periodTo: parseDate(input.periodTo),
      amount,
      taxBase: normalizeMoney(input.taxBase),
      ratePct:
        input.ratePct === null || input.ratePct === undefined
          ? null
          : input.ratePct.toFixed(2),
      receivedAt: parseDate(input.receivedAt),
      notes: input.notes?.trim() || null,
    });

    await this.activity.log({
      userId: actor.id,
      entityType: "WithholdingCertificate",
      entityId: input.id,
      action: "amend-certificate",
      payload: {
        certificateNo: certificateNo ?? "(awaited)",
        amountFrom: existing.amount,
        amountTo: amount,
        received: input.receivedAt ?? "(awaited)",
      },
    });

    return { id: input.id };
  }

  async link(
    actor: Actor,
    input: LinkAllocationsInput
  ): Promise<{ linked: number }> {
    assertCan(actor, "update", "WithholdingCertificate");

    const linked = await this.repo.link(
      input.certificateId,
      input.allocationIds
    );
    if (linked === 0) {
      throw new ConflictError(
        "None of those withholdings could be attached — they belong to another customer, another tax, or a certificate that already claims them."
      );
    }

    await this.activity.log({
      userId: actor.id,
      entityType: "WithholdingCertificate",
      entityId: input.certificateId,
      action: "link-withholding",
      payload: { requested: input.allocationIds.length, linked },
    });

    return { linked };
  }

  async unlink(
    actor: Actor,
    input: UnlinkAllocationsInput
  ): Promise<{ unlinked: number }> {
    assertCan(actor, "update", "WithholdingCertificate");

    const unlinked = await this.repo.unlink(
      input.certificateId,
      input.allocationIds
    );

    await this.activity.log({
      userId: actor.id,
      entityType: "WithholdingCertificate",
      entityId: input.certificateId,
      action: "unlink-withholding",
      payload: { requested: input.allocationIds.length, unlinked },
    });

    return { unlinked };
  }

  /**
   * R11: void, never delete. The certificate stays readable — it was a tax
   * record, and one that may already have been counted on a filed return.
   */
  async voidCertificate(
    actor: Actor,
    input: VoidCertificateInput
  ): Promise<{ id: string }> {
    assertCan(actor, "void", "WithholdingCertificate");

    const existing = await this.repo.findById(input.id);
    if (!existing) throw new NotFoundError("Certificate not found.");

    await this.repo.voidCertificate(input.id);

    await this.activity.log({
      userId: actor.id,
      entityType: "WithholdingCertificate",
      entityId: input.id,
      action: "void-certificate",
      payload: {
        certificateNo: existing.certificateNo ?? "(awaited)",
        kind: WITHHOLDING_KIND_LABEL[existing.kind],
        amount: existing.amount,
        // Naming what went back on the chase list, because that is the part
        // nobody sees happen.
        releasedWithholdings: existing.allocations.length,
        reason: input.reason,
      },
    });

    return { id: input.id };
  }

  async attachFile(
    actor: Actor,
    id: string,
    file: CertificateFile
  ): Promise<{ id: string }> {
    assertCan(actor, "update", "WithholdingCertificate");

    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundError("Certificate not found.");

    if (!ACCEPTED_TYPES.includes(file.mimeType)) {
      throw new ValidationError(
        "Attach the scanned form as a PDF or an image."
      );
    }
    if (file.fileData.byteLength > MAX_FILE_BYTES) {
      throw new ValidationError("That file is over 5 MB — scan it smaller.");
    }

    await this.repo.attachFile(id, file);

    await this.activity.log({
      userId: actor.id,
      entityType: "WithholdingCertificate",
      entityId: id,
      action: "attach-certificate-scan",
      payload: { fileName: file.fileName, bytes: file.fileData.byteLength },
    });

    return { id };
  }

  async readFile(actor: Actor, id: string): Promise<CertificateFile> {
    assertCan(actor, "read", "WithholdingCertificate");
    const file = await this.repo.readFile(id);
    if (!file) throw new NotFoundError("No scan on file for that certificate.");
    return file;
  }
}

function toDto(c: CertificateRecord): CertificateDto {
  const linkedCents = c.allocations.reduce(
    (t, a) => t + toCentavos(a.withheld),
    0
  );
  return {
    id: c.id,
    customerId: c.customerId,
    customerName: c.customerName,
    kind: c.kind,
    certificateNo: c.certificateNo,
    periodFrom: c.periodFrom,
    periodTo: c.periodTo,
    amount: c.amount,
    taxBase: c.taxBase,
    ratePct: c.ratePct,
    receivedAt: c.receivedAt,
    notes: c.notes,
    hasFile: c.fileName !== null,
    fileName: c.fileName,
    linkedTotal: toAmount(linkedCents),
    variance: toAmount(toCentavos(c.amount) - linkedCents),
    allocations: c.allocations.map((a) => ({
      allocationId: a.allocationId,
      crNumber: a.crNumber,
      collectedAt: a.collectedAt,
      documentNo: a.documentNo,
      joNumber: a.joNumber,
      withheld: a.withheld,
      vatableSales: a.vatableSales,
    })),
    createdAt: c.createdAt,
    createdByName: c.createdByName,
  };
}

let instance: WithholdingService | undefined;

export function getWithholdingService(): WithholdingService {
  if (!instance) {
    instance = new WithholdingService(
      new PrismaWithholdingRepository(),
      new PrismaActivityLogRepository()
    );
  }
  return instance;
}
