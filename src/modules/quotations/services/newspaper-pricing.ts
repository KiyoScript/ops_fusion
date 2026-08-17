// Newspaper pricing engine — EXACT price-table lookup first, else the admin
// FORMULA. Prices are NET (VAT applied by the quotation's tax type). The formula
// is decoded 1:1 from the "Formula" sheet of Newspaper Computation 2026.xlsx.

import { prisma } from "@/lib/prisma";
import type { NewspaperRowKind } from "@/generated/prisma/enums";
import { ValidationError } from "@/lib/errors";
import {
  round2,
  computeFormula,
  DEFAULT_FORMULA_PARAMS,
} from "./newspaper-formula";
import type { FormulaParams, FormulaBreakdown } from "./newspaper-formula";

// Re-export the pure formula so existing importers keep working; the sandbox
// calculator imports the same source directly from "./newspaper-formula".
export { round2, computeFormula, DEFAULT_FORMULA_PARAMS };
export type { FormulaParams, FormulaBreakdown, FormulaInput } from "./newspaper-formula";

export type NewspaperSpec = {
  publicationId: string;
  /** FULL_ISSUE (whole run) or LOOSE_PAGES (loose sub-table). */
  kind: NewspaperRowKind;
  /** color + BW (drives the paper cost in the formula). */
  totalPages: number;
  colorPages: number;
  bwPages: number;
  copies: number;
};

export type NewspaperPrice = {
  source: "TABLE" | "FORMULA";
  /** Net line total. */
  total: number;
  perCopy: number;
  priceCode: string | null;
  /** Present when source === "FORMULA". */
  breakdown?: FormulaBreakdown;
};

/**
 * Resolve formula params: per-publication override → admin-saved global row →
 * `DEFAULT_FORMULA_PARAMS` (decoded from "Newspaper Computation 2026.xlsx").
 * The global constants are admin-editable and persisted; they only drive the
 * FORMULA FALLBACK estimate (sizes not in a price table), which itself needs
 * approval before it becomes a live price.
 */
export async function resolveFormulaParams(
  publicationId: string
): Promise<FormulaParams> {
  const [pub, g] = await Promise.all([
    prisma.newspaperPublication.findUnique({ where: { id: publicationId } }),
    prisma.newspaperFormulaParams.findFirst(),
  ]);
  const pick = (a: unknown, b: unknown, d: number): number =>
    a != null ? Number(a) : b != null ? Number(b) : d;
  return {
    pricePerPlate: pick(pub?.pricePerPlate, g?.pricePerPlate, DEFAULT_FORMULA_PARAMS.pricePerPlate),
    laborPerPlate: pick(pub?.laborPerPlate, g?.laborPerPlate, DEFAULT_FORMULA_PARAMS.laborPerPlate),
    paperRate: pick(pub?.paperRate, g?.paperRate, DEFAULT_FORMULA_PARAMS.paperRate),
    runningRate: pick(pub?.runningRate, g?.runningRate, DEFAULT_FORMULA_PARAMS.runningRate),
    marginPct: pick(pub?.marginPct, g?.marginPct, DEFAULT_FORMULA_PARAMS.marginPct),
  };
}

/** Save the admin-editable global formula constants (single row, upserted). */
export async function updateFormulaParams(data: FormulaParams): Promise<void> {
  const existing = await prisma.newspaperFormulaParams.findFirst();
  const values = {
    pricePerPlate: data.pricePerPlate.toFixed(2),
    laborPerPlate: data.laborPerPlate.toFixed(2),
    paperRate: data.paperRate.toFixed(4),
    runningRate: data.runningRate.toFixed(2),
    marginPct: data.marginPct.toFixed(4),
  };
  if (existing) {
    await prisma.newspaperFormulaParams.update({ where: { id: existing.id }, data: values });
  } else {
    await prisma.newspaperFormulaParams.create({ data: values });
  }
}

// ─── Maintenance (admin) ─────────────────────────────────────────────────────

export type NewspaperPublicationRowView = {
  id: string;
  name: string;
  fullRows: number;
  looseRows: number;
  override: FormulaParams | null; // per-publication override, else null
};
export type NewspaperRowView = {
  id: string;
  publication: string;
  kind: NewspaperRowKind;
  totalPages: number | null;
  colorPages: number;
  bwPages: number;
  copies: number;
  price: string;
  priceCode: string | null;
  source: string;
};
export type NewspaperPendingView = {
  id: string;
  publicationId: string;
  publication: string;
  kind: NewspaperRowKind;
  totalPages: number | null;
  colorPages: number;
  bwPages: number;
  copies: number;
  price: string; // proposed net price
  priceCode: string | null;
  currentPrice: string | null; // existing APPROVED price for the same spec, else null (⇒ new size)
  submittedAt: string;
};
export type NewspaperHistoryView = {
  id: string;
  action: string; // submit | approve | reject
  at: string; // ISO date-time
  by: string; // user name
  publication: string;
  kind: NewspaperRowKind | null;
  totalPages: number | null;
  colorPages: number | null;
  bwPages: number | null;
  copies: number | null;
  price: number | null;
  previousPrice: number | null; // approve of an existing size (a change), else null
};
export type NewspaperMaintenance = {
  params: FormulaParams; // admin-saved global formula constants
  publications: NewspaperPublicationRowView[];
  rows: NewspaperRowView[];
  pending: NewspaperPendingView[];
  history: NewspaperHistoryView[];
};

// Same (publication · kind · size · copies) key — LOOSE ignores totalPages.
function sameSpecKey(a: {
  publicationId: string;
  kind: NewspaperRowKind;
  totalPages: number | null;
  colorPages: number;
  bwPages: number;
  copies: number;
}): string {
  const tp = a.kind === "FULL_ISSUE" ? a.totalPages : null;
  return `${a.publicationId}|${a.kind}|${tp}|${a.colorPages}|${a.bwPages}|${a.copies}`;
}

/** Everything the pricing-maintenance page needs, serialized for the client. */
export async function getNewspaperMaintenance(): Promise<NewspaperMaintenance> {
  const [g, pubs, approved, pendingRows, history] = await Promise.all([
    prisma.newspaperFormulaParams.findFirst(),
    prisma.newspaperPublication.findMany({
      where: { deletedAt: null },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.newspaperPriceRow.findMany({
      where: { status: "APPROVED" },
      orderBy: [{ kind: "asc" }, { totalPages: "asc" }, { copies: "asc" }],
      include: { publication: { select: { name: true } } },
    }),
    prisma.newspaperPriceRow.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "desc" },
      include: { publication: { select: { name: true } } },
    }),
    getNewspaperHistory(),
  ]);
  const approvedByKey = new Map(approved.map((r) => [sameSpecKey(r), r]));
  return {
    params: {
      pricePerPlate: Number(g?.pricePerPlate ?? DEFAULT_FORMULA_PARAMS.pricePerPlate),
      laborPerPlate: Number(g?.laborPerPlate ?? DEFAULT_FORMULA_PARAMS.laborPerPlate),
      paperRate: Number(g?.paperRate ?? DEFAULT_FORMULA_PARAMS.paperRate),
      runningRate: Number(g?.runningRate ?? DEFAULT_FORMULA_PARAMS.runningRate),
      marginPct: Number(g?.marginPct ?? DEFAULT_FORMULA_PARAMS.marginPct),
    },
    publications: pubs.map((p) => ({
      id: p.id,
      name: p.name,
      fullRows: approved.filter((r) => r.publicationId === p.id && r.kind === "FULL_ISSUE").length,
      looseRows: approved.filter((r) => r.publicationId === p.id && r.kind === "LOOSE_PAGES").length,
      override: null, // per-publication override not surfaced in the UI
    })),
    rows: approved.map((r) => ({
      id: r.id,
      publication: r.publication.name,
      kind: r.kind,
      totalPages: r.totalPages,
      colorPages: r.colorPages,
      bwPages: r.bwPages,
      copies: r.copies,
      price: r.price.toFixed(2),
      priceCode: r.priceCode,
      source: r.source,
    })),
    pending: pendingRows.map((r) => {
      const current = approvedByKey.get(sameSpecKey(r));
      return {
        id: r.id,
        publicationId: r.publicationId,
        publication: r.publication.name,
        kind: r.kind,
        totalPages: r.totalPages,
        colorPages: r.colorPages,
        bwPages: r.bwPages,
        copies: r.copies,
        price: r.price.toFixed(2),
        priceCode: r.priceCode,
        currentPrice: current ? current.price.toFixed(2) : null,
        submittedAt: r.createdAt.toISOString(),
      };
    }),
    history,
  };
}

/** Full audit trail (submit / approve / reject) for the Approvals tab. */
export async function getNewspaperHistory(): Promise<NewspaperHistoryView[]> {
  const logs = await prisma.activityLog.findMany({
    where: {
      entityType: "NewspaperPriceRow",
      action: { in: ["submit", "approve", "reject"] },
    },
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const num = (v: unknown): number | null =>
    v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null;
  return logs.map((l) => {
    const p = (l.payload ?? {}) as Record<string, unknown>;
    return {
      id: l.id,
      action: l.action,
      at: l.createdAt.toISOString(),
      by: l.user?.name ?? "—",
      publication: typeof p.publication === "string" ? p.publication : "",
      kind:
        p.kind === "FULL_ISSUE" || p.kind === "LOOSE_PAGES"
          ? (p.kind as NewspaperRowKind)
          : null,
      totalPages: num(p.totalPages),
      colorPages: num(p.colorPages),
      bwPages: num(p.bwPages),
      copies: num(p.copies),
      price: num(p.price),
      previousPrice: num(p.previousPrice),
    };
  });
}

/** Delete one price row (admin). */
export async function deleteNewspaperRow(id: string): Promise<void> {
  await prisma.newspaperPriceRow.delete({ where: { id } });
}

export type NewspaperRowInput = {
  kind: NewspaperRowKind;
  colorPages: number;
  bwPages: number;
  copies: number;
  price: number;
  priceCode: string | null;
};

/** Add a manual price row (admin). Stored as CUSTOM so it survives a workbook
 *  re-import (which only replaces the imported TABLE rows). */
export async function createNewspaperRow(
  publicationId: string,
  input: NewspaperRowInput
): Promise<{ id: string }> {
  return prisma.newspaperPriceRow.create({
    data: {
      publicationId,
      kind: input.kind,
      totalPages: input.kind === "FULL_ISSUE" ? input.colorPages + input.bwPages : null,
      colorPages: input.colorPages,
      bwPages: input.bwPages,
      copies: input.copies,
      price: input.price.toFixed(2),
      priceCode: input.priceCode,
      source: "CUSTOM",
    },
    select: { id: true },
  });
}

/** Edit a price row (admin). Editing marks it CUSTOM so the change survives a
 *  workbook re-import. */
export async function updateNewspaperRow(
  id: string,
  input: NewspaperRowInput
): Promise<void> {
  await prisma.newspaperPriceRow.update({
    where: { id },
    data: {
      kind: input.kind,
      totalPages: input.kind === "FULL_ISSUE" ? input.colorPages + input.bwPages : null,
      colorPages: input.colorPages,
      bwPages: input.bwPages,
      copies: input.copies,
      price: input.price.toFixed(2),
      priceCode: input.priceCode,
      source: "CUSTOM",
    },
  });
}

// ─── Approval workflow ───────────────────────────────────────────────────────

export type NewspaperSubmissionInput = {
  publicationId: string;
  kind: NewspaperRowKind;
  totalPages: number; // # of pages (FULL only; stored null for LOOSE)
  colorPages: number;
  bwPages: number;
  copies: number;
  price: number; // proposed net price
  priceCode: string | null;
};

/**
 * Submit a proposed price from the calculator. Lands as a PENDING row (never
 * quoted) awaiting admin approval. Re-submitting the same spec updates the
 * pending proposal instead of stacking duplicates.
 */
export async function submitNewspaperPrice(
  input: NewspaperSubmissionInput,
  submittedById: string
): Promise<{ id: string }> {
  const totalPages = input.kind === "FULL_ISSUE" ? input.totalPages : null;
  const existingPending = await prisma.newspaperPriceRow.findFirst({
    where: {
      publicationId: input.publicationId,
      kind: input.kind,
      totalPages,
      colorPages: input.colorPages,
      bwPages: input.bwPages,
      copies: input.copies,
      status: "PENDING",
    },
    select: { id: true },
  });
  const shared = {
    price: input.price.toFixed(2),
    priceCode: input.priceCode,
    submittedById,
  };
  const row = existingPending
    ? await prisma.newspaperPriceRow.update({
        where: { id: existingPending.id },
        data: shared,
        select: { id: true },
      })
    : await prisma.newspaperPriceRow.create({
        data: {
          publicationId: input.publicationId,
          kind: input.kind,
          totalPages,
          colorPages: input.colorPages,
          bwPages: input.bwPages,
          copies: input.copies,
          source: "SUBMISSION",
          status: "PENDING",
          ...shared,
        },
        select: { id: true },
      });
  const pub = await prisma.newspaperPublication.findUnique({
    where: { id: input.publicationId },
    select: { name: true },
  });
  await prisma.activityLog.create({
    data: {
      userId: submittedById,
      entityType: "NewspaperPriceRow",
      entityId: row.id,
      action: "submit",
      payload: {
        publication: pub?.name ?? "",
        kind: input.kind,
        totalPages,
        colorPages: input.colorPages,
        bwPages: input.bwPages,
        copies: input.copies,
        price: input.price,
      },
    },
  });
  return row;
}

/**
 * Approve a pending submission. If an APPROVED row with the same spec exists,
 * its price is updated (a price change) and the pending row removed; otherwise
 * the pending row is promoted to APPROVED (a brand-new size).
 */
export async function approveNewspaperPrice(
  id: string,
  approvedById: string
): Promise<void> {
  const pending = await prisma.newspaperPriceRow.findUnique({ where: { id } });
  if (!pending || pending.status !== "PENDING") {
    throw new ValidationError("This submission is no longer pending.");
  }
  const existing = await prisma.newspaperPriceRow.findFirst({
    where: {
      publicationId: pending.publicationId,
      kind: pending.kind,
      totalPages: pending.kind === "FULL_ISSUE" ? pending.totalPages : null,
      colorPages: pending.colorPages,
      bwPages: pending.bwPages,
      copies: pending.copies,
      status: "APPROVED",
    },
    select: { id: true, price: true },
  });
  if (existing) {
    await prisma.$transaction([
      prisma.newspaperPriceRow.update({
        where: { id: existing.id },
        data: {
          price: pending.price,
          priceCode: pending.priceCode,
          source: "CUSTOM",
          approvedById,
          approvedAt: new Date(),
        },
      }),
      prisma.newspaperPriceRow.delete({ where: { id: pending.id } }),
    ]);
  } else {
    await prisma.newspaperPriceRow.update({
      where: { id: pending.id },
      data: {
        status: "APPROVED",
        source: "CUSTOM",
        approvedById,
        approvedAt: new Date(),
      },
    });
  }
  const pub = await prisma.newspaperPublication.findUnique({
    where: { id: pending.publicationId },
    select: { name: true },
  });
  await prisma.activityLog.create({
    data: {
      userId: approvedById,
      entityType: "NewspaperPriceRow",
      entityId: existing?.id ?? pending.id,
      action: "approve",
      payload: {
        publication: pub?.name ?? "",
        kind: pending.kind,
        totalPages: pending.totalPages,
        colorPages: pending.colorPages,
        bwPages: pending.bwPages,
        copies: pending.copies,
        price: Number(pending.price),
        previousPrice: existing ? Number(existing.price) : null,
      },
    },
  });
}

/** Reject (discard) a pending submission. */
export async function rejectNewspaperPrice(
  id: string,
  actorId: string
): Promise<void> {
  const pending = await prisma.newspaperPriceRow.findUnique({
    where: { id },
    include: { publication: { select: { name: true } } },
  });
  if (!pending || pending.status !== "PENDING") {
    throw new ValidationError("This submission is no longer pending.");
  }
  await prisma.newspaperPriceRow.delete({ where: { id } });
  await prisma.activityLog.create({
    data: {
      userId: actorId,
      entityType: "NewspaperPriceRow",
      entityId: id,
      action: "reject",
      payload: {
        publication: pending.publication.name,
        kind: pending.kind,
        totalPages: pending.totalPages,
        colorPages: pending.colorPages,
        bwPages: pending.bwPages,
        copies: pending.copies,
        price: Number(pending.price),
      },
    },
  });
}

/** Add (or restore) a newspaper customer (publication). */
export async function createNewspaperPublication(
  name: string,
  actorId: string
): Promise<{ id: string }> {
  const trimmed = name.trim();
  if (!trimmed) throw new ValidationError("Enter a publication name.");
  const existing = await prisma.newspaperPublication.findFirst({
    where: { name: { equals: trimmed, mode: "insensitive" } },
    select: { id: true, deletedAt: true },
  });
  if (existing && existing.deletedAt == null) {
    throw new ValidationError(`"${trimmed}" already exists.`);
  }
  const max = await prisma.newspaperPublication.aggregate({
    _max: { sortOrder: true },
  });
  const pub = existing
    ? await prisma.newspaperPublication.update({
        where: { id: existing.id },
        data: { deletedAt: null, isActive: true, name: trimmed },
        select: { id: true },
      })
    : await prisma.newspaperPublication.create({
        data: { name: trimmed, sortOrder: (max._max.sortOrder ?? 0) + 1 },
        select: { id: true },
      });
  await prisma.activityLog.create({
    data: {
      userId: actorId,
      entityType: "NewspaperPublication",
      entityId: pub.id,
      action: existing ? "restore" : "create",
      payload: { name: trimmed },
    },
  });
  return pub;
}

/**
 * "Add to Template": persist the current (formula-computed) price as a reusable
 * TABLE row so the same spec becomes a table hit next time. Recomputes the price
 * server-side — never trusts a client-supplied amount. No-op (returns the
 * existing hit) if the spec already matches a row. Auth is the caller's job.
 */
export async function saveTemplateRow(
  spec: NewspaperSpec,
  createdById: string
): Promise<{ id: string; price: number; created: boolean }> {
  const priced = await priceNewspaper(spec);
  if (priced.source === "TABLE") {
    // Already priced by a row — nothing to add.
    const existing = await prisma.newspaperPriceRow.findFirst({
      where: {
        publicationId: spec.publicationId,
        kind: spec.kind,
        totalPages: spec.kind === "FULL_ISSUE" ? spec.totalPages : null,
        colorPages: spec.colorPages,
        bwPages: spec.bwPages,
        copies: spec.copies,
        status: "APPROVED",
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    return { id: existing?.id ?? "", price: priced.total, created: false };
  }
  const row = await prisma.newspaperPriceRow.create({
    data: {
      publicationId: spec.publicationId,
      kind: spec.kind,
      totalPages: spec.kind === "FULL_ISSUE" ? spec.totalPages : null,
      colorPages: spec.colorPages,
      bwPages: spec.bwPages,
      copies: spec.copies,
      price: priced.total.toFixed(2),
      source: "TEMPLATE",
      createdById,
    },
    select: { id: true },
  });
  return { id: row.id, price: priced.total, created: true };
}

/** Table-first → formula fallback. The one entry point for pricing a newspaper. */
export async function priceNewspaper(spec: NewspaperSpec): Promise<NewspaperPrice> {
  const row = await prisma.newspaperPriceRow.findFirst({
    where: {
      publicationId: spec.publicationId,
      kind: spec.kind,
      totalPages: spec.kind === "FULL_ISSUE" ? spec.totalPages : null,
      colorPages: spec.colorPages,
      bwPages: spec.bwPages,
      copies: spec.copies,
      status: "APPROVED", // pending submissions never price a quote
    },
    // A TEMPLATE row saved later wins over the original imported TABLE row.
    orderBy: { createdAt: "desc" },
  });
  if (row) {
    const total = round2(Number(row.price));
    return {
      source: "TABLE",
      total,
      perCopy: spec.copies > 0 ? round2(total / spec.copies) : 0,
      priceCode: row.priceCode,
    };
  }
  const params = await resolveFormulaParams(spec.publicationId);
  const f = computeFormula(spec, params);
  return {
    source: "FORMULA",
    total: f.total,
    perCopy: f.perCopy,
    priceCode: null,
    breakdown: f.breakdown,
  };
}

// ─── Quote-form picker ───────────────────────────────────────────────────────

export type NewspaperListRow = {
  id: string;
  kind: NewspaperRowKind;
  totalPages: number | null;
  colorPages: number;
  bwPages: number;
  copies: number;
  price: number; // net line total
  perCopy: number;
  priceCode: string | null;
};

/** Approved price rows for a publication + kind — the quotable price list. */
export async function listNewspaperRows(
  publicationId: string,
  kind: NewspaperRowKind
): Promise<NewspaperListRow[]> {
  const rows = await prisma.newspaperPriceRow.findMany({
    where: { publicationId, kind, status: "APPROVED" },
    orderBy: [{ totalPages: "asc" }, { colorPages: "asc" }, { copies: "asc" }],
  });
  return rows.map((r) => {
    const price = Number(r.price);
    return {
      id: r.id,
      kind: r.kind,
      totalPages: r.totalPages,
      colorPages: r.colorPages,
      bwPages: r.bwPages,
      copies: r.copies,
      price,
      perCopy: r.copies > 0 ? round2(price / r.copies) : 0,
      priceCode: r.priceCode,
    };
  });
}
