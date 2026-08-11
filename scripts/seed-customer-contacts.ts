// Demo-fill customers' TIN + contact number where they're still blank.
// Fill-if-null only — never overwrites a real value. Idempotent.
// Run: npm run db:seed-customer-contacts
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

const MOBILE_PREFIXES = [
  "0917", "0918", "0919", "0915", "0916", "0926", "0927",
  "0935", "0936", "0945", "0995", "0997", "0906", "0908", "0999",
];
const rnd = (n: number) => Math.floor(Math.random() * n);
const digits = (n: number) => Array.from({ length: n }, () => rnd(10)).join("");

// PH mobile: 09XX XXX XXXX
function fakeMobile(): string {
  const p = MOBILE_PREFIXES[rnd(MOBILE_PREFIXES.length)]!;
  return `${p} ${digits(3)} ${digits(4)}`;
}
// PH TIN: NNN-NNN-NNN-000 (000 = head office branch code)
function fakeTin(): string {
  return `${digits(3)}-${digits(3)}-${digits(3)}-000`;
}

async function main() {
  const customers = await prisma.customer.findMany({
    where: { deletedAt: null, OR: [{ tin: null }, { contactNumber: null }] },
    select: { id: true, tin: true, contactNumber: true },
  });
  console.log(`Found ${customers.length} customer(s) with a blank TIN or contact.`);

  let tinFilled = 0;
  let contactFilled = 0;
  const chunk = 25;
  for (let i = 0; i < customers.length; i += chunk) {
    await Promise.all(
      customers.slice(i, i + chunk).map((c) => {
        const data: { tin?: string; contactNumber?: string } = {};
        if (!c.tin) { data.tin = fakeTin(); tinFilled++; }
        if (!c.contactNumber) { data.contactNumber = fakeMobile(); contactFilled++; }
        return prisma.customer.update({ where: { id: c.id }, data });
      })
    );
  }

  console.log(`Done: filled ${tinFilled} TIN(s) and ${contactFilled} contact number(s).`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
