import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { PencilIcon, PrinterIcon } from "lucide-react";
import { requireActor } from "@/lib/authz";
import { defineAbilityFor } from "@/lib/ability";
import { NotFoundError } from "@/lib/errors";
import { PageHeader } from "@/components/page-header";
import { BackButton } from "@/components/back-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getQuotationService } from "@/modules/quotations/services";
import type { QuotationDetailDto } from "@/modules/quotations/schemas/quotation";
import { QuotationStatusBadge } from "@/modules/quotations/components/quotation-status-badge";
import { QuotationStatusActions } from "@/modules/quotations/components/quotation-status-actions";

export const metadata: Metadata = { title: "Quotation" };

const EDITABLE_STATUSES = ["DRAFT", "PENDING_APPROVAL", "REJECTED"];

export default async function QuotationDetailPage({
  params,
}: {
  params: Promise<{ quotationId: string }>;
}) {
  const actor = await requireActor();
  const ability = defineAbilityFor(actor);
  const { quotationId } = await params;

  let detail: QuotationDetailDto;
  try {
    detail = await getQuotationService().get(actor, quotationId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  const canUpdate = ability.can("update", "Quotation");
  const editable = canUpdate && EDITABLE_STATUSES.includes(detail.status);

  return (
    <>
      <BackButton fallbackHref="/quotations" label="Quotations" />
      <PageHeader
        title={detail.quoteNumber}
        description={`Quotation for ${detail.customer.name}`}
      />

      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <QuotationStatusBadge
            status={detail.status}
            isExpired={detail.isExpired}
          />
          {detail.convertedJoNumber && (
            <span className="text-sm text-muted-foreground">
              Converted to JO{" "}
              <span className="font-medium text-foreground">
                {detail.convertedJoNumber}
              </span>
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              nativeButton={false}
              render={
                <a
                  href={`/api/quotations/${detail.id}/pdf`}
                  target="_blank"
                  rel="noopener"
                />
              }
            >
              <PrinterIcon /> Print PDF
            </Button>
            {editable && (
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link href={`/quotations/${detail.id}/edit`} />}
              >
                <PencilIcon /> Edit
              </Button>
            )}
          </div>
        </div>

        {detail.status === "REJECTED" && detail.rejectedReason && (
          <Card className="border-destructive/50">
            <CardContent className="text-sm">
              <p className="font-medium text-destructive">Rejected</p>
              <p className="mt-1 text-muted-foreground">
                {detail.rejectedReason}
              </p>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          <Card className="py-0">
            <CardContent className="overflow-x-auto px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead className="min-w-64">Description</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit price</TableHead>
                    <TableHead className="text-right">Less</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.items.map((item, index) => (
                    <TableRow key={item.id}>
                      <TableCell className="text-muted-foreground">
                        {index + 1}
                      </TableCell>
                      <TableCell className="whitespace-pre-wrap">
                        {item.description}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {item.qty}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {php(item.unitPrice)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {parseFloat(item.discount) > 0 ? php(item.discount) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {php(item.lineTotal)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid h-fit gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Totals</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-1.5 text-sm">
                <Row label="Subtotal" value={php(detail.totals.subtotal)} />
                {parseFloat(detail.totals.discount) > 0 && (
                  <Row
                    label="Discount"
                    value={`− ${php(detail.totals.discount)}`}
                  />
                )}
                {detail.totals.taxType === "VAT_EXCLUSIVE" && (
                  <Row label="VAT (12%)" value={php(detail.totals.taxAmount)} />
                )}
                {detail.totals.taxType === "VAT_INCLUSIVE" && (
                  <Row
                    label="VAT included (12%)"
                    value={php(detail.totals.taxAmount)}
                  />
                )}
                <Separator className="my-1" />
                <Row label="Total" value={php(detail.totals.total)} strong />
                <Row
                  label={detail.totals.paymentTermLabel ?? "Downpayment"}
                  value={php(detail.totals.downpayment)}
                />
                <Row label="Balance" value={php(detail.totals.balance)} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-1.5 text-sm">
                <Row label="Customer" value={detail.customer.name} />
                <Row
                  label="Valid until"
                  value={
                    detail.validUntil
                      ? format(
                          new Date(`${detail.validUntil}T00:00:00`),
                          "MMMM d, yyyy"
                        )
                      : "No expiry"
                  }
                />
                <Row
                  label="Created"
                  value={`${format(new Date(detail.createdAt), "MMM d, yyyy")} · ${detail.createdByName}`}
                />
                {detail.approvedAt && detail.approvedByName && (
                  <Row
                    label="Approved"
                    value={`${format(new Date(detail.approvedAt), "MMM d, yyyy")} · ${detail.approvedByName}`}
                  />
                )}
                {detail.sentAt && (
                  <Row
                    label="Sent"
                    value={format(new Date(detail.sentAt), "MMM d, yyyy")}
                  />
                )}
                {detail.notes && (
                  <div className="mt-1">
                    <p className="text-muted-foreground">Notes</p>
                    <p className="whitespace-pre-wrap">{detail.notes}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <QuotationStatusActions
          id={detail.id}
          quoteNumber={detail.quoteNumber}
          type={detail.type}
          poNumber={detail.poNumber}
          status={detail.status}
          canUpdate={canUpdate}
          canApprove={ability.can("approve", "Quotation")}
          canSend={ability.can("send", "Quotation")}
          canConvert={ability.can("convert", "Quotation")}
          canArchive={ability.can("archive", "Quotation")}
        />
      </div>
    </>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      className={
        strong
          ? "flex items-center justify-between text-base font-semibold"
          : "flex items-center justify-between"
      }
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right tabular-nums">{value}</span>
    </div>
  );
}

function php(value: string): string {
  const n = parseFloat(value);
  return Number.isNaN(n)
    ? value
    : `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
}
