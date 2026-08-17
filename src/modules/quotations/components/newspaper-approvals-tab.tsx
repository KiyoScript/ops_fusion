"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckIcon, XIcon, ArrowUpIcon, ArrowDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ColorBadge, type BadgeTone } from "@/components/color-badge";
import {
  approveNewspaperPriceAction,
  rejectNewspaperPriceAction,
} from "@/app/(app)/maintenance/newspaper/actions";
import type {
  NewspaperPendingView,
  NewspaperHistoryView,
} from "@/modules/quotations/services/newspaper-pricing";

const php = (v: number) =>
  `₱${v.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;

const sizeOf = (r: {
  kind: string | null;
  totalPages: number | null;
  colorPages: number | null;
  bwPages: number | null;
}) =>
  r.kind === "LOOSE_PAGES"
    ? `${r.colorPages ?? "?"}c / ${r.bwPages ?? "?"}bw`
    : `${r.totalPages ?? "—"}pg · ${r.colorPages ?? "?"}c / ${r.bwPages ?? "?"}bw`;

const ACTION_BADGE: Record<string, { tone: BadgeTone; label: string }> = {
  submit: { tone: "gray", label: "Submitted" },
  approve: { tone: "green", label: "Approved" },
  reject: { tone: "red", label: "Rejected" },
};

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export function NewspaperApprovalsTab({
  pending,
  history,
}: {
  pending: NewspaperPendingView[];
  history: NewspaperHistoryView[];
}) {
  const router = useRouter();
  const [busy, start] = useTransition();

  const approve = (id: string) =>
    start(async () => {
      const res = await approveNewspaperPriceAction(id);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Approved — the price is now live.");
      router.refresh();
    });
  const reject = (id: string) =>
    start(async () => {
      const res = await rejectNewspaperPriceAction(id);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Submission rejected.");
      router.refresh();
    });

  return (
    <div className="grid gap-6">
      {/* Pending queue */}
      <section className="grid gap-2">
        <h3 className="text-sm font-semibold">
          Pending{" "}
          <span className="font-normal text-muted-foreground">
            ({pending.length})
          </span>
        </h3>
        {pending.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Nothing waiting. New prices and changes from the calculator show up
            here for approval.
          </p>
        ) : (
          <Card className="py-0">
            <CardContent className="overflow-x-auto px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Publication</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead className="text-right">Copies</TableHead>
                    <TableHead className="text-right">Current</TableHead>
                    <TableHead className="text-right">Proposed</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pending.map((r) => {
                    const proposed = Number(r.price);
                    const current =
                      r.currentPrice == null ? null : Number(r.currentPrice);
                    const up = current != null && proposed > current;
                    const down = current != null && proposed < current;
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">
                          {r.publication}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {r.kind === "LOOSE_PAGES" ? "Loose" : "Full"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">
                          {sizeOf(r)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.copies}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {current == null ? (
                            <ColorBadge tone="blue" label="New size" />
                          ) : (
                            php(current)
                          )}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          <span className="inline-flex items-center gap-1">
                            {up && (
                              <ArrowUpIcon className="size-3.5 text-rose-600" />
                            )}
                            {down && (
                              <ArrowDownIcon className="size-3.5 text-emerald-600" />
                            )}
                            {php(proposed)}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {dateTime(r.submittedAt)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              disabled={busy}
                              onClick={() => approve(r.id)}
                            >
                              <CheckIcon /> Approve
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              disabled={busy}
                              onClick={() => reject(r.id)}
                            >
                              <XIcon /> Reject
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>

      {/* Full audit history */}
      <section className="grid gap-2">
        <h3 className="text-sm font-semibold">
          History{" "}
          <span className="font-normal text-muted-foreground">
            (submitted · approved · rejected)
          </span>
        </h3>
        {history.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No activity yet.
          </p>
        ) : (
          <Card className="py-0">
            <CardContent className="overflow-x-auto px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date &amp; time</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead>Publication</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead className="text-right">Copies</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((h) => {
                    const badge = ACTION_BADGE[h.action] ?? {
                      tone: "gray" as BadgeTone,
                      label: h.action,
                    };
                    return (
                      <TableRow key={h.id}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                          {dateTime(h.at)}
                        </TableCell>
                        <TableCell>
                          <ColorBadge tone={badge.tone} label={badge.label} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{h.by}</TableCell>
                        <TableCell className="font-medium">
                          {h.publication || "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">
                          {h.kind ? sizeOf(h) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {h.copies ?? "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
                          {h.price == null ? (
                            "—"
                          ) : h.previousPrice != null ? (
                            <span className="text-muted-foreground">
                              {php(h.previousPrice)}{" "}
                              <span className="text-foreground">
                                → {php(h.price)}
                              </span>
                            </span>
                          ) : (
                            php(h.price)
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
