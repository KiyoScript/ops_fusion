// ═══════════════════════════════════════════════════════════════════════════
// CHART OF ACCOUNTS — the shop's book of accounts, as pure data.
//
// Authored and owned by the FINANCE / AR track. The Ledger & Payables track
// CONSUMES this: seed `Account` rows from `CHART_OF_ACCOUNTS`, then post
// against the codes. Nobody edits this file to add an account they happen to
// need — request it, so the tree, the statements and the BIR books stay in
// agreement. See docs/chart-of-accounts.md for the reasoning behind each
// group and docs/ledger-interface.md for the posting rules that use them.
//
// Pure data, no Prisma import — safe on client and server, and usable before
// the `Account` model exists. Same pattern as src/lib/modules.ts.
//
// CODE SCHEME — four digits, grouped by statement position:
//   1xxx Assets      2xxx Liabilities   3xxx Equity
//   4xxx Revenue     5xxx Cost of Sales 6xxx Operating & Other Expenses
// A code ending in 00 is a HEADER (rollup) — never postable. Postable
// accounts sit under it. Codes are stable identifiers: the posting API takes
// `account: "1030"`, never a cuid, so posting rules stay readable and survive
// a re-seed.
// ═══════════════════════════════════════════════════════════════════════════

export type AccountType =
  | "ASSET"
  | "LIABILITY"
  | "EQUITY"
  | "REVENUE"
  | "EXPENSE";

export type NormalBalance = "DEBIT" | "CREDIT";

export type AccountDef = {
  code: string;
  name: string;
  type: AccountType;
  /** Normally derived from `type`, but stated explicitly because CONTRA
   *  accounts invert it — Accumulated Depreciation is an ASSET that carries a
   *  CREDIT balance, Sales Discounts a REVENUE that carries a DEBIT one. */
  normalBalance: NormalBalance;
  /** Header/rollup accounts group the tree and never take a journal line. */
  isPostable: boolean;
  /** Parent header's code. Null only for the six top-level headers. */
  parent: string | null;
  /** True when the account's balance is subtracted from its parent group. */
  isContra?: boolean;
  /** Which track's postings land here. Governs who may add sub-accounts. */
  owner?: "ar" | "ap" | "inventory" | "shared";
  /** Why this account exists / what posts to it. Shown in Maintenance. */
  note?: string;
};

export const CHART_OF_ACCOUNTS: AccountDef[] = [
  // ══════════════════════════════════════════════════════════════════════
  // 1000 — ASSETS
  // ══════════════════════════════════════════════════════════════════════
  { code: "1000", name: "Assets", type: "ASSET", normalBalance: "DEBIT", isPostable: false, parent: null },

  { code: "1100", name: "Current Assets", type: "ASSET", normalBalance: "DEBIT", isPostable: false, parent: "1000" },

  // — cash —
  { code: "1110", name: "Cash on Hand", type: "ASSET", normalBalance: "DEBIT", isPostable: true, parent: "1100", owner: "shared",
    note: "The counter drawer. Cash sales and cash collections debit this." },
  { code: "1111", name: "Petty Cash Fund", type: "ASSET", normalBalance: "DEBIT", isPostable: true, parent: "1100", owner: "ap",
    note: "Imprest fund. Replenishment credits cash in bank, not this." },
  { code: "1112", name: "Undeposited Collections", type: "ASSET", normalBalance: "DEBIT", isPostable: true, parent: "1100", owner: "shared",
    note: "Cash counted at close but not yet at the bank. Cleared by the deposit — this is what ReconciliationDay.depositAmount settles." },
  { code: "1120", name: "Cash in Bank", type: "ASSET", normalBalance: "DEBIT", isPostable: false, parent: "1100",
    note: "Header. One postable sub-account per real bank account, mapped 1:1 to a CashAccount row." },
  { code: "1121", name: "Cash in Bank — Primary Account", type: "ASSET", normalBalance: "DEBIT", isPostable: true, parent: "1120", owner: "shared" },
  { code: "1122", name: "Cash in Bank — Secondary Account", type: "ASSET", normalBalance: "DEBIT", isPostable: true, parent: "1120", owner: "shared" },
  { code: "1130", name: "E-Wallet — GCash", type: "ASSET", normalBalance: "DEBIT", isPostable: true, parent: "1100", owner: "shared",
    note: "GCash and QR collections land here, not in Cash on Hand." },

  // — receivables —
  { code: "1140", name: "Accounts Receivable — Trade", type: "ASSET", normalBalance: "DEBIT", isPostable: true, parent: "1100", owner: "ar",
    note: "Charge invoices and the unpaid part of partial sales. Carries the customerId dimension — this is the GL side of the A/R aging." },
  { code: "1141", name: "Accounts Receivable — Non-Trade", type: "ASSET", normalBalance: "DEBIT", isPostable: true, parent: "1100", owner: "ar",
    note: "Amounts owed that did not arise from a sale." },
  { code: "1142", name: "Unbilled Receivables (Contract Assets)", type: "ASSET", normalBalance: "DEBIT", isPostable: true, parent: "1100", owner: "ar",
    note: "Work DELIVERED but not yet invoiced. Earned revenue with no document raised against it yet — cleared to 1140 when the invoice is issued. Carries customerId and jobOrderId. NOT for jobs still in production: those are backlog, not an asset, and post nothing." },
  { code: "1145", name: "Allowance for Doubtful Accounts", type: "ASSET", normalBalance: "CREDIT", isPostable: true, parent: "1100", isContra: true, owner: "ar",
    note: "Contra. Paired with 6900 Bad Debts Expense." },
  { code: "1150", name: "Advances to Employees", type: "ASSET", normalBalance: "DEBIT", isPostable: true, parent: "1100", owner: "ap" },
  { code: "1155", name: "Advances to Suppliers", type: "ASSET", normalBalance: "DEBIT", isPostable: true, parent: "1100", owner: "ap",
    note: "Downpayments made to suppliers before the bill arrives." },

  // — tax assets —
  { code: "1160", name: "Creditable Withholding Tax Receivable", type: "ASSET", normalBalance: "DEBIT", isPostable: true, parent: "1100", owner: "ar",
    note: "INCOME tax our customers withhold from us (1% goods / 2% services), supported by the BIR 2307 they issue. THIS is what lets a receivable close when a corporate customer pays net. Claimed against our income tax." },
  { code: "1161", name: "Creditable Withholding VAT", type: "ASSET", normalBalance: "DEBIT", isPostable: true, parent: "1100", owner: "ar",
    note: "The 5% VAT government, LGUs, public schools and GOCCs withhold on their purchases, supported by the BIR 2306. Creditable rather than final since 1 Jan 2021 (RMC 36-2021), so it is an asset claimed against Output VAT (2130) — NOT the same thing as 1160, which is income tax, and never merged with it." },
  { code: "1165", name: "Input VAT", type: "ASSET", normalBalance: "DEBIT", isPostable: true, parent: "1100", owner: "ap",
    note: "VAT on purchases, creditable against Output VAT (2130)." },
  { code: "1166", name: "Deferred Input VAT", type: "ASSET", normalBalance: "DEBIT", isPostable: true, parent: "1100", owner: "ap",
    note: "Input VAT not yet claimable — e.g. amortised capital goods." },

  // — inventory —
  { code: "1170", name: "Inventory", type: "ASSET", normalBalance: "DEBIT", isPostable: false, parent: "1100",
    note: "Header. Sub-accounts mirror Material.category so the stock ledger maps cleanly." },
  { code: "1171", name: "Inventory — Paper & Board", type: "ASSET", normalBalance: "DEBIT", isPostable: true, parent: "1170", owner: "inventory" },
  { code: "1172", name: "Inventory — Ink & Chemicals", type: "ASSET", normalBalance: "DEBIT", isPostable: true, parent: "1170", owner: "inventory" },
  { code: "1173", name: "Inventory — Plates & Consumables", type: "ASSET", normalBalance: "DEBIT", isPostable: true, parent: "1170", owner: "inventory" },
  { code: "1174", name: "Inventory — Large Format Media", type: "ASSET", normalBalance: "DEBIT", isPostable: true, parent: "1170", owner: "inventory" },
  { code: "1175", name: "Inventory — Merchandise & Supplies for Resale", type: "ASSET", normalBalance: "DEBIT", isPostable: true, parent: "1170", owner: "inventory" },
  { code: "1180", name: "Work in Process", type: "ASSET", normalBalance: "DEBIT", isPostable: true, parent: "1100", owner: "inventory",
    note: "Materials released to a job order. Carries the jobOrderId dimension — this is what makes per-job costing answerable. Cleared to Cost of Sales on completion." },

  // — prepayments —
  { code: "1190", name: "Prepaid Expenses", type: "ASSET", normalBalance: "DEBIT", isPostable: false, parent: "1100" },
  { code: "1191", name: "Prepaid Rent", type: "ASSET", normalBalance: "DEBIT", isPostable: true, parent: "1190", owner: "ap" },
  { code: "1192", name: "Prepaid Insurance", type: "ASSET", normalBalance: "DEBIT", isPostable: true, parent: "1190", owner: "ap" },
  { code: "1193", name: "Prepaid Taxes & Licenses", type: "ASSET", normalBalance: "DEBIT", isPostable: true, parent: "1190", owner: "ap" },

  // — non-current —
  { code: "1200", name: "Non-Current Assets", type: "ASSET", normalBalance: "DEBIT", isPostable: false, parent: "1000" },
  { code: "1210", name: "Printing Equipment", type: "ASSET", normalBalance: "DEBIT", isPostable: true, parent: "1200", owner: "ap" },
  { code: "1211", name: "Accumulated Depreciation — Printing Equipment", type: "ASSET", normalBalance: "CREDIT", isPostable: true, parent: "1200", isContra: true, owner: "ap" },
  { code: "1220", name: "Office Equipment & Computers", type: "ASSET", normalBalance: "DEBIT", isPostable: true, parent: "1200", owner: "ap" },
  { code: "1221", name: "Accumulated Depreciation — Office Equipment", type: "ASSET", normalBalance: "CREDIT", isPostable: true, parent: "1200", isContra: true, owner: "ap" },
  { code: "1230", name: "Furniture & Fixtures", type: "ASSET", normalBalance: "DEBIT", isPostable: true, parent: "1200", owner: "ap" },
  { code: "1231", name: "Accumulated Depreciation — Furniture & Fixtures", type: "ASSET", normalBalance: "CREDIT", isPostable: true, parent: "1200", isContra: true, owner: "ap" },
  { code: "1240", name: "Vehicles", type: "ASSET", normalBalance: "DEBIT", isPostable: true, parent: "1200", owner: "ap" },
  { code: "1241", name: "Accumulated Depreciation — Vehicles", type: "ASSET", normalBalance: "CREDIT", isPostable: true, parent: "1200", isContra: true, owner: "ap" },
  { code: "1250", name: "Leasehold Improvements", type: "ASSET", normalBalance: "DEBIT", isPostable: true, parent: "1200", owner: "ap" },
  { code: "1251", name: "Accumulated Amortization — Leasehold Improvements", type: "ASSET", normalBalance: "CREDIT", isPostable: true, parent: "1200", isContra: true, owner: "ap" },
  { code: "1260", name: "Security & Rental Deposits", type: "ASSET", normalBalance: "DEBIT", isPostable: true, parent: "1200", owner: "ap" },

  // ══════════════════════════════════════════════════════════════════════
  // 2000 — LIABILITIES
  // ══════════════════════════════════════════════════════════════════════
  { code: "2000", name: "Liabilities", type: "LIABILITY", normalBalance: "CREDIT", isPostable: false, parent: null },

  { code: "2100", name: "Current Liabilities", type: "LIABILITY", normalBalance: "CREDIT", isPostable: false, parent: "2000" },

  // — payables —
  { code: "2110", name: "Accounts Payable — Trade", type: "LIABILITY", normalBalance: "CREDIT", isPostable: true, parent: "2100", owner: "ap",
    note: "Supplier bills. Carries the supplierId dimension — the GL side of AP aging." },
  { code: "2111", name: "Accounts Payable — Non-Trade", type: "LIABILITY", normalBalance: "CREDIT", isPostable: true, parent: "2100", owner: "ap" },
  { code: "2115", name: "Goods Received Not Invoiced", type: "LIABILITY", normalBalance: "CREDIT", isPostable: true, parent: "2100", owner: "ap",
    note: "GRNI. Receiving debits Inventory and credits this; the supplier bill clears it to 2110. Closes the gap between stock arriving and the invoice arriving." },

  // — customer money we hold —
  { code: "2120", name: "Customer Advances", type: "LIABILITY", normalBalance: "CREDIT", isPostable: true, parent: "2100", owner: "ar",
    note: "The AdvancePayment subledger. Money held FOR a customer — the opposite sign to A/R, and never netted against it." },
  { code: "2121", name: "Customer Deposits — Job Order Downpayments", type: "LIABILITY", normalBalance: "CREDIT", isPostable: true, parent: "2100", owner: "ar",
    note: "DECIDED 2026-08-19: the JO_SLIP is an ACKNOWLEDGEMENT receipt, not a sale, so a downpayment lands here as a liability and books no revenue. Drawn down when the invoice is issued. The daily sales log still shows the cash — that is a cash log and unchanged." },

  // — taxes —
  { code: "2130", name: "Output VAT", type: "LIABILITY", normalBalance: "CREDIT", isPostable: true, parent: "2100", owner: "ar",
    note: "12% backed out of every VAT invoice. Netted against Input VAT (1165) into VAT Payable at filing." },
  { code: "2131", name: "Deferred Output VAT", type: "LIABILITY", normalBalance: "CREDIT", isPostable: true, parent: "2100", owner: "ar" },
  { code: "2132", name: "VAT Payable", type: "LIABILITY", normalBalance: "CREDIT", isPostable: true, parent: "2100", owner: "shared",
    note: "The net figure filed on 2550M / 2550Q." },
  { code: "2133", name: "Percentage Tax Payable", type: "LIABILITY", normalBalance: "CREDIT", isPostable: true, parent: "2100", owner: "shared",
    note: "Non-VAT sales, where applicable." },
  { code: "2140", name: "Withholding Tax Payable — Expanded", type: "LIABILITY", normalBalance: "CREDIT", isPostable: true, parent: "2100", owner: "ap",
    note: "EWT WE withhold from suppliers and remit on 1601-EQ. The mirror image of 1160 — do not confuse the two." },
  { code: "2141", name: "Withholding Tax Payable — Compensation", type: "LIABILITY", normalBalance: "CREDIT", isPostable: true, parent: "2100", owner: "ap",
    note: "From the payroll journal import. 1601-C." },
  { code: "2142", name: "Withholding Tax Payable — Final", type: "LIABILITY", normalBalance: "CREDIT", isPostable: true, parent: "2100", owner: "ap" },
  { code: "2145", name: "Income Tax Payable", type: "LIABILITY", normalBalance: "CREDIT", isPostable: true, parent: "2100", owner: "shared" },

  // — payroll-related (posted from the separate payroll system) —
  { code: "2150", name: "Salaries & Wages Payable", type: "LIABILITY", normalBalance: "CREDIT", isPostable: true, parent: "2100", owner: "ap" },
  { code: "2151", name: "SSS Payable", type: "LIABILITY", normalBalance: "CREDIT", isPostable: true, parent: "2100", owner: "ap" },
  { code: "2152", name: "PhilHealth Payable", type: "LIABILITY", normalBalance: "CREDIT", isPostable: true, parent: "2100", owner: "ap" },
  { code: "2153", name: "Pag-IBIG Payable", type: "LIABILITY", normalBalance: "CREDIT", isPostable: true, parent: "2100", owner: "ap" },

  { code: "2160", name: "Accrued Expenses", type: "LIABILITY", normalBalance: "CREDIT", isPostable: true, parent: "2100", owner: "ap" },
  { code: "2170", name: "Loans Payable — Current Portion", type: "LIABILITY", normalBalance: "CREDIT", isPostable: true, parent: "2100", owner: "ap" },

  { code: "2200", name: "Non-Current Liabilities", type: "LIABILITY", normalBalance: "CREDIT", isPostable: false, parent: "2000" },
  { code: "2210", name: "Loans Payable — Non-Current", type: "LIABILITY", normalBalance: "CREDIT", isPostable: true, parent: "2200", owner: "ap" },

  // ══════════════════════════════════════════════════════════════════════
  // 3000 — EQUITY
  // ══════════════════════════════════════════════════════════════════════
  { code: "3000", name: "Equity", type: "EQUITY", normalBalance: "CREDIT", isPostable: false, parent: null },
  { code: "3010", name: "Owner's Capital", type: "EQUITY", normalBalance: "CREDIT", isPostable: true, parent: "3000", owner: "shared" },
  { code: "3020", name: "Owner's Drawings", type: "EQUITY", normalBalance: "DEBIT", isPostable: true, parent: "3000", isContra: true, owner: "shared" },
  { code: "3030", name: "Retained Earnings", type: "EQUITY", normalBalance: "CREDIT", isPostable: true, parent: "3000", owner: "shared",
    note: "Rolled by the year-end closing entry. Never posted to by hand during the year." },
  { code: "3040", name: "Income Summary", type: "EQUITY", normalBalance: "CREDIT", isPostable: true, parent: "3000", owner: "shared",
    note: "Closing-entry clearing account. Zero at every other moment." },

  // ══════════════════════════════════════════════════════════════════════
  // 4000 — REVENUE
  // ══════════════════════════════════════════════════════════════════════
  { code: "4000", name: "Revenue", type: "REVENUE", normalBalance: "CREDIT", isPostable: false, parent: null },

  { code: "4100", name: "Sales — VAT", type: "REVENUE", normalBalance: "CREDIT", isPostable: false, parent: "4000",
    note: "The IN series. Appears in BIR-facing books. Sub-accounts follow the shop's service lines so revenue-by-product needs no join." },
  { code: "4110", name: "Sales — Offset Printing", type: "REVENUE", normalBalance: "CREDIT", isPostable: true, parent: "4100", owner: "ar" },
  { code: "4120", name: "Sales — Digital Printing", type: "REVENUE", normalBalance: "CREDIT", isPostable: true, parent: "4100", owner: "ar" },
  { code: "4130", name: "Sales — Large Format", type: "REVENUE", normalBalance: "CREDIT", isPostable: true, parent: "4100", owner: "ar" },
  { code: "4140", name: "Sales — Newspaper & Publication", type: "REVENUE", normalBalance: "CREDIT", isPostable: true, parent: "4100", owner: "ar" },
  { code: "4150", name: "Sales — Photocopy & Walk-in Services", type: "REVENUE", normalBalance: "CREDIT", isPostable: true, parent: "4100", owner: "ar" },
  { code: "4160", name: "Sales — Finishing & Bindery", type: "REVENUE", normalBalance: "CREDIT", isPostable: true, parent: "4100", owner: "ar",
    note: "Lamination, binding, cutting, mounting." },
  { code: "4170", name: "Sales — Supplies & Merchandise", type: "REVENUE", normalBalance: "CREDIT", isPostable: true, parent: "4100", owner: "ar" },
  { code: "4180", name: "Sales — Zero-Rated", type: "REVENUE", normalBalance: "CREDIT", isPostable: true, parent: "4100", owner: "ar" },
  { code: "4190", name: "Sales — VAT-Exempt", type: "REVENUE", normalBalance: "CREDIT", isPostable: true, parent: "4100", owner: "ar" },

  { code: "4200", name: "Sales — Non-VAT", type: "REVENUE", normalBalance: "CREDIT", isPostable: false, parent: "4000",
    note: "The NV series. DECIDED 2026-08-19: the NV booklets are NOT BIR-registered, so this whole branch posts with LedgerScope.INTERNAL — it appears in management reports and never in anything the accountant files." },
  { code: "4210", name: "Sales — Non-VAT, Printing", type: "REVENUE", normalBalance: "CREDIT", isPostable: true, parent: "4200", owner: "ar" },
  { code: "4220", name: "Sales — Non-VAT, Services", type: "REVENUE", normalBalance: "CREDIT", isPostable: true, parent: "4200", owner: "ar" },

  { code: "4300", name: "Revenue Deductions", type: "REVENUE", normalBalance: "DEBIT", isPostable: false, parent: "4000", isContra: true,
    note: "Contra-revenue. Kept separate rather than netted into sales, because BIR reports and the accountant both want gross sales and the deductions shown apart." },
  { code: "4310", name: "Sales Returns & Allowances", type: "REVENUE", normalBalance: "DEBIT", isPostable: true, parent: "4300", isContra: true, owner: "ar",
    note: "Credit memos. The partial-reversal path voiding cannot express." },
  { code: "4320", name: "Sales Discounts", type: "REVENUE", normalBalance: "DEBIT", isPostable: true, parent: "4300", isContra: true, owner: "ar",
    note: "Negotiated price reductions recorded on the invoice." },
  { code: "4330", name: "Senior Citizen & PWD Discounts", type: "REVENUE", normalBalance: "DEBIT", isPostable: true, parent: "4300", isContra: true, owner: "ar",
    note: "Statutory 20%. Kept in its OWN account, never merged with 4320 — BIR wants it reported separately and it carries a VAT exemption." },

  { code: "4900", name: "Other Income", type: "REVENUE", normalBalance: "CREDIT", isPostable: false, parent: "4000" },
  { code: "4910", name: "Interest Income", type: "REVENUE", normalBalance: "CREDIT", isPostable: true, parent: "4900", owner: "shared" },
  { code: "4920", name: "Gain on Disposal of Assets", type: "REVENUE", normalBalance: "CREDIT", isPostable: true, parent: "4900", owner: "ap" },
  { code: "4990", name: "Miscellaneous Income", type: "REVENUE", normalBalance: "CREDIT", isPostable: true, parent: "4900", owner: "shared" },

  // ══════════════════════════════════════════════════════════════════════
  // 5000 — COST OF SALES
  // ══════════════════════════════════════════════════════════════════════
  { code: "5000", name: "Cost of Sales", type: "EXPENSE", normalBalance: "DEBIT", isPostable: false, parent: null,
    note: "What it cost to produce what was sold. Kept apart from 6000 operating expenses so gross margin is readable — the number that tells the shop whether its pricing works." },
  { code: "5100", name: "Materials Used", type: "EXPENSE", normalBalance: "DEBIT", isPostable: false, parent: "5000" },
  { code: "5110", name: "Materials Used — Paper & Board", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "5100", owner: "inventory" },
  { code: "5120", name: "Materials Used — Ink & Chemicals", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "5100", owner: "inventory" },
  { code: "5130", name: "Materials Used — Plates & Consumables", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "5100", owner: "inventory" },
  { code: "5140", name: "Materials Used — Large Format Media", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "5100", owner: "inventory" },
  { code: "5150", name: "Cost of Merchandise Sold", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "5100", owner: "inventory" },
  { code: "5200", name: "Direct Labor", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "5000", owner: "ap",
    note: "Production wages. From the payroll journal import, split out of 6110." },
  { code: "5300", name: "Subcontracted Printing", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "5000", owner: "ap",
    note: "Work farmed out to another shop. Carries the jobOrderId dimension." },
  { code: "5400", name: "Production Overhead", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "5000", owner: "shared",
    note: "Machine time, production electricity, plate processing — the allocated pool that turns material cost into true job cost." },
  { code: "5500", name: "Freight In", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "5000", owner: "ap" },
  { code: "5600", name: "Spoilage & Rework", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "5000", owner: "inventory",
    note: "Reprints and misprints. Worth its own account — it is a quality metric as much as a cost." },
  { code: "5700", name: "Inventory Variance", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "5000", owner: "inventory",
    note: "Cycle-count and adjustment differences from the stock ledger." },

  // ══════════════════════════════════════════════════════════════════════
  // 6000 — OPERATING & OTHER EXPENSES
  // ══════════════════════════════════════════════════════════════════════
  { code: "6000", name: "Operating Expenses", type: "EXPENSE", normalBalance: "DEBIT", isPostable: false, parent: null },

  { code: "6100", name: "Personnel", type: "EXPENSE", normalBalance: "DEBIT", isPostable: false, parent: "6000" },
  { code: "6110", name: "Salaries & Wages — Administrative", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "6100", owner: "ap" },
  { code: "6120", name: "SSS / PhilHealth / Pag-IBIG — Employer Share", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "6100", owner: "ap" },
  { code: "6130", name: "13th Month Pay", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "6100", owner: "ap" },
  { code: "6140", name: "Employee Benefits & Allowances", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "6100", owner: "ap" },
  { code: "6150", name: "Training & Seminars", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "6100", owner: "ap" },

  { code: "6200", name: "Occupancy", type: "EXPENSE", normalBalance: "DEBIT", isPostable: false, parent: "6000" },
  { code: "6210", name: "Rent", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "6200", owner: "ap" },
  { code: "6220", name: "Electricity", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "6200", owner: "ap" },
  { code: "6230", name: "Water", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "6200", owner: "ap" },
  { code: "6240", name: "Telephone & Internet", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "6200", owner: "ap" },
  { code: "6250", name: "Security Services", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "6200", owner: "ap" },
  { code: "6260", name: "Janitorial & Sanitation", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "6200", owner: "ap" },

  { code: "6300", name: "Repairs & Maintenance", type: "EXPENSE", normalBalance: "DEBIT", isPostable: false, parent: "6000" },
  { code: "6310", name: "Repairs & Maintenance — Equipment", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "6300", owner: "ap" },
  { code: "6320", name: "Repairs & Maintenance — Building", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "6300", owner: "ap" },
  { code: "6330", name: "Repairs & Maintenance — Vehicles", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "6300", owner: "ap" },

  { code: "6400", name: "Selling & Distribution", type: "EXPENSE", normalBalance: "DEBIT", isPostable: false, parent: "6000" },
  { code: "6410", name: "Fuel & Transportation", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "6400", owner: "ap" },
  { code: "6420", name: "Delivery & Freight Out", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "6400", owner: "ap" },
  { code: "6430", name: "Advertising & Marketing", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "6400", owner: "ap" },
  { code: "6440", name: "Representation & Entertainment", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "6400", owner: "ap" },

  { code: "6500", name: "Administrative", type: "EXPENSE", normalBalance: "DEBIT", isPostable: false, parent: "6000" },
  { code: "6510", name: "Office Supplies", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "6500", owner: "ap" },
  { code: "6520", name: "Taxes & Licenses", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "6500", owner: "ap",
    note: "Business permits, BIR registration, community tax." },
  { code: "6530", name: "Professional Fees", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "6500", owner: "ap",
    note: "Accountant, lawyer, consultants — usually subject to EWT (2140) on payment." },
  { code: "6540", name: "Bank Charges", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "6500", owner: "ap",
    note: "Includes the penalty charged on a bounced customer cheque." },
  { code: "6550", name: "Insurance", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "6500", owner: "ap" },
  { code: "6560", name: "Software & Subscriptions", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "6500", owner: "ap" },
  { code: "6590", name: "Miscellaneous Expense", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "6500", owner: "ap",
    note: "Keep this small. A large miscellaneous balance means an account is missing." },

  { code: "6600", name: "Depreciation & Amortization", type: "EXPENSE", normalBalance: "DEBIT", isPostable: false, parent: "6000" },
  { code: "6610", name: "Depreciation Expense", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "6600", owner: "ap" },
  { code: "6620", name: "Amortization Expense", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "6600", owner: "ap" },

  { code: "6900", name: "Other Expenses", type: "EXPENSE", normalBalance: "DEBIT", isPostable: false, parent: "6000" },
  { code: "6910", name: "Bad Debts Expense", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "6900", owner: "ar",
    note: "Paired with 1145. A written-off receivable — never a deleted one." },
  { code: "6920", name: "Interest Expense", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "6900", owner: "ap" },
  { code: "6930", name: "Loss on Disposal of Assets", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "6900", owner: "ap" },
  { code: "6940", name: "Penalties & Surcharges", type: "EXPENSE", normalBalance: "DEBIT", isPostable: true, parent: "6900", owner: "ap",
    note: "BIR and regulatory penalties. Kept visible on purpose." },
];

// ───────────────────────────────────────────────────────────────────────────
// Named handles for the accounts posting rules reference by name rather than
// by a magic string. Import these instead of typing "1140" in a service.
// ───────────────────────────────────────────────────────────────────────────
export const ACCOUNT = {
  CASH_ON_HAND: "1110",
  PETTY_CASH: "1111",
  UNDEPOSITED: "1112",
  GCASH: "1130",
  AR_TRADE: "1140",
  UNBILLED_AR: "1142",
  ALLOWANCE_DOUBTFUL: "1145",
  CWT_RECEIVABLE: "1160",
  CREDITABLE_VAT_WITHHELD: "1161",
  INPUT_VAT: "1165",
  WIP: "1180",
  AP_TRADE: "2110",
  GRNI: "2115",
  CUSTOMER_ADVANCES: "2120",
  CUSTOMER_DEPOSITS: "2121",
  OUTPUT_VAT: "2130",
  EWT_PAYABLE: "2140",
  RETAINED_EARNINGS: "3030",
  INCOME_SUMMARY: "3040",
  SALES_RETURNS: "4310",
  SALES_DISCOUNTS: "4320",
  SC_PWD_DISCOUNTS: "4330",
  BAD_DEBTS: "6910",
  BANK_CHARGES: "6540",
} as const;

// ───────────────────────────────────────────────────────────────────────────
// Helpers — pure, no I/O. Used by the seed, the Maintenance screen, and the
// financial statements, so the tree is walked the same way everywhere.
// ───────────────────────────────────────────────────────────────────────────

/** Every account whose parent chain includes `code`, itself excluded. */
export function descendantsOf(code: string): AccountDef[] {
  const out: AccountDef[] = [];
  const walk = (parent: string) => {
    for (const a of CHART_OF_ACCOUNTS) {
      if (a.parent === parent) {
        out.push(a);
        walk(a.code);
      }
    }
  };
  walk(code);
  return out;
}

/** The accounts a journal line may actually reference. */
export const POSTABLE_ACCOUNTS = CHART_OF_ACCOUNTS.filter((a) => a.isPostable);

/** Lookup by code. Returns undefined for an unknown code — callers reject. */
export function accountByCode(code: string): AccountDef | undefined {
  return CHART_OF_ACCOUNTS.find((a) => a.code === code);
}

/**
 * Structural self-check. Run it in the seed and in verify scripts: a typo in a
 * `parent` code produces an orphan that silently drops a whole branch out of
 * the balance sheet, and nothing else would catch it.
 */
export function validateChart(): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const a of CHART_OF_ACCOUNTS) {
    if (seen.has(a.code)) errors.push(`Duplicate account code: ${a.code}`);
    seen.add(a.code);

    if (a.parent !== null && !CHART_OF_ACCOUNTS.some((p) => p.code === a.parent)) {
      errors.push(`${a.code} (${a.name}) has unknown parent ${a.parent}`);
    }
    if (a.parent !== null) {
      const parent = CHART_OF_ACCOUNTS.find((p) => p.code === a.parent)!;
      if (parent.isPostable) {
        errors.push(`${a.code} sits under ${a.parent}, which is postable — a parent must be a header`);
      }
      if (parent.type !== a.type) {
        errors.push(`${a.code} is ${a.type} but its parent ${a.parent} is ${parent.type}`);
      }
    }
    // Contra accounts are the only ones allowed to invert their type's
    // normal balance. Anything else is a data-entry slip.
    const expected: NormalBalance =
      a.type === "ASSET" || a.type === "EXPENSE" ? "DEBIT" : "CREDIT";
    if (a.normalBalance !== expected && !a.isContra) {
      errors.push(`${a.code} is ${a.type} with a ${a.normalBalance} balance but is not marked isContra`);
    }
  }
  return errors;
}
