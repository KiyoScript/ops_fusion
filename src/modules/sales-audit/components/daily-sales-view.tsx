"use client";

import { toast } from "sonner";
import { useQueryState } from "nuqs";
import { CheckIcon, FlagIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ColorBadge } from "@/components/color-badge";
import {
  EmptyState,
  ErrorState,
  TableSkeletonRows,
} from "@/components/data-states";
import { useDebounce } from "@/modules/shared/hooks/use-debounce";
import { cn } from "@/lib/utils";
import { AuditFlagType } from "@/generated/prisma/enums";
import {
  RECEIPT_KIND,
  VOID_MARK,
  type ReceiptRowDto,
} from "../schemas/receipt";
import { useAuditReceipt, useDailyReceipts, useDailySummary } from "../hooks/use-sales-audit";

const peso = (v: string) => {
  const n = parseFloat(v);
  return isNaN(n)
    ? v
    : `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const COLS = 8;

/** The daily sales log — the legacy Sales_Transactions sheet, with the day's
 *  VAT / Non-VAT totals and the auditor's sign-off column. */
export function DailySalesView({ canAudit }: { canAudit: boolean }) {
  const [date, setDate] = useQueryState("date", { defaultValue: today() });
  const [q, setQ] = useQueryState("q", { defaultValue: "" });
  const debouncedQ = useDebounce(q);

  const list = useDailyReceipts(date, debouncedQ);
  const summary = useDailySummary(date);
  const rows = list.data?.rows ?? [];
  const s = summary.data;

  return (
    <div className="grid gap-4">
      {/* ——— the day's totals: VAT and Non-VAT reported separately ——— */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <SummaryCard
          label="VAT sales"
          value={s ? peso(s.vat.gross) : "—"}
          detail={
            s
              ? `net ${peso(s.vat.vatableSales)} · VAT ${peso(s.vat.vatAmount)}`
              : undefined
          }
          count={s?.vat.count}
        />
        <SummaryCard
          label="Non-VAT sales"
          value={s ? peso(s.nonVat.gross) : "—"}
          count={s?.nonVat.count}
        />
        {/* Credit sales are revenue the day they're invoiced — the money just
            hasn't arrived. Counted in gross sales; the Collection Receipt that
            settles them later is not. */}
        <SummaryCard
          label="Charge invoices"
          value={s ? peso(s.charge.gross) : "—"}
          detail={
            s
              ? `on credit · VAT ${peso(s.charge.vatAmount)}`
              : undefined
          }
          count={s?.charge.count}
        />
        {/* Every slip books what was handed over. The downpayment count is a
            label on the day's log, not a different kind of money. */}
        <SummaryCard
          label="JO receipts"
          value={s ? peso(s.joReceipts.gross) : "—"}
          detail={
            s && s.joDownpayments.count > 0
              ? `${s.joDownpayments.count} of them a downpayment`
              : undefined
          }
          count={s?.joReceipts.count}
        />
        <SummaryCard
          label="Collections"
          value={s ? peso(s.collections.gross) : "—"}
          detail="not counted as sales"
          count={s?.collections.count}
        />
        <SummaryCard
          label="Receivable"
          value={s ? peso(s.receivables.amount) : "—"}
          detail="unpaid on today's receipts"
          count={s?.receivables.count}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value || today())}
          className="max-w-44"
          aria-label="Sales date"
        />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search receipt no., customer, or JO…"
          className="max-w-72"
          aria-label="Search receipts"
        />
        <div className="ml-auto flex items-center gap-3 text-sm">
          {s && (
            <>
              <span className="text-muted-foreground">
                Gross sales{" "}
                <strong className="tabular-nums text-foreground">
                  {peso(s.grossSales)}
                </strong>
              </span>
              {/* Two different questions: what the books earned, and what the
                  drawer took. Deposits and collections separate them. */}
              <span className="text-muted-foreground">
                Cash in{" "}
                <strong className="tabular-nums text-foreground">
                  {peso(s.cashIn)}
                </strong>
              </span>
              {s.pendingAudit > 0 && (
                <ColorBadge
                  tone="amber"
                  label={`${s.pendingAudit} to verify`}
                />
              )}
            </>
          )}
        </div>
      </div>

      <Card className="py-0">
        <CardContent className="overflow-x-auto px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Receipt no.</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>JO</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">VAT</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Auditor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.isPending ? (
                <TableSkeletonRows cols={COLS} />
              ) : list.isError ? (
                <TableRow>
                  <TableCell colSpan={COLS}>
                    <ErrorState
                      message={list.error.message}
                      onRetry={() => list.refetch()}
                    />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={COLS}>
                    <EmptyState
                      title="No receipts on this day"
                      description="Receipts appear here as cashiers take payments on job orders."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <ReceiptRow
                    key={r.id}
                    row={r}
                    canAudit={canAudit}
                    onTrace={setQ}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * One half of a replacement pair, clickable.
 *
 * An auditor reconciling a booklet needs to walk from the spoiled receipt to
 * the one issued in its place and back. Clicking searches the day for that
 * serial, which is the fastest way to put the two side by side.
 */
function TraceLink({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded font-mono text-xs font-normal text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
    >
      {label}
    </button>
  );
}

function ReceiptRow({
  row,
  canAudit,
  onTrace,
}: {
  row: ReceiptRowDto;
  canAudit: boolean;
  /** Jump the day's search to a paired serial — the audit trail, walkable. */
  onTrace: (documentNo: string) => void;
}) {
  const audit = useAuditReceipt();
  const isCollection = row.kind === RECEIPT_KIND.COLLECTION;

  const target = isCollection
    ? { collectionReceiptId: row.id }
    : { saleId: row.id };

  const sign = (status: "REVIEWED" | "FLAGGED") => {
    if (status === "FLAGGED") {
      const remarks = window.prompt("What's wrong with this receipt?") ?? "";
      if (!remarks.trim()) return;
      audit.mutate(
        {
          ...target,
          status,
          flagType: AuditFlagType.DISCREPANCY,
          remarks,
        },
        {
          onSuccess: () => toast.success(`${row.documentNo} flagged.`),
          onError: (e: Error) => toast.error(e.message),
        }
      );
      return;
    }
    audit.mutate(
      { ...target, status },
      {
        onSuccess: () => toast.success(`${row.documentNo} verified.`),
        onError: (e: Error) => toast.error(e.message),
      }
    );
  };

  // A cancelled receipt is LISTED but not counted: every number in the booklet
  // has to be accounted for (docs/sales.txt §4 rule 3), so it stays visible,
  // struck through, with its reason on the row.
  const isVoid = row.voidType !== null;

  return (
    <TableRow className={cn(isVoid && "bg-destructive/5")}>
      <TableCell className="font-mono font-semibold tabular-nums">
        <span className={cn(isVoid && "text-muted-foreground line-through")}>
          {row.documentNo}
        </span>
        {isVoid && (
          <div className="mt-0.5 grid justify-items-start gap-0.5">
            <ColorBadge tone="red" label={VOID_MARK} />
            {/* The successor AND the reason — §5.1 asks for both: step 3 wants
                the two serials written on each other, step 2 wants the reason
                on the face of the receipt. Showing only the link left an
                auditor able to see what replaced it but never why. */}
            {row.replacedByDocumentNo && (
              <TraceLink
                label={`→ replaced by ${row.replacedByDocumentNo}`}
                onClick={() => onTrace(row.replacedByDocumentNo!)}
              />
            )}
            {row.voidReason && (
              <span className="max-w-52 text-xs font-normal text-muted-foreground">
                {row.voidReason}
              </span>
            )}
            {row.voidedByName && (
              <span className="text-xs font-normal text-muted-foreground">
                by {row.voidedByName}
              </span>
            )}
          </div>
        )}
        {/* The other half of the pair, on the receipt issued in its place. */}
        {row.replacesDocumentNo && (
          <div className="mt-0.5 grid justify-items-start">
            <TraceLink
              label={`↩ replaces ${row.replacesDocumentNo}`}
              onClick={() => onTrace(row.replacesDocumentNo!)}
            />
          </div>
        )}
      </TableCell>
      <TableCell>
        <ColorBadge
          tone={
            row.kind === RECEIPT_KIND.SI_VAT
              ? "blue"
              : row.kind === RECEIPT_KIND.SI_NON_VAT
                ? "purple"
                : row.kind === RECEIPT_KIND.SI_CHARGE
                  ? "amber"
                  : isCollection
                    ? "gray"
                    : "amber"
          }
          label={row.kindLabel}
        />
        {parseFloat(row.balanceDue) > 0 && (
          <div className="mt-0.5">
            <ColorBadge tone="amber" label={`${peso(row.balanceDue)} unpaid`} />
          </div>
        )}
      </TableCell>
      <TableCell>{row.customerName}</TableCell>
      <TableCell className="text-muted-foreground">
        {row.joNumber ?? "—"}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        <span className={cn(isVoid && "text-muted-foreground line-through")}>
          {peso(row.amount)}
        </span>
        {parseFloat(row.changeGiven) > 0 && (
          <div className="text-xs font-normal text-muted-foreground">
            tendered {peso(row.cashTendered ?? "0")} · change{" "}
            {peso(row.changeGiven)}
          </div>
        )}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {parseFloat(row.vatAmount) > 0 ? (
          <>
            {peso(row.vatAmount)}
            <div className="text-xs font-normal text-muted-foreground">
              net {peso(row.vatableSales)}
            </div>
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-sm">
        {/* A split tender is unreadable from the header method alone, so the
            lines are listed instead once there is more than one. */}
        {row.payments.length > 1 ? (
          <div className="grid gap-0.5">
            {row.payments.map((p, i) => (
              <span key={i} className="text-xs">
                {p.method}{" "}
                <span className="font-mono tabular-nums">{peso(p.amount)}</span>
                {p.reference && (
                  <span className="text-muted-foreground"> · {p.reference}</span>
                )}
              </span>
            ))}
          </div>
        ) : (
          <div className="grid gap-0.5">
            <span>{row.method ?? "—"}</span>
            {row.methodDetail && (
              <span className="text-xs text-muted-foreground">
                {row.methodDetail}
              </span>
            )}
          </div>
        )}
      </TableCell>
      <TableCell>
        {row.auditStatus ? (
          <div className="grid justify-items-start gap-0.5">
            <ColorBadge
              tone={row.auditStatus === "REVIEWED" ? "green" : "red"}
              label={row.auditStatus === "REVIEWED" ? "✓ Verified" : "⚑ Flagged"}
            />
            <span className="text-xs text-muted-foreground">
              {row.auditorName}
            </span>
            {row.auditRemarks && (
              <span className="max-w-44 text-xs text-muted-foreground">
                {row.auditRemarks}
              </span>
            )}
          </div>
        ) : isVoid ? (
          // A cancelled receipt is outside the auditor's sign-off: it counts
          // for nothing in the day's takings, and getDailySummary already
          // leaves it out of "to verify". Offering the button anyway would
          // book a review that no total ever reflects.
          <span className="text-sm text-muted-foreground">—</span>
        ) : canAudit ? (
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              disabled={audit.isPending}
              onClick={() => sign("REVIEWED")}
            >
              <CheckIcon /> Verify
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={audit.isPending}
              onClick={() => sign("FLAGGED")}
            >
              <FlagIcon />
            </Button>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">Not yet verified</span>
        )}
      </TableCell>
    </TableRow>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  count,
}: {
  label: string;
  value: string;
  detail?: string;
  count?: number;
}) {
  return (
    <Card>
      <CardContent className="grid gap-1 py-4">
        <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
          {count !== undefined && <span>· {count}</span>}
        </span>
        <span className="font-mono text-2xl font-semibold tabular-nums">
          {value}
        </span>
        {detail && (
          <span className="text-xs text-muted-foreground">{detail}</span>
        )}
      </CardContent>
    </Card>
  );
}
