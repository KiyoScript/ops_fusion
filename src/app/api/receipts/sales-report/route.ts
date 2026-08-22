import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok, ValidationError } from "@/lib/errors";
import { sheetsToXlsx } from "@/lib/spreadsheet";
import { getReceiptService } from "@/modules/sales-audit/services";
import {
  RECEIPT_KIND_LABEL,
  salesReportFilters,
  type ReceiptKind,
  type SalesReportDto,
} from "@/modules/sales-audit/schemas/receipt";

// GET /api/receipts/sales-report?from=&to=&groupBy=&customerId=[&format=xlsx]
//
// Sales over any range, split VAT / Non-VAT / Charge / JO slip, with cash
// collected reported beside them and never inside them (R4).
export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const url = new URL(request.url);
    const params = Object.fromEntries(url.searchParams);
    const parsed = salesReportFilters.safeParse(params);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid date range."
      );
    }

    const report = await getReceiptService().getSalesReport(
      actor,
      parsed.data
    );

    if (url.searchParams.get("format") !== "xlsx") {
      return NextResponse.json(ok(report));
    }

    const bytes = await sheetsToXlsx(sheetsFor(report));
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="sales-${report.from}-to-${report.to}.xlsx"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}

const num = (v: string) => Number(v);

/**
 * Three tabs, because that is how the report is actually read: the summary
 * gets checked, the period breakdown gets charted, the customer breakdown gets
 * sorted. Money goes out as numbers so the totals the accountant adds in Excel
 * actually work.
 */
function sheetsFor(r: SalesReportDto) {
  // Only the kinds that book revenue go above the total, so the rows on the
  // Summary tab always add up to the GROSS SALES line. A JO slip paid in full
  // is one of them; slips tagged as downpayments, and collections, are listed
  // under the line and labelled.
  const kinds: ReceiptKind[] = [
    "SI_VAT",
    "SI_NON_VAT",
    "SI_CHARGE",
    "JO_RECEIPT",
  ];

  return [
    {
      name: "Summary",
      columns: ["", "Count", "Gross", "VAT-able", "Output VAT"],
      moneyColumns: [3, 4, 5],
      rows: [
        ...kinds.map((k) => [
          RECEIPT_KIND_LABEL[k],
          r.byType[k].count,
          num(r.byType[k].gross),
          num(r.byType[k].vatableSales),
          num(r.byType[k].vatAmount),
        ]),
        [],
        [
          "GROSS SALES",
          r.totals.count,
          num(r.totals.gross),
          num(r.totals.vatableSales),
          num(r.totals.vatAmount),
        ],
        [],
        // Kept below the total and labelled, never added into it.
        [
          "JO downpayments (deposits held, not revenue)",
          r.totals.depositCount,
          num(r.totals.deposits),
        ],
        [
          "Collections received (not revenue)",
          r.totals.collectionCount,
          num(r.totals.collected),
        ],
        ["Average per day", "", num(r.totals.averagePerDay)],
        [],
        ["Range", `${r.from} to ${r.to}`],
        ["Days", r.days],
      ],
    },
    {
      name: "By period",
      columns: ["Period", "Receipts", "Gross", "VAT-able", "Output VAT", "Collected"],
      moneyColumns: [3, 4, 5, 6],
      rows: r.byPeriod.map((p) => [
        p.label,
        p.count,
        num(p.gross),
        num(p.vatableSales),
        num(p.vatAmount),
        num(p.collected),
      ]),
    },
    {
      name: "By customer",
      columns: ["Customer", "Receipts", "Gross", "VAT-able", "Output VAT", "Share %"],
      moneyColumns: [3, 4, 5],
      rows: r.byCustomer.map((c) => [
        c.customerName,
        c.count,
        num(c.gross),
        num(c.vatableSales),
        num(c.vatAmount),
        c.sharePct,
      ]),
    },
  ];
}
