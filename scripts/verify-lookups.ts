// Verification for Maintenance lists + Employee master (run: npx tsx scripts/verify-lookups.ts)
import "dotenv/config";
import ExcelJS from "exceljs";
import { prisma } from "../src/lib/prisma";
import { parseCsv } from "../src/lib/csv";
import { fileToRows } from "../src/lib/spreadsheet";
import { getLookupService } from "../src/modules/shared/services/lookup-service";
import { getEmployeeService } from "../src/modules/shared/services/employee-service";
import type { Actor } from "../src/lib/authz";

const EMP_CSV = [
  "Employee Code,Team,NAME OF EMPLOYEE,EMAIL",
  'VRFY01,Production,"Verify, Person One",one@test.local',
  'VRFY02,Signage,"Verify, Person Two",',
  'VRFY01,Production,"Verify, Duplicate In File",dup@test.local',
  ",Admin,No Code Person,",
].join("\n");

async function main() {
  const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  const actor: Actor = { id: admin.id, role: admin.role };
  const viewer: Actor = { id: admin.id, role: "VIEWER" };
  const lookups = getLookupService();
  const emps = getEmployeeService();
  let fails = 0;
  const check = (n: string, c: boolean, x?: unknown) => { if (c) console.log("  ✓ " + n); else { fails++; console.error("  ✗ " + n, x ?? ""); } };
  const cleanup = () => prisma.employee.deleteMany({ where: { code: { startsWith: "VRFY" } } });

  await cleanup();

  console.log("Lookups (statuses/categories)");
  const statuses = await lookups.list(actor, "JO_STATUS");
  check("statuses listed (>= 7 seeded)", statuses.length >= 7, statuses.length);
  const cat = await lookups.create(actor, { type: "JO_CATEGORY", label: "Verify Tarp", isLFP: true });
  check("LFP category created", cat.isLFP === true);
  let dup = ""; try { await lookups.create(actor, { type: "JO_CATEGORY", label: "verify tarp" }); } catch (e) { dup = (e as Error).constructor.name; }
  check("duplicate category rejected", dup === "ConflictError", dup);

  console.log("Archive/restore (soft delete semantics)");
  await lookups.update(actor, { id: cat.id, isActive: false });
  const activeCats = await lookups.list(actor, "JO_CATEGORY");
  check("archived category hidden from pickers", !activeCats.some((c) => c.id === cat.id));
  await lookups.update(actor, { id: cat.id, isActive: true });
  const restoredCats = await lookups.list(actor, "JO_CATEGORY");
  check("restored category visible again", restoredCats.some((c) => c.id === cat.id));
  await lookups.remove(actor, cat.id);

  console.log("OPSServices category import (Sales- prefix + LF flag)");
  const OPS_CSV = [
    "Sales - Verify Acrylic 3D,LF",
    "Sales - Verify Photocopy,",
    "Sales - Verify Acrylic 3D,LF", // in-file duplicate
    ",",
  ].join("\n");
  const catImport = await lookups.importCategories(actor, parseCsv(OPS_CSV));
  check("2 categories imported", catImport.created === 2, catImport);
  check("in-file duplicate reported", catImport.errors.length === 1, catImport.errors);
  const catList = await lookups.list(actor, "JO_CATEGORY");
  const acrylic = catList.find((c) => c.label === "Verify Acrylic 3D");
  check("'Sales - ' prefix stripped", !!acrylic, catList.map((c) => c.label).filter((l) => l.startsWith("Verify")));
  check("LF column mapped to LFP flag", acrylic?.isLFP === true && catList.find((c) => c.label === "Verify Photocopy")?.isLFP === false);
  const reimport = await lookups.importCategories(actor, parseCsv(OPS_CSV));
  check("re-import skips existing", reimport.created === 0 && reimport.skippedExisting.length === 2, reimport);
  for (const c of catList.filter((c) => c.label.startsWith("Verify"))) {
    await lookups.remove(actor, c.id);
  }

  console.log("Employee master");
  const created = await emps.create(actor, { code: "VRFY00", name: "Verify, Manual Add", team: "Digital" });
  check("employee created", created.code === "VRFY00");
  let dupEmp = ""; try { await emps.create(actor, { code: "vrfy00", name: "x" }); } catch (e) { dupEmp = (e as Error).constructor.name; }
  check("case-insensitive duplicate code rejected", dupEmp === "ConflictError", dupEmp);

  const s1 = await emps.importRows(actor, parseCsv(EMP_CSV));
  check("CSV import created 2", s1.created === 2, s1);
  check("in-file duplicate reported", s1.errors.length === 1, s1.errors);
  const s2 = await emps.importRows(actor, parseCsv(EMP_CSV));
  check("re-import skips existing (2)", s2.created === 0 && s2.skippedExisting.length === 2, s2);

  console.log("XLSX round-trip (fileToRows)");
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("Some Other Tab").addRow(["decoy"]);
  const ws = wb.addWorksheet("EMPDATABASE");
  ws.addRow(["Employee Code", "Team", "NAME OF EMPLOYEE", "EMAIL"]);
  ws.addRow(["VRFY10", "Offset", "Verify, Xlsx Person", ""]);
  const emailCell = ws.getCell("D2");
  emailCell.value = { text: "xlsx@test.local", hyperlink: "mailto:xlsx@test.local" };
  const buffer = await wb.xlsx.writeBuffer();
  const file = new File([buffer as ArrayBuffer], "EMPDATABASE.xlsx");
  const xlsxRows = await fileToRows(file, ["EMPDATABASE"]);
  check("xlsx picked the named sheet (not decoy)", xlsxRows[0]?.[0] === "Employee Code", xlsxRows[0]);
  const s3 = await emps.importRows(actor, xlsxRows);
  check("xlsx import created 1", s3.created === 1, s3);
  const imported = (await emps.list(actor)).find((e) => e.code === "VRFY10");
  check("hyperlink email extracted", imported?.email === "xlsx@test.local", imported);

  await emps.update(actor, { id: created.id, isActive: false });
  const active = await emps.list(actor);
  check("deactivated hidden from picker list", !active.some((e) => e.id === created.id));

  let forb = ""; try { await emps.create(viewer, { code: "VRFYX", name: "Nope" }); } catch (e) { forb = (e as Error).constructor.name; }
  check("VIEWER cannot maintain employees", forb === "ForbiddenError", forb);

  await emps.remove(actor, created.id);
  await cleanup();
  console.log(fails === 0 ? "ALL CHECKS PASSED" : fails + " FAILED");
  process.exitCode = fails ? 1 : 0;
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
