import "dotenv/config";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { PriceRuleType, Role } from "../src/generated/prisma/enums";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const users: { name: string; email: string; role: Role; password: string }[] = [
  { name: "System Admin", email: "admin@ops.local", role: Role.ADMIN, password: "Admin123!" },
  { name: "Pudding (Lloyd)", email: "jmnventures.digital@gmail.com", role: Role.ADMIN, password: "Admin123!" },
  { name: "Branch Manager", email: "manager@ops.local", role: Role.MANAGER, password: "Manager123!" },
  { name: "Sales Encoder", email: "encoder@ops.local", role: Role.ENCODER, password: "Encoder123!" },
  { name: "Auditor", email: "auditor@ops.local", role: Role.AUDITOR, password: "Auditor123!" },
  { name: "Viewer", email: "viewer@ops.local", role: Role.VIEWER, password: "Viewer123!" },
];

// Default JO production statuses (legacy StatusDatabase "Status Department").
// Maintainable afterwards under Maintenance → Job Orders.
const joStatuses = [
  "For Layout - Graphics",
  "For Approval - Graphics",
  "Ongoing - Printing",
  "Ongoing - Production",
  "On Hold - Production",
  "Waiting - For Pick up / Delivery",
  "Done - Completed",
];

// Product catalog ported from the legacy quotation_system price DB — one row
// per legacy calculator page, basePrice = the hardcoded default each
// get<X>Pricing() fell back to (representative rate; tiers/surcharges come
// with the PriceRule work). basePrice 0 = priced per quotation.
const products: {
  name: string;
  category: string;
  unit: string;
  basePrice: number;
  description: string;
}[] = [
  { name: "Tarpaulin", category: "Large Format", unit: "sqft", basePrice: 50, description: "Rate per sqft · rush +150 · design fee +250" },
  { name: "Signage (Metal Frame)", category: "Signage", unit: "sqft", basePrice: 0, description: "Parametric pricing — price DB 'Signage New' (single/double face, 3D build-up, mounting & complexity surcharges)" },
  { name: "Acrylic Signage", category: "Acrylic", unit: "sqft", basePrice: 600, description: "Min 1×1 ft; smaller charged as 1×1 · customized shape, 1 layer" },
  { name: "Acrylic Display", category: "Acrylic", unit: "sqft", basePrice: 200, description: "2mm 200 / 3mm 225 per sqft · min 1×1 ft" },
  { name: "Acrylic Plate Number", category: "Acrylic", unit: "pc", basePrice: 200, description: "Motorcycle 200 · car 400" },
  { name: "Acrylic Plaque", category: "Acrylic", unit: "pc", basePrice: 910, description: "Acrylic 6\" 910 · 8\" 1,100" },
  { name: "Acrylic Keychain", category: "Acrylic", unit: "sq in", basePrice: 25, description: "25/sq in · min 80 combined sq in · acrylic + vinyl sticker" },
  { name: "Life-Size Standee", category: "Large Format", unit: "sqft", basePrice: 250, description: "Rate per sqft · rush +150 · design fee +250" },
  { name: "Canvas Print", category: "Large Format", unit: "sqft", basePrice: 450, description: "Rate per sqft · rush +150 · design fee +250" },
  { name: "Frame", category: "Frames", unit: "sqft", basePrice: 550, description: "Without matting 550 / with matting 600 per sqft · rush +150" },
  { name: "T-Shirt Print", category: "Apparel", unit: "pc", basePrice: 0, description: "Tiered by print type (sublimation/DTF/full-sub), logo size, and qty · full-sub min 15 pcs" },
  { name: "Mesh Cap", category: "Apparel", unit: "pc", basePrice: 140, description: "Sublimation print · min order 20 pcs" },
  { name: "Tote Bag", category: "Apparel", unit: "pc", basePrice: 190, description: "10×12 canvas 190 · 12×14 210 · sublimation" },
  { name: "Foldable Fan", category: "Souvenirs", unit: "pc", basePrice: 50, description: "Sublimation 50 / DTF 80" },
  { name: "Mug", category: "Souvenirs", unit: "pc", basePrice: 180, description: "White mug tiered: 180 (5+) → 100 (50+) · inner-color from 190" },
  { name: "Sticker", category: "Printing", unit: "sheet", basePrice: 80, description: "Sticker paper / vinyl 80 · pre-cut 150" },
  { name: "UV Print", category: "Printing", unit: "pc", basePrice: 0, description: "Priced per location/surface (up to 4 sq in per location)" },
  { name: "Risograph", category: "Printing", unit: "ream", basePrice: 340, description: "News print short, with paper, front only 340 · riso-only 225" },
  { name: "Ticket", category: "Printing", unit: "pc", basePrice: 4.5, description: "Calling-card size 4.50 · 4\"×5\" 10.00" },
  { name: "Newsprint", category: "Printing", unit: "copy", basePrice: 75, description: "Newsletter 12 pages 75/copy" },
  { name: "Souvenir Program", category: "Printing", unit: "page", basePrice: 80, description: "80/page · A3 laser" },
  { name: "Certificate", category: "Printing", unit: "copy", basePrice: 30, description: "Award 30 (mirrorkote/vellum) · gift 12 (high-gloss 3\"×6\")" },
  { name: "Calendar", category: "Printing", unit: "pc", basePrice: 28.5, description: "1 month/page 11\"×17\" 28.50 · 17\"×22\" 49 · min 100 pcs" },
  { name: "Calling Card", category: "Printing", unit: "set", basePrice: 300, description: "One-side 300 / back-to-back 500 · min 50 pcs · mirrorkote" },
  { name: "Name Plate", category: "Signage", unit: "pc", basePrice: 200, description: "Acrylic or metal 200" },
  { name: "ID Printing", category: "Printing", unit: "pc", basePrice: 85, description: "Rubberized 85 / PVC 175 · rush +250 or +5%" },
  { name: "Receipt Booklet", category: "Printing", unit: "booklet", basePrice: 0, description: "Priced per price DB (paper type, copies, page division, numbering)" },
  { name: "Bookbinding", category: "Printing", unit: "book", basePrice: 430, description: "Hardbound 430 · softbound 150/100 · ring bind 100 · printing per page" },
];

// Parametric price rules (legacy get<X>Pricing() defaults, as data), keyed
// by product name. VARIANT rows sharing a label form qty tiers.
type RuleSeed = {
  type: PriceRuleType;
  label: string;
  unitPrice?: number;
  minQty?: number;
  minCharge?: number;
  amount?: number;
  pct?: number;
  notes?: string;
};

const priceRules: Record<string, RuleSeed[]> = {
  Tarpaulin: [
    { type: "VARIANT", label: "Standard rate", unitPrice: 50 },
    { type: "ADDON", label: "Rush fee", amount: 150 },
    { type: "ADDON", label: "Design fee", amount: 250 },
  ],
  Mug: [
    { type: "VARIANT", label: "White Mug", minQty: 5, unitPrice: 180 },
    { type: "VARIANT", label: "White Mug", minQty: 10, unitPrice: 150 },
    { type: "VARIANT", label: "White Mug", minQty: 25, unitPrice: 125 },
    { type: "VARIANT", label: "White Mug", minQty: 50, unitPrice: 100 },
    { type: "VARIANT", label: "Inner Color Mug", minQty: 5, unitPrice: 190 },
    { type: "VARIANT", label: "Inner Color Mug", minQty: 10, unitPrice: 160 },
    { type: "VARIANT", label: "Inner Color Mug", minQty: 25, unitPrice: 140 },
    { type: "VARIANT", label: "Inner Color Mug", minQty: 50, unitPrice: 130 },
  ],
  Frame: [
    { type: "VARIANT", label: "Without matting", unitPrice: 550 },
    { type: "VARIANT", label: "With matting", unitPrice: 600 },
    { type: "ADDON", label: "Rush fee", amount: 150 },
  ],
  "ID Printing": [
    { type: "VARIANT", label: "Rubberized", unitPrice: 85, notes: "Bulk discounts offered" },
    { type: "VARIANT", label: "PVC", unitPrice: 175, notes: "Small qty, faster printing" },
    { type: "ADDON", label: "Rush fee", amount: 250, pct: 5, notes: "Legacy: flat 250 or +5%" },
    { type: "ADDON", label: "Design fee", amount: 250 },
  ],
  "Acrylic Display": [
    { type: "VARIANT", label: "2 MM", unitPrice: 200, minCharge: 200, notes: "Min 1×1 ft" },
    { type: "VARIANT", label: "3 MM", unitPrice: 225, minCharge: 225, notes: "Min 1×1 ft" },
  ],
  "Acrylic Signage": [
    { type: "VARIANT", label: "Standard", unitPrice: 600, minCharge: 600, notes: "Smaller than 1×1 ft charged as 1×1" },
  ],
  "Acrylic Plate Number": [
    { type: "VARIANT", label: "Motorcycle", unitPrice: 200 },
    { type: "VARIANT", label: "Car", unitPrice: 400 },
  ],
  "Foldable Fan": [
    { type: "VARIANT", label: "Sublimation", unitPrice: 50 },
    { type: "VARIANT", label: "DTF", unitPrice: 80 },
  ],
  "Calling Card": [
    { type: "VARIANT", label: "One-side", unitPrice: 300, notes: "Min 50 pcs · mirrorkote" },
    { type: "VARIANT", label: "Back-to-back", unitPrice: 500, notes: "Min 50 pcs · mirrorkote" },
  ],
  Certificate: [
    { type: "VARIANT", label: "Award Certificate", unitPrice: 30 },
    { type: "VARIANT", label: "Gift Certificate", unitPrice: 12 },
  ],
  Bookbinding: [
    { type: "VARIANT", label: "Hardbound", unitPrice: 430 },
    { type: "VARIANT", label: "Softbound with lettering", unitPrice: 150 },
    { type: "VARIANT", label: "Softbound without lettering", unitPrice: 100 },
    { type: "VARIANT", label: "Ring bind", unitPrice: 100 },
    { type: "ADDON", label: "Rush fee", amount: 150 },
  ],
  "Life-Size Standee": [
    { type: "VARIANT", label: "Standard rate", unitPrice: 250 },
    { type: "ADDON", label: "Rush fee", amount: 150 },
    { type: "ADDON", label: "Design fee", amount: 250 },
  ],
  "Canvas Print": [
    { type: "VARIANT", label: "Standard rate", unitPrice: 450 },
    { type: "ADDON", label: "Rush fee", amount: 150 },
    { type: "ADDON", label: "Design fee", amount: 250 },
  ],
};

async function main() {
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { role: u.role, isActive: true },
      create: {
        name: u.name,
        email: u.email,
        role: u.role,
        passwordHash: bcrypt.hashSync(u.password, 10),
        isActive: true,
      },
    });
  }
  console.log(`Seeded ${users.length} users.`);

  const admin = await prisma.user.findUniqueOrThrow({
    where: { email: "admin@ops.local" },
  });
  for (const [index, label] of joStatuses.entries()) {
    await prisma.lookupOption.upsert({
      where: { type_label: { type: "JO_STATUS", label } },
      update: {},
      create: {
        type: "JO_STATUS",
        label,
        sortOrder: index,
        createdById: admin.id,
      },
    });
  }
  console.log(`Seeded ${joStatuses.length} JO statuses.`);

  // Create-if-missing (no upsert-update): re-seeding must never clobber
  // price edits made in the app.
  let productsCreated = 0;
  for (const p of products) {
    const existing = await prisma.product.findFirst({
      where: { name: { equals: p.name, mode: "insensitive" } },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.product.create({
      data: { ...p, createdById: admin.id },
    });
    productsCreated++;
  }
  console.log(
    `Seeded ${productsCreated} products (${products.length - productsCreated} already existed).`
  );

  // Price rules: skip any product that already has rules — the app (or a
  // manual edit) owns them after first seed.
  let rulesCreated = 0;
  for (const [productName, rules] of Object.entries(priceRules)) {
    const product = await prisma.product.findFirst({
      where: { name: { equals: productName, mode: "insensitive" } },
      select: { id: true, _count: { select: { priceRules: true } } },
    });
    if (!product || product._count.priceRules > 0) continue;
    await prisma.priceRule.createMany({
      data: rules.map((rule, index) => ({
        productId: product.id,
        type: rule.type,
        label: rule.label,
        unitPrice: rule.unitPrice,
        minQty: rule.minQty ?? 1,
        minCharge: rule.minCharge,
        amount: rule.amount,
        pct: rule.pct,
        notes: rule.notes,
        sortOrder: index,
      })),
    });
    rulesCreated += rules.length;
  }
  console.log(`Seeded ${rulesCreated} price rules.`);

  // System account that owns anonymous portal inquiries (cannot sign in).
  await prisma.user.upsert({
    where: { email: "portal@ops.local" },
    update: {},
    create: {
      name: "Customer Portal",
      email: "portal@ops.local",
      role: Role.VIEWER,
      passwordHash: bcrypt.hashSync(randomBytes(24).toString("hex"), 10),
      isActive: false,
    },
  });
  console.log("Seeded portal system user.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
