import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import { JobOrderStatus, QuotationStatus, QuotationType, TaxType } from "../src/generated/prisma/enums";
import {
  QUOTE_YYMM,
  demoCustomers,
  demoJos,
  demoQuotes,
} from "./demo-data";

// ============================================================
// DEV SEED — a small, realistic working set: 5 customers, 5 quotations,
// 5 job orders. Uses live document-number formats so rows look like real data
// (definitions in prisma/demo-data.ts). Non-destructive & idempotent: every
// row is create-if-missing (keyed by its unique number / name), so re-running
// never duplicates and never clobbers real data.
// Remove it again with:  npm run db:unseed-demo
// Run:  npx tsx prisma/seed-demo.ts   (or:  npm run db:seed-demo)
// ============================================================

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const BRANCH_CODE = "ORM"; // matches quotation-service + demo-data numbers
const round2 = (n: number) => Math.round(n * 100) / 100;
const days = (n: number) => new Date(Date.now() + n * 86_400_000);

async function main() {
  const admin = await prisma.user.findUniqueOrThrow({
    where: { email: "admin@ops.local" },
  });

  // Product-name → id map (products are seeded by prisma/seed.ts).
  const products = await prisma.product.findMany({ select: { id: true, name: true } });
  const productByName = new Map(products.map((p) => [p.name.toLowerCase(), p.id] as const));
  const pid = (name?: string) => (name ? productByName.get(name.toLowerCase()) ?? null : null);

  // 1) Customers ----------------------------------------------------------
  const customerIds: string[] = [];
  let newCustomers = 0;
  for (const c of demoCustomers) {
    let row = await prisma.customer.findFirst({ where: { name: c.name }, select: { id: true } });
    if (!row) {
      row = await prisma.customer.create({
        data: { ...c, createdById: admin.id },
        select: { id: true },
      });
      newCustomers++;
    }
    customerIds.push(row.id);
  }
  console.log(`Customers: +${newCustomers} new (${demoCustomers.length - newCustomers} already existed).`);

  // 2) Quotations ---------------------------------------------------------
  let newQuotes = 0;
  const maxSeqByPrefix: Record<string, number> = {};
  for (const q of demoQuotes) {
    // Track the highest sequence per prefix so we can push the live counter
    // past these numbers (the app's generator never re-checks existence).
    const prefix = q.type === QuotationType.PO ? "PO" : "QT";
    const seq = Number.parseInt(q.number.slice(q.number.lastIndexOf("-") + 1), 10);
    maxSeqByPrefix[prefix] = Math.max(maxSeqByPrefix[prefix] ?? 0, seq);

    if (await prisma.quotation.findUnique({ where: { quoteNumber: q.number }, select: { id: true } })) {
      continue;
    }
    const lines = q.items.map((it, i) => ({
      productId: pid(it.product),
      description: it.description,
      qty: it.qty,
      unitPrice: it.unitPrice,
      discount: it.discount ?? 0,
      lineTotal: round2(it.qty * it.unitPrice - (it.discount ?? 0)),
      sortOrder: i,
    }));
    const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
    const discount = q.discount ?? 0;
    const taxable = round2(subtotal - discount);
    const taxAmount = q.taxType === TaxType.VAT_EXCLUSIVE ? round2(taxable * 0.12) : 0;
    const total = q.taxType === TaxType.VAT_INCLUSIVE ? taxable : round2(taxable + taxAmount);
    const decided = q.status === QuotationStatus.APPROVED;
    const sent = q.status === QuotationStatus.SENT || q.status === QuotationStatus.APPROVED;

    await prisma.quotation.create({
      data: {
        quoteNumber: q.number,
        type: q.type,
        status: q.status,
        poNumber: q.poNumber ?? null,
        customerId: customerIds[q.customer]!,
        createdById: admin.id,
        validUntil: q.validUntilDays != null ? days(q.validUntilDays) : null,
        subtotal,
        discount,
        taxType: q.taxType,
        taxAmount,
        total,
        paymentTermLabel: q.paymentTermLabel ?? null,
        downpaymentRate: q.downpaymentRate ?? 0.5,
        notes: q.notes ?? null,
        sentAt: sent ? days(-1) : null,
        approvedById: decided ? admin.id : null,
        approvedAt: decided ? days(-1) : null,
        items: { create: lines },
      },
    });
    newQuotes++;
  }
  console.log(`Quotations: +${newQuotes} new (${demoQuotes.length - newQuotes} already existed).`);

  // Push each monthly quote counter past the seed numbers so the app never
  // regenerates one and hits a unique-constraint error.
  for (const [prefix, seq] of Object.entries(maxSeqByPrefix)) {
    const key = `quotation:${prefix}:${QUOTE_YYMM}`;
    const current = await prisma.counter.findUnique({ where: { key } });
    if (!current) {
      await prisma.counter.create({ data: { key, value: seq } });
    } else if (current.value < seq) {
      await prisma.counter.update({ where: { key }, data: { value: seq } });
    }
  }

  // 3) Job orders ---------------------------------------------------------
  let newJos = 0;
  let maxJoSeq = 0;
  for (const jo of demoJos) {
    // Track the highest JO sequence so we can push the live JO counter past it.
    maxJoSeq = Math.max(
      maxJoSeq,
      Number.parseInt(jo.number.slice(jo.number.lastIndexOf("-") + 1), 10)
    );
    if (await prisma.jobOrder.findUnique({ where: { joNumber: jo.number }, select: { id: true } })) {
      continue;
    }
    const lines = jo.items.map((it, i) => ({
      productId: pid(it.product),
      description: it.description,
      qty: it.qty,
      unitPrice: it.unitPrice,
      lineTotal: round2(it.qty * it.unitPrice),
      lineItemId: `${jo.number}-${String(i + 1).padStart(2, "0")}`,
      sortOrder: i,
      productionStatus: it.productionStatus ?? null,
      department: it.department ?? null,
      category: it.category ?? null,
      assignedTo: it.assignedTo ?? null,
      deadline: it.deadlineDays != null ? days(it.deadlineDays) : null,
      actualDate: it.actualDateDays != null ? days(it.actualDateDays) : null,
      archivedAt: it.archivedDays != null ? days(it.archivedDays) : null,
      isRush: it.isRush ?? false,
      isLFP: it.isLFP ?? false,
      lfpWidth: it.lfpWidth ?? null,
      lfpHeight: it.lfpHeight ?? null,
      lfpUnit: it.lfpUnit ?? null,
      specs: (it.specs ?? undefined) as Prisma.InputJsonValue | undefined,
      steps: it.steps
        ? { create: it.steps.map((name, s) => ({ name, sortOrder: s })) }
        : undefined,
    }));
    const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
    const decided =
      jo.status !== JobOrderStatus.DRAFT && jo.status !== JobOrderStatus.PENDING_REVIEW;
    const inProduction =
      jo.status === JobOrderStatus.IN_PROGRESS || jo.status === JobOrderStatus.COMPLETED;

    await prisma.jobOrder.create({
      data: {
        joNumber: jo.number,
        customerId: customerIds[jo.customer]!,
        createdById: admin.id,
        status: jo.status,
        isLFP: jo.isLFP ?? false,
        deadline: jo.deadlineDays != null ? days(jo.deadlineDays) : null,
        subtotal,
        total: subtotal,
        notes: jo.notes ?? null,
        isApprovedByCustomer: inProduction,
        customerApprovedAt: inProduction ? days(-2) : null,
        approvedById: decided ? admin.id : null,
        approvedAt: decided ? days(-2) : null,
        completedAt: jo.status === JobOrderStatus.COMPLETED ? days(-2) : null,
        items: { create: lines },
      },
    });
    newJos++;
  }
  console.log(`Job orders: +${newJos} new (${demoJos.length - newJos} already existed).`);

  // Push the monthly JO counter past the seed numbers too (belt-and-suspenders;
  // the app's generator also skips existing numbers).
  const joKey = `jo:JO-${BRANCH_CODE}-${QUOTE_YYMM}`;
  const joCounter = await prisma.counter.findUnique({ where: { key: joKey } });
  if (!joCounter) {
    await prisma.counter.create({ data: { key: joKey, value: maxJoSeq } });
  } else if (joCounter.value < maxJoSeq) {
    await prisma.counter.update({ where: { key: joKey }, data: { value: maxJoSeq } });
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
