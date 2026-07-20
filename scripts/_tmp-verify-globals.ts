// Non-destructive verify for global add-ons:
//  1. VIEWER cannot save (maintain permission).
//  2. ADMIN saves two common add-ons; list round-trips them.
//  3. resolveWizardProduct merges them into a product's rules,
//     and a product-level add-on with the same label wins.
//  4. Cleans up by restoring the previous (empty) global list.
import "dotenv/config";
import { Role } from "../src/generated/prisma/enums";
import { ForbiddenError } from "../src/lib/errors";
import { getPriceListService } from "../src/modules/quotations/services";
import { resolveWizardProduct } from "../src/modules/quotations/services/resolve-product";
import { prisma } from "../src/lib/prisma";

const ADMIN = { id: "cmre8rsld0000ssfel25s5yk0", role: Role.ADMIN };

async function main() {
  const svc = getPriceListService();
  const before = await svc.listGlobalAddons();

  let blocked = false;
  try {
    await svc.saveGlobalAddons({ id: "x", role: Role.VIEWER }, { addons: [] });
  } catch (e) {
    blocked = e instanceof ForbiddenError;
  }
  console.log(`VIEWER blocked: ${blocked ? "PASS" : "FAIL"}`);

  await svc.saveGlobalAddons(ADMIN, {
    addons: [
      { label: "Delivery fee", amount: "100", pct: "", notes: "within city" },
      { label: "Rush", amount: "999", pct: "", notes: "global (should lose to Tarpaulin's own)" },
    ],
  });
  const listed = await svc.listGlobalAddons();
  console.log(`saved+listed 2 add-ons: ${listed.length === 2 ? "PASS" : "FAIL"} (${listed.map((a) => a.label).join(", ")})`);

  const tarp = await prisma.product.findFirst({
    where: { deletedAt: null, name: "Tarpaulin" },
    select: { id: true },
  });
  if (!tarp) throw new Error("no Tarpaulin");
  const dto = await resolveWizardProduct(tarp.id, "");
  const addons = dto!.rules.filter((r) => r.type === "ADDON");
  const delivery = addons.find((a) => a.label === "Delivery fee");
  const rush = addons.filter((a) => /rush/i.test(a.label));
  console.log(`global Delivery merged into Tarpaulin: ${delivery?.amount === "100" ? "PASS" : "FAIL"}`);
  console.log(`product-level Rush wins (150, one entry): ${rush.length === 1 && rush[0]!.amount === "150" ? "PASS" : "FAIL"} (${rush.map((r) => r.amount).join(",")})`);

  // restore previous state
  await svc.saveGlobalAddons(ADMIN, {
    addons: before.map((a) => ({
      label: a.label,
      amount: a.amount ?? "",
      pct: a.pct ?? "",
      notes: a.notes ?? "",
    })),
  });
  console.log(`restored previous global list (${before.length})`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
