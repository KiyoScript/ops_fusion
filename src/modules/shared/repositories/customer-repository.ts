import { prisma } from "@/lib/prisma";
import type { DbTx } from "./types";

export type CustomerOption = { id: string; name: string };

/** Search result for pickers — carries contact/company/email so a returning
 *  customer's details can auto-fill the quote forms on pick. */
export type CustomerSuggestion = CustomerOption & {
  contactNumber: string | null;
  company: string | null;
  email: string | null;
  department: string | null;
  position: string | null;
};

/** Billing identity plus credit standing — what a receipt is made out to. */
export type CustomerBillingRecord = {
  id: string;
  name: string;
  address: string | null;
  tin: string | null;
  vatRegistered: boolean;
  creditTermDays: number | null;
  creditLimit: string | null;
  /** True → withholds creditable INCOME tax and issues a BIR 2307. */
  isWithholdingAgent: boolean;
  /** Rate on the VAT-EXCLUSIVE amount, e.g. "2.00". Null = no default set. */
  ewtRatePct: string | null;
  /** True → withholds 5% creditable VAT and issues a BIR 2306. Government. */
  withholdsVat: boolean;
  /** Usually "5.00". Null = flagged but nothing pre-filled. */
  vatWithholdingRatePct: string | null;
};

export interface ICustomerRepository {
  search(query: string, take?: number): Promise<CustomerSuggestion[]>;
  findById(id: string): Promise<CustomerBillingRecord | null>;
  findOrCreateByName(
    name: string,
    createdById: string,
    tx?: DbTx
  ): Promise<CustomerOption>;
  /** Fill-if-blank enrichment: writes contact/email onto the customer only
   *  where the master record is still empty — never overwrites. */
  fillContactDetails(
    id: string,
    details: { contactNumber?: string; email?: string },
    tx?: DbTx
  ): Promise<void>;
  /** Batch variant for imports: returns a map of lowercased name → id. */
  findOrCreateManyByName(
    names: string[],
    createdById: string
  ): Promise<{ idByName: Map<string, string>; created: number }>;
  /** Credit terms & ceiling. Null on either clears it — see customer.prisma. */
  setCredit(
    id: string,
    data: { creditTermDays: number | null; creditLimit: string | null }
  ): Promise<{ id: string; name: string }>;
  /**
   * Withholding standing — BOTH taxes. Admin-gated like setCredit above (R8):
   * the rates a customer withholds at are reference data, not a counter
   * decision. Clearing either flag clears its rate too, so a customer who
   * stops withholding cannot leave a stale rate behind to be silently
   * reapplied the moment someone re-ticks the box.
   */
  setWithholding(
    id: string,
    data: {
      isWithholdingAgent: boolean;
      ewtRatePct: string | null;
      withholdsVat: boolean;
      vatWithholdingRatePct: string | null;
    }
  ): Promise<{ id: string; name: string }>;
}

export class PrismaCustomerRepository implements ICustomerRepository {
  async search(query: string, take = 10): Promise<CustomerSuggestion[]> {
    // Match the person's name OR their company / department / position, so
    // typing a company name surfaces its contact persons to pick from.
    return prisma.customer.findMany({
      where: {
        deletedAt: null,
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { company: { contains: query, mode: "insensitive" } },
          { department: { contains: query, mode: "insensitive" } },
          { position: { contains: query, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        name: true,
        contactNumber: true,
        company: true,
        email: true,
        department: true,
        position: true,
      },
      // Group a company's contacts together, then by contact name.
      orderBy: [{ company: "asc" }, { name: "asc" }],
      take,
    });
  }

  async findById(id: string): Promise<CustomerBillingRecord | null> {
    const c = await prisma.customer.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true, name: true, address: true, tin: true,
        vatRegistered: true, creditTermDays: true, creditLimit: true,
        isWithholdingAgent: true, ewtRatePct: true,
        withholdsVat: true, vatWithholdingRatePct: true,
      },
    });
    return (
      c && {
        ...c,
        creditLimit: c.creditLimit?.toString() ?? null,
        ewtRatePct: c.ewtRatePct?.toString() ?? null,
        vatWithholdingRatePct: c.vatWithholdingRatePct?.toString() ?? null,
      }
    );
  }

  async fillContactDetails(
    id: string,
    details: { contactNumber?: string; email?: string },
    tx?: DbTx
  ): Promise<void> {
    const db = tx ?? prisma;
    const current = await db.customer.findUnique({
      where: { id },
      select: { contactNumber: true, email: true },
    });
    if (!current) return;
    const data: { contactNumber?: string; email?: string } = {};
    if (details.contactNumber && !current.contactNumber) {
      data.contactNumber = details.contactNumber;
    }
    if (details.email && !current.email) data.email = details.email;
    if (Object.keys(data).length > 0) {
      await db.customer.update({ where: { id }, data });
    }
  }

  async findOrCreateByName(
    name: string,
    createdById: string,
    tx?: DbTx
  ): Promise<CustomerOption> {
    const db = tx ?? prisma;
    const trimmed = name.trim();
    const existing = await db.customer.findFirst({
      where: { deletedAt: null, name: { equals: trimmed, mode: "insensitive" } },
      select: { id: true, name: true },
    });
    if (existing) return existing;
    return db.customer.create({
      data: { name: trimmed, createdById },
      select: { id: true, name: true },
    });
  }

  async findOrCreateManyByName(
    names: string[],
    createdById: string
  ): Promise<{ idByName: Map<string, string>; created: number }> {
    const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
    const idByName = new Map<string, string>();
    if (unique.length === 0) return { idByName, created: 0 };

    const existing = await prisma.customer.findMany({
      where: {
        deletedAt: null,
        OR: unique.map((n) => ({ name: { equals: n, mode: "insensitive" as const } })),
      },
      select: { id: true, name: true },
    });
    for (const c of existing) idByName.set(c.name.toLowerCase(), c.id);

    const missing = unique.filter((n) => !idByName.has(n.toLowerCase()));
    if (missing.length > 0) {
      const created = await prisma.customer.createManyAndReturn({
        data: missing.map((name) => ({ name, createdById })),
        select: { id: true, name: true },
      });
      for (const c of created) idByName.set(c.name.toLowerCase(), c.id);
    }
    return { idByName, created: missing.length };
  }

  async setCredit(
    id: string,
    data: { creditTermDays: number | null; creditLimit: string | null }
  ): Promise<{ id: string; name: string }> {
    return prisma.customer.update({
      where: { id },
      data: {
        creditTermDays: data.creditTermDays,
        creditLimit: data.creditLimit,
      },
      select: { id: true, name: true },
    });
  }

  async setWithholding(
    id: string,
    data: {
      isWithholdingAgent: boolean;
      ewtRatePct: string | null;
      withholdsVat: boolean;
      vatWithholdingRatePct: string | null;
    }
  ): Promise<{ id: string; name: string }> {
    return prisma.customer.update({
      where: { id },
      data: {
        // Clearing a flag clears its rate with it. A dormant rate left on a
        // customer who no longer withholds would start suggesting tax again
        // the moment someone re-ticked the box.
        isWithholdingAgent: data.isWithholdingAgent,
        ewtRatePct: data.isWithholdingAgent ? data.ewtRatePct : null,
        withholdsVat: data.withholdsVat,
        vatWithholdingRatePct: data.withholdsVat
          ? data.vatWithholdingRatePct
          : null,
      },
      select: { id: true, name: true },
    });
  }
}
