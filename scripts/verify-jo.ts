// Temporary end-to-end verification for the JO module + legacy import.
// Drives the real services against the real dev database, then cleans up.
// Run: npx tsx scripts/verify-jo.ts
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { parseCsv } from "../src/lib/csv";
import {
  getJobOrderService,
  getLegacyImportService,
} from "../src/modules/job-orders/services";
import {
  jobOrderCreateInput,
  jobOrderEditFormInput,
} from "../src/modules/job-orders/schemas/job-order";
import type { Actor } from "../src/lib/authz";

const dateStr = (offsetDays: number) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
};

const HEADERS =
  "Department,Status Department,Plan Date Start,Plan Date End,Date Today,Deadline Promised,Actual Date,Status History,Formatted JO Specs,Days Left,Employee Assigned,JO Number,JO Amount,Category,LFP Width,LFP Height,LFP Unit,Waiting Pickup Since,Is Rush,Line Item ID";

const LINEUP_CSV = [
  HEADERS,
  // LFP rush item with multiline history (quoted newlines)
  `Printing,Ongoing - Printing,,,7/1/2026,7/15/2026,,"7/1 10:00 AM Layout started
7/2 2:15 PM Ongoing printing","7/1 | Verify Customer A | 100 pcs |
Tarpaulin 8x3 ft for fiesta",14,Juan,VERIFY-001,1500,Tarpaulin,8,3,ft,,TRUE,VERIFY-001-01`,
  // Waiting-for-pickup item of the same JO
  `,Waiting - For Pick up / Delivery,,,7/1/2026,7/10/2026,,,"7/1 | Verify Customer A | 20 pcs |
Sticker labels",,Maria,VERIFY-001,300,,,,,7/6/2026 3:00 PM,FALSE,VERIFY-001-02`,
  // Done item on the active sheet → should archive + complete the JO
  `,Done,,,6/20/2026,6/25/2026,6/24/2026,6/24 4:00 PM Done,"6/20 | Verify Customer B | 1 |
Photocopy bond papers",,Pedro,VERIFY-002,50,,,,,,FALSE,VERIFY-002-01`,
].join("\n");

const ARCHIVE_CSV = [
  HEADERS.replace("Waiting Pickup Since", "Date Archive"),
  `,Done - Completed,,,5/1/2026,5/15/2026,5/14/2026,5/14 1:00 PM Done,"5/1 | Verify Customer A | 5 |
ID cards batch",,Juan,VERIFY-003,750,,,,,5/30/2026,FALSE,VERIFY-003-01`,
].join("\n");

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}`, extra ?? "");
  }
}

async function cleanup() {
  await prisma.jobOrder.deleteMany({
    where: { joNumber: { startsWith: "VERIFY-" } },
  });
  // auto-numbered fixtures (R-AD…) are only traceable via their customer
  await prisma.jobOrder.deleteMany({
    where: {
      customer: { name: { in: ["X"], mode: "insensitive" } },
    },
  });
  await prisma.jobOrder.deleteMany({
    where: { customer: { name: { startsWith: "Verify Customer" } } },
  });
  await prisma.customer.deleteMany({
    where: {
      OR: [
        { name: { startsWith: "Verify Customer" } },
        { name: { equals: "X", mode: "insensitive" } },
      ],
    },
  });
  await prisma.activityLog.deleteMany({
    where: { payload: { path: ["joNumber"], string_starts_with: "VERIFY-" } },
  });
}

async function main() {
  const admin = await prisma.user.findFirstOrThrow({
    where: { role: "ADMIN" },
  });
  const actor: Actor = { id: admin.id, role: admin.role };
  const viewer: Actor = { id: admin.id, role: "VIEWER" };
  const importer = getLegacyImportService();
  const jos = getJobOrderService();

  await cleanup();

  console.log("1) Import Line-up JOs CSV");
  const s1 = await importer.import(actor, parseCsv(LINEUP_CSV), "lineup");
  check("2 JOs created", s1.jobOrdersCreated === 2, s1);
  check("3 items created", s1.itemsCreated === 3, s1);
  check("2 customers created", s1.customersCreated === 2, s1);
  check("no errors", s1.errors.length === 0, s1.errors);

  console.log("2) Re-import is idempotent");
  const s2 = await importer.import(actor, parseCsv(LINEUP_CSV), "lineup");
  check("0 created on re-import", s2.jobOrdersCreated === 0, s2);
  check("2 skipped as existing", s2.skippedExisting.length === 2, s2);

  console.log("3) Import Archive CSV");
  const s3 = await importer.import(actor, parseCsv(ARCHIVE_CSV), "archive");
  check("1 archived JO created", s3.jobOrdersCreated === 1, s3);
  check("customer A reused (0 new)", s3.customersCreated === 0, s3);

  console.log("4) List + imported data shape");
  const page = await jos.list(actor, { q: "VERIFY", view: "all", take: 25 });
  check("3 rows listed", page.rows.length === 3, page.rows.length);
  const v1 = page.rows.find((r) => r.joNumber === "VERIFY-001")!;
  const v2 = page.rows.find((r) => r.joNumber === "VERIFY-002")!;
  const v3 = page.rows.find((r) => r.joNumber === "VERIFY-003")!;
  check("VERIFY-001 in progress", v1.status === "IN_PROGRESS", v1.status);
  check("VERIFY-001 waiting pickup flagged", v1.hasWaitingPickup);
  check("VERIFY-001 overdue (deadline 7/15/2026 < today? no) → not overdue if future", v1.isOverdue === new Date("2026-07-15") < new Date(), v1);
  check("VERIFY-001 rush", v1.isRush);
  check("VERIFY-002 completed (done on lineup)", v2.status === "COMPLETED", v2.status);
  check("VERIFY-003 completed (archive)", v3.status === "COMPLETED", v3.status);
  check("rows marked imported", v1.imported && v2.imported && v3.imported);

  const d1 = await jos.get(actor, v1.id);
  check("customer parsed from specs", d1.customer.name === "Verify Customer A", d1.customer.name);
  check("2 items on VERIFY-001", d1.items.length === 2);
  const tarp = d1.items.find((i) => i.lineItemId === "VERIFY-001-01")!;
  check("multiline history preserved", (tarp.statusHistory ?? "").includes("\n"), tarp.statusHistory);
  check("qty parsed (100)", tarp.qty === 100, tarp.qty);
  check("LFP inferred", tarp.isLFP && tarp.lfpWidth === "8" && tarp.lfpUnit === "ft");
  check("amount preserved", tarp.lineTotal === "1500", tarp.lineTotal);
  const sticker = d1.items.find((i) => i.lineItemId === "VERIFY-001-02")!;
  check("waitingPickupSince imported", sticker.waitingPickupSince !== null, sticker);
  check("total = 1800", d1.total === "1800", d1.total);

  console.log("4b) Board metrics (legacy JO_METRICS parity)");
  const baseline = await jos.getBoardMetrics();
  const mkItem = (status: string, deadline: string) => ({
    description: "metric fixture",
    qty: "1",
    amount: "100",
    deadline,
    productionStatus: status,
    isLFP: false,
    isRush: false,
  });
  await jos.create(actor, {
    joNumber: "VERIFY-SM-1",
    isPO: false, isNonJo: true, customerName: "Verify Customer A",
    items: [mkItem("Waiting - Sales & Marketing", dateStr(-1))],
  });
  await jos.create(actor, {
    joNumber: "VERIFY-SM-2",
    isPO: false, isNonJo: true, customerName: "Verify Customer A",
    items: [mkItem("Waiting - Sales & Marketing", dateStr(2))],
  });
  await jos.create(actor, {
    joNumber: "VERIFY-CA-1",
    isPO: false, isNonJo: true, customerName: "Verify Customer A",
    items: [mkItem("Waiting - Customers Approval", dateStr(10))],
  });
  const m = await jos.getBoardMetrics();
  check("all +3", m.all === baseline.all + 3, [baseline.all, m.all]);
  check("smOverdue +1", m.smOverdue === baseline.smOverdue + 1, [baseline.smOverdue, m.smOverdue]);
  check("smAlarming +1", m.smAlarming === baseline.smAlarming + 1, [baseline.smAlarming, m.smAlarming]);
  check("custApproval +1", m.custApproval === baseline.custApproval + 1, [baseline.custApproval, m.custApproval]);
  check("overdue +1 (SM-1 past deadline)", m.overdue === baseline.overdue + 1, [baseline.overdue, m.overdue]);
  check("ongoing includes imported 'Ongoing - Printing'", m.ongoing >= 1, m.ongoing);
  check("waiting includes imported pickup item", m.waiting >= 1, m.waiting);
  const smView = await jos.list(actor, { q: "VERIFY", view: "smOverdue", take: 25 });
  check("smOverdue view lists VERIFY-SM-1 only", smView.rows.length === 1 && smView.rows[0]!.joNumber === "VERIFY-SM-1", smView.rows.map(r => r.joNumber));

  console.log("4b2) Calendar (legacy getJODeadlinesForMonth + deadline move)");
  const now = new Date();
  const cal = await jos.listCalendar(actor, now.getFullYear(), now.getMonth() + 1);
  const calNums = cal.map((r) => r.joNumber);
  check("SM/CA pins on this month's calendar", calNums.includes("VERIFY-SM-1") && calNums.includes("VERIFY-CA-1"), calNums.filter((n) => n.startsWith("VERIFY")));
  check("waiting-pickup item excluded from calendar", !cal.some((r) => r.lineItemId === "VERIFY-001-02"));
  check("archived item excluded from calendar", !calNums.includes("VERIFY-002"));

  const sm1 = await jos.list(actor, { q: "VERIFY-SM-1", view: "all", take: 5 });
  const sm1Id = sm1.rows[0]!.id;
  const moved = await jos.moveJoDeadline(actor, { jobOrderId: sm1Id, newDate: dateStr(6) });
  check("deadline move updates all open items", moved.itemsMoved === 1, moved);
  const sm1After = await jos.get(actor, sm1Id);
  check("JO header deadline moved", sm1After.deadline?.slice(0, 10) === dateStr(6), sm1After.deadline);
  let noop = "";
  try { await jos.moveJoDeadline(actor, { jobOrderId: sm1Id, newDate: dateStr(6) }); } catch (e) { noop = (e as Error).constructor.name; }
  check("no-op move rejected (legacy 'already' guard)", noop === "ValidationError", noop);
  let calForb = "";
  try { await jos.moveJoDeadline(viewer, { jobOrderId: sm1Id, newDate: dateStr(7) }); } catch (e) { calForb = (e as Error).constructor.name; }
  check("VIEWER cannot move deadlines", calForb === "ForbiddenError", calForb);
  const moveLog = await prisma.activityLog.findFirst({ where: { action: "deadline-moved", entityId: sm1Id } });
  check("deadline move audit-logged", !!moveLog);
  const moveHistory = await jos.getDeadlineHistory(actor, sm1Id);
  check("deadline history readable (legacy getJODeadlineHistory)", moveHistory.length >= 1 && moveHistory[0]!.newDeadline === dateStr(6), moveHistory[0]);
  // put it back so the metrics deltas in later runs stay deterministic
  await jos.moveJoDeadline(actor, { jobOrderId: sm1Id, newDate: dateStr(-1) });

  console.log("4c) Validation parity (legacy submitNewJO)");
  const noDeadline = {
    joNumber: "VERIFY-VAL-1",
    isPO: false, isNonJo: false, customerName: "X",
    items: [{ description: "d", qty: "1", amount: "5", isLFP: false, isRush: false }],
  };
  const createParse = jobOrderCreateInput.safeParse(noDeadline);
  check(
    "create requires item deadline",
    !createParse.success &&
      createParse.error.issues.some((i) => i.message === "Deadline is required."),
    createParse.success ? "parsed" : createParse.error.issues[0]
  );
  check("edit allows blank deadline (imported data)", jobOrderEditFormInput.safeParse(noDeadline).success);

  console.log("4d) JO/PO numbering (fusion: auto R-AD, manual for PO/non-JO)");
  const plainItem = {
    description: "auto-numbered item",
    qty: "1",
    amount: "50",
    deadline: dateStr(3),
    isLFP: false,
    isRush: false,
  };
  const auto1 = await jos.create(actor, {
    isPO: false, isNonJo: false, customerName: "Verify Customer A",
    items: [plainItem, { ...plainItem, description: "second item" }],
  });
  const auto1Detail = await jos.get(actor, auto1.id);
  const rx = /^R-AD\d{4}-\d{2}-\d{2}-\d{2,}$/;
  check("auto-generated number matches R-AD{date}-{seq}", rx.test(auto1Detail.joNumber), auto1Detail.joNumber);
  check(
    "line items get -01/-02 suffixes",
    auto1Detail.items[0]!.lineItemId === `${auto1Detail.joNumber}-01` &&
      auto1Detail.items[1]!.lineItemId === `${auto1Detail.joNumber}-02`,
    auto1Detail.items.map((i) => i.lineItemId)
  );
  const auto2 = await jos.create(actor, {
    isPO: false, isNonJo: false, customerName: "Verify Customer A",
    items: [plainItem],
  });
  const auto2Detail = await jos.get(actor, auto2.id);
  check("second auto JO gets a new number (collision-safe)", auto2Detail.joNumber !== auto1Detail.joNumber && rx.test(auto2Detail.joNumber), auto2Detail.joNumber);

  const po = await jos.create(actor, {
    joNumber: "VERIFY-PO # 998877",
    isPO: true, isNonJo: false, customerName: "Verify Customer A",
    items: [plainItem],
  });
  const poDetail = await jos.get(actor, po.id);
  check("PO keeps the typed number + flag", poDetail.joNumber === "VERIFY-PO # 998877" && poDetail.isPO, poDetail.joNumber);

  let noNum = "";
  try {
    await jos.create(actor, { isPO: true, isNonJo: false, customerName: "X", items: [plainItem] });
  } catch (e) { noNum = (e as Error).constructor.name; }
  check("PO without a number rejected", noNum === "ValidationError", noNum);
  const bothFlags = jobOrderCreateInput.safeParse({
    isPO: true, isNonJo: true, joNumber: "X-1", customerName: "X",
    items: [plainItem],
  });
  check("both PO + Non-JO rejected by schema", !bothFlags.success && bothFlags.error?.issues.some((i) => i.message.includes("not both")));
  // numbering fixtures are not part of the later board counts — remove them
  await prisma.jobOrder.deleteMany({
    where: { id: { in: [auto1.id, auto2.id, po.id] } },
  });

  console.log("5) Create / duplicate / status flow / edit / delete");
  const created = await jos.create(actor, {
    joNumber: "VERIFY-NEW-1",
    isPO: false, isNonJo: true, customerName: "Verify Customer C",
    notes: "from verify script",
    items: [
      {
        description: "Mug print",
        qty: "12",
        amount: "960",
        deadline: "2026-07-20",
        productionStatus: "Ongoing - Production",
        isLFP: false,
        isRush: false,
      },
    ],
  });
  const dNew = await jos.get(actor, created.id);
  check("created with IN_PROGRESS", dNew.status === "IN_PROGRESS");
  check("unitPrice derived (80.00)", dNew.items[0]!.lineTotal === "960", dNew.items[0]!.lineTotal);

  let dupErr = "";
  try {
    await jos.create(actor, {
      joNumber: "verify-new-1", // case-insensitive duplicate
      isPO: false, isNonJo: true, customerName: "X",
      items: [{ description: "d", qty: "1", amount: "1", isLFP: false, isRush: false }],
    });
  } catch (e) {
    dupErr = e instanceof Error ? e.constructor.name : "";
  }
  check("duplicate JO number rejected (ConflictError)", dupErr === "ConflictError", dupErr);

  const itemId = dNew.items[0]!.id;
  await jos.updateItemStatus(actor, {
    jobOrderId: created.id,
    itemId,
    productionStatus: "Waiting - For Pick up / Delivery",
    remark: "customer texted",
  });
  let d = await jos.get(actor, created.id);
  check("waiting stamped", d.items[0]!.waitingPickupSince !== null);
  check("history appended with remark", (d.items[0]!.statusHistory ?? "").includes("customer texted"));

  await jos.updateItemStatus(actor, {
    jobOrderId: created.id,
    itemId,
    productionStatus: "Done - Completed",
  });
  d = await jos.get(actor, created.id);
  check("item archived on done", d.items[0]!.archivedAt !== null);
  check("waiting cleared on done", d.items[0]!.waitingPickupSince === null);
  check("JO auto-completed", d.status === "COMPLETED", d.status);

  await jos.update(actor, {
    id: created.id,
    joNumber: "VERIFY-NEW-1",
    isPO: false, isNonJo: true, customerName: "Verify Customer C",
    items: [
      { id: itemId, description: "Mug print", qty: "12", amount: "1000", isLFP: false, isRush: false },
      { description: "Extra keychains", qty: "5", amount: "250", isLFP: false, isRush: false },
    ],
  });
  d = await jos.get(actor, created.id);
  check("edit added item", d.items.length === 2);
  check("totals recomputed (1250)", d.total === "1250", d.total);
  check("JO reopened by new open item", d.status === "IN_PROGRESS", d.status);
  check("done item kept its history", d.items.find((i) => i.id === itemId)!.archivedAt !== null);

  let forbidden = "";
  try {
    await jos.create(viewer, {
      joNumber: "VERIFY-NOPE",
      isPO: false, isNonJo: true, customerName: "X",
      items: [{ description: "d", qty: "1", amount: "1", isLFP: false, isRush: false }],
    });
  } catch (e) {
    forbidden = e instanceof Error ? e.constructor.name : "";
  }
  check("VIEWER cannot create (ForbiddenError)", forbidden === "ForbiddenError", forbidden);

  console.log("5b) Per-item board + edit-modal path (updateItem)");
  const board = await jos.listItems(actor, { q: "VERIFY", view: "all", take: 50 });
  check("board lists one row per item (9)", board.rows.length === 9, board.rows.length);
  check("board rows carry JO + customer", board.rows.every((r) => r.joNumber.startsWith("VERIFY") && r.customerName.length > 0));

  const keychain = d.items.find((i) => i.description === "Extra keychains")!;
  await jos.updateItem(actor, {
    id: keychain.id,
    jobOrderId: created.id,
    description: "Extra keychains (engraved)",
    qty: "5",
    amount: "300",
    deadline: dateStr(5),
    productionStatus: "Ongoing - Printing",
    remark: "modal edit test",
    assignedTo: "JUAN01",
    category: "Souvenirs",
    isLFP: false,
    lfpWidth: "",
    lfpHeight: "",
    lfpUnit: "",
    isRush: true,
  });
  d = await jos.get(actor, created.id);
  const keychain2 = d.items.find((i) => i.id === keychain.id)!;
  check("modal edit updated fields", keychain2.description.includes("engraved") && keychain2.isRush && keychain2.assignedTo === "JUAN01");
  check("modal edit total recomputed (1300)", d.total === "1300", d.total);
  check("modal edit status + remark in history", (keychain2.statusHistory ?? "").includes("modal edit test"), keychain2.statusHistory);

  // legacy "ADD NEW STATUS UPDATE": note appends even without a status change
  await jos.updateItem(actor, {
    id: keychain.id,
    jobOrderId: created.id,
    description: keychain2.description,
    qty: "5",
    amount: "300",
    deadline: dateStr(5),
    productionStatus: "Ongoing - Printing", // unchanged
    remark: "note-only progress update",
    isLFP: false,
    isRush: true,
  });
  d = await jos.get(actor, created.id);
  const keychain3 = d.items.find((i) => i.id === keychain.id)!;
  check("note-only update appended to history", (keychain3.statusHistory ?? "").includes("note-only progress update"), keychain3.statusHistory);
  check("note-only update keeps status unchanged", keychain3.productionStatus === "Ongoing - Printing");

  await jos.updateItem(actor, {
    id: keychain.id,
    jobOrderId: created.id,
    description: keychain2.description,
    qty: "5",
    amount: "300",
    deadline: dateStr(5),
    productionStatus: "Delivered to customer",
    isLFP: false,
    isRush: false,
  });
  d = await jos.get(actor, created.id);
  check("modal done-status archives item", d.items.find((i) => i.id === keychain.id)!.archivedAt !== null);
  check("JO completed when last item done via modal", d.status === "COMPLETED", d.status);
  const doneBoard = await jos.listItems(actor, { q: "VERIFY", view: "done", take: 50 });
  check("archived view shows done items", doneBoard.rows.some((r) => r.id === keychain.id));

  console.log("5c) Full-form (modal) edit applies status transitions");
  await jos.update(actor, {
    id: created.id,
    joNumber: "VERIFY-NEW-1",
    isPO: false, isNonJo: true, customerName: "Verify Customer C",
    items: [
      {
        id: itemId,
        description: "Mug print",
        qty: "12",
        amount: "1000",
        isLFP: false,
        isRush: false,
        productionStatus: "Ongoing - Rework",
        remark: "full-form status change",
      },
      {
        id: keychain.id,
        description: "Extra keychains (engraved)",
        qty: "5",
        amount: "300",
        isLFP: false,
        isRush: false,
        // no productionStatus → stays archived, history untouched
      },
    ],
  });
  d = await jos.get(actor, created.id);
  const mug = d.items.find((i) => i.id === itemId)!;
  check(
    "full-form status change + remark in history",
    mug.productionStatus === "Ongoing - Rework" &&
      (mug.statusHistory ?? "").includes("full-form status change"),
    mug.statusHistory
  );
  check("reverted status un-archives + reopens JO", mug.archivedAt === null && d.status === "IN_PROGRESS", d.status);
  const keychainAfter = d.items.find((i) => i.id === keychain.id)!;
  check("untouched item keeps archive + history", keychainAfter.archivedAt !== null && !(keychainAfter.statusHistory ?? "").includes("full-form"));

  await jos.softDelete(actor, created.id);
  let gone = "";
  try {
    await jos.get(actor, created.id);
  } catch (e) {
    gone = e instanceof Error ? e.constructor.name : "";
  }
  check("soft-deleted JO hidden (NotFoundError)", gone === "NotFoundError", gone);

  const logs = await prisma.activityLog.count({
    where: { action: { in: ["create", "update", "status", "delete", "import"] } },
  });
  check("activity log rows written", logs > 0, logs);

  await cleanup();
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
