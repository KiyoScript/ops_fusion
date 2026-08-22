"use client";

import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  FileCheck2Icon,
  PaperclipIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ColorBadge } from "@/components/color-badge";
import { EmptyState, ErrorState, TableSkeletonRows } from "@/components/data-states";
import { cn } from "@/lib/utils";
import type { WithholdingKind } from "@/generated/prisma/enums";
import {
  CERTIFICATE_STATUS,
  WITHHOLDING_KIND_LABEL,
  type CertificateDto,
  type CertificateStatus,
} from "../schemas/withholding";
import {
  useAttachCertificateScan,
  useUnlinkWithholdings,
  useVoidCertificate,
  useWithholdingRegister,
} from "../hooks/use-withholding";
import { RecordCertificateDialog } from "./record-certificate-dialog";

const peso = (v: string | number) =>
  `₱${Number(v || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const cents = (v: string) => Math.round(parseFloat(v || "0") * 100);

const shortDate = (d: string | Date) =>
  new Date(d).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

const KIND_SHORT: Record<WithholdingKind, string> = {
  EWT_2307: "2307",
  VAT_2306: "2306",
};

const KIND_TONE: Record<WithholdingKind, "blue" | "purple"> = {
  EWT_2307: "blue",
  VAT_2306: "purple",
};

/**
 * A certificate not chased within the year it was withheld is the one that
 * stops being claimable — so the chase list warms up long before that.
 */
function waitTone(days: number): "green" | "amber" | "red" {
  if (days >= 120) return "red";
  if (days >= 45) return "amber";
  return "green";
}

export function WithholdingRegisterView({
  canRecord = false,
  canVoid = false,
}: {
  canRecord?: boolean;
  canVoid?: boolean;
}) {
  const [customerId, setCustomerId] = useState<string>("");
  const [kind, setKind] = useState<string>("");
  const [status, setStatus] = useState<CertificateStatus>("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");

  const [recording, setRecording] = useState(false);
  const [editing, setEditing] = useState<CertificateDto | null>(null);
  const [preselected, setPreselected] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<CertificateDto | null>(null);
  const [voidReason, setVoidReason] = useState("");

  const register = useWithholdingRegister({
    customerId: customerId || null,
    kind: (kind || null) as WithholdingKind | null,
    status,
    from: from || null,
    to: to || null,
    search: search.trim() || null,
  });

  const voidCert = useVoidCertificate();
  const unlink = useUnlinkWithholdings();
  const attach = useAttachCertificateScan();

  const data = register.data;
  const outstanding = useMemo(() => data?.outstanding ?? [], [data]);

  const uncertifiedCents = cents(data?.totals.uncertified ?? "0");

  function openRecord(allocationIds: string[] = []) {
    setEditing(null);
    setPreselected(allocationIds);
    setRecording(true);
  }

  async function confirmVoid() {
    if (!voiding) return;
    if (voidReason.trim().length < 3) {
      toast.error("Say why — this is a tax record.");
      return;
    }
    try {
      await voidCert.mutateAsync({ id: voiding.id, reason: voidReason.trim() });
      toast.success(
        voiding.allocations.length > 0
          ? `Voided — ${voiding.allocations.length} withholding${voiding.allocations.length === 1 ? "" : "s"} back on the chase list.`
          : "Certificate voided."
      );
      setVoiding(null);
      setVoidReason("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not void it.");
    }
  }

  async function onAttach(id: string, file: File | undefined) {
    if (!file) return;
    try {
      await attach.mutateAsync({ id, file });
      toast.success("Scan attached.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not attach it.");
    }
  }

  async function releaseOne(certificateId: string, allocationId: string) {
    try {
      await unlink.mutateAsync({ certificateId, allocationIds: [allocationId] });
      toast.success("Back on the chase list.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not release it.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ——— what is at stake ——— */}
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryTile
          label="Withheld from us"
          value={data?.totals.withheld}
          hint="Tax our customers remitted on our behalf"
        />
        <SummaryTile
          label="Backed by a certificate"
          value={data?.totals.certified}
          hint="Claimable — the paper is on file"
          tone="good"
        />
        <SummaryTile
          label="No certificate on file"
          value={data?.totals.uncertified}
          hint={
            uncertifiedCents > 0
              ? "Cannot be claimed until the form arrives"
              : "Everything withheld is accounted for"
          }
          tone={uncertifiedCents > 0 ? "bad" : "good"}
        />
      </div>

      {data && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
          {(Object.keys(KIND_SHORT) as WithholdingKind[]).map((k) => (
            <span key={k}>
              <b className="text-foreground">{KIND_SHORT[k]}</b>{" "}
              {peso(data.totals.byKind[k].certified)} claimable ·{" "}
              <span
                className={cn(
                  cents(data.totals.byKind[k].uncertified) > 0 &&
                    "text-amber-700 dark:text-amber-400"
                )}
              >
                {peso(data.totals.byKind[k].uncertified)} awaiting paper
              </span>
            </span>
          ))}
        </div>
      )}

      {/* ——— filters ——— */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-52 flex-1">
          <SearchIcon className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Certificate no., customer, note…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          value={customerId || "ALL"}
          onValueChange={(v) => setCustomerId(!v || v === "ALL" ? "" : v)}
        >
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Every customer" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Every customer</SelectItem>
            {(data?.customers ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={kind || "ALL"}
          onValueChange={(v) => setKind(!v || v === "ALL" ? "" : v)}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Both taxes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Both taxes</SelectItem>
            <SelectItem value="EWT_2307">2307 — Income tax</SelectItem>
            <SelectItem value="VAT_2306">2306 — Withheld VAT</SelectItem>
          </SelectContent>
        </Select>
        <div className="grid gap-1">
          <Label className="text-xs text-muted-foreground">From</Label>
          <Input
            type="date"
            className="w-40"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs text-muted-foreground">To</Label>
          <Input
            type="date"
            className="w-40"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        {canRecord && (
          <Button onClick={() => openRecord()}>
            <PlusIcon className="size-4" />
            Record certificate
          </Button>
        )}
      </div>

      {register.isError && (
        <ErrorState
          message={
            register.error instanceof Error
              ? register.error.message
              : "Could not load the register."
          }
          onRetry={() => register.refetch()}
        />
      )}

      <Tabs defaultValue="outstanding">
        <TabsList>
          <TabsTrigger value="outstanding">
            Awaiting a certificate
            {outstanding.length > 0 && (
              <span className="ml-2 rounded-full bg-amber-100 px-1.5 text-xs text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">
                {outstanding.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="certificates">
            Certificates on file
            {data && (
              <span className="ml-2 text-xs text-muted-foreground">
                {data.certificates.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ——— the chase list ——— */}
        <TabsContent value="outstanding" className="mt-4">
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Tax</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Collected</TableHead>
                  <TableHead className="text-right">Base</TableHead>
                  <TableHead className="text-right">Withheld</TableHead>
                  <TableHead className="text-right">Waiting</TableHead>
                  {canRecord && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {register.isLoading && (
                  <TableSkeletonRows cols={canRecord ? 8 : 7} />
                )}
                {!register.isLoading && outstanding.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={canRecord ? 8 : 7}>
                      <EmptyState
                        title="Nothing outstanding"
                        description="Every peso withheld in this range has a certificate against it."
                      />
                    </TableCell>
                  </TableRow>
                )}
                {outstanding.map((o) => (
                  <TableRow key={`${o.allocationId}-${o.kind}`}>
                    <TableCell className="font-medium">
                      {o.customerName}
                    </TableCell>
                    <TableCell>
                      <ColorBadge
                        label={KIND_SHORT[o.kind]}
                        tone={KIND_TONE[o.kind]}
                      />
                    </TableCell>
                    <TableCell>
                      {o.documentNo ?? o.joNumber ?? "—"}
                      {o.crNumber && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          CR {o.crNumber}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{shortDate(o.collectedAt)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {peso(o.vatableSales)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {peso(o.withheld)}
                    </TableCell>
                    <TableCell className="text-right">
                      <ColorBadge
                        label={`${o.daysWaiting}d`}
                        tone={waitTone(o.daysWaiting)}
                      />
                    </TableCell>
                    {canRecord && (
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openRecord([o.allocationId])}
                        >
                          Record form
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ——— what we hold ——— */}
        <TabsContent value="certificates" className="mt-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {(
              [
                ["ALL", "All"],
                ["RECEIVED", "Paper in hand"],
                ["AWAITED", "Form awaited"],
                ["MISMATCHED", "Figures disagree"],
              ] as [CertificateStatus, string][]
            ).map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={status === value ? "default" : "outline"}
                onClick={() => setStatus(CERTIFICATE_STATUS[value])}
              >
                {label}
              </Button>
            ))}
          </div>

          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Certificate</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">On the form</TableHead>
                  <TableHead className="text-right">Attached</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {register.isLoading && <TableSkeletonRows cols={7} />}
                {!register.isLoading &&
                  (data?.certificates.length ?? 0) === 0 && (
                    <TableRow>
                      <TableCell colSpan={7}>
                        <EmptyState
                          title="No certificates here"
                          description="Record one as soon as the customer hands over the form — it is what turns a withheld peso back into money."
                        />
                      </TableCell>
                    </TableRow>
                  )}
                {(data?.certificates ?? []).map((c) => {
                  const variance = cents(c.variance);
                  const open = expanded === c.id;
                  return (
                    <Fragment key={c.id}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() => setExpanded(open ? null : c.id)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <ColorBadge
                              label={KIND_SHORT[c.kind]}
                              tone={KIND_TONE[c.kind]}
                            />
                            <span className="font-medium">
                              {c.certificateNo ?? (
                                <span className="text-muted-foreground">
                                  awaited
                                </span>
                              )}
                            </span>
                            {c.hasFile && (
                              <PaperclipIcon className="size-3.5 text-muted-foreground" />
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{c.customerName}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {c.periodFrom && c.periodTo
                            ? `${shortDate(c.periodFrom)} – ${shortDate(c.periodTo)}`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {peso(c.amount)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {peso(c.linkedTotal)}
                          <span className="ml-1 text-xs">
                            ({c.allocations.length})
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          {variance === 0 ? (
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                              <FileCheck2Icon className="size-3.5" />
                              agrees
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 tabular-nums dark:text-amber-400">
                              <AlertTriangleIcon className="size-3.5" />
                              {variance > 0 ? "+" : "−"}
                              {peso(Math.abs(variance) / 100)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell
                          className="text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex justify-end gap-1">
                            {c.hasFile && (
                              <a
                                className="inline-flex h-8 items-center rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                                href={`/api/withholding-certificates/${c.id}/file`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                View
                              </a>
                            )}
                            {canRecord && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setPreselected([]);
                                  setEditing(c);
                                  setRecording(true);
                                }}
                              >
                                Amend
                              </Button>
                            )}
                            {canVoid && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setVoidReason("");
                                  setVoiding(c);
                                }}
                              >
                                <Trash2Icon className="size-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>

                      {open && (
                        <TableRow>
                          <TableCell colSpan={7} className="bg-muted/30">
                            <div className="flex flex-col gap-3 py-2">
                              {c.allocations.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                  Nothing attached yet — this certificate is
                                  recorded but claims none of the tax withheld
                                  from us. Amend it, or record it against a
                                  collection from the chase list.
                                </p>
                              ) : (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-sm">
                                    <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                                      <tr>
                                        <th className="py-1 text-left font-medium">
                                          Invoice
                                        </th>
                                        <th className="py-1 text-left font-medium">
                                          Collected
                                        </th>
                                        <th className="py-1 text-right font-medium">
                                          Base
                                        </th>
                                        <th className="py-1 text-right font-medium">
                                          Withheld
                                        </th>
                                        {canRecord && <th />}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {c.allocations.map((a) => (
                                        <tr
                                          key={a.allocationId}
                                          className="border-t"
                                        >
                                          <td className="py-1.5">
                                            {a.documentNo ?? a.joNumber ?? "—"}
                                            {a.crNumber && (
                                              <span className="ml-2 text-xs text-muted-foreground">
                                                CR {a.crNumber}
                                              </span>
                                            )}
                                          </td>
                                          <td className="py-1.5">
                                            {shortDate(a.collectedAt)}
                                          </td>
                                          <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                                            {peso(a.vatableSales)}
                                          </td>
                                          <td className="py-1.5 text-right font-medium tabular-nums">
                                            {peso(a.withheld)}
                                          </td>
                                          {canRecord && (
                                            <td className="py-1.5 text-right">
                                              <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={() =>
                                                  releaseOne(c.id, a.allocationId)
                                                }
                                              >
                                                Release
                                              </Button>
                                            </td>
                                          )}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}

                              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
                                <span>
                                  {WITHHOLDING_KIND_LABEL[c.kind]}
                                  {c.ratePct ? ` · ${c.ratePct}%` : ""}
                                  {c.taxBase ? ` on ${peso(c.taxBase)}` : ""}
                                </span>
                                <span>
                                  {c.receivedAt
                                    ? `Received ${shortDate(c.receivedAt)}`
                                    : "Form not yet in hand"}
                                </span>
                                <span>
                                  Recorded by {c.createdByName},{" "}
                                  {shortDate(c.createdAt)}
                                </span>
                              </div>

                              {c.notes && (
                                <p className="text-sm">{c.notes}</p>
                              )}

                              {canRecord && (
                                <div>
                                  <Label
                                    htmlFor={`scan-${c.id}`}
                                    className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-primary hover:underline"
                                  >
                                    <PaperclipIcon className="size-3.5" />
                                    {c.hasFile
                                      ? `Replace scan (${c.fileName})`
                                      : "Attach the scanned form"}
                                  </Label>
                                  <input
                                    id={`scan-${c.id}`}
                                    type="file"
                                    className="hidden"
                                    accept="application/pdf,image/*"
                                    onChange={(e) =>
                                      onAttach(c.id, e.target.files?.[0])
                                    }
                                  />
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      <RecordCertificateDialog
        open={recording}
        onOpenChange={(o) => {
          setRecording(o);
          if (!o) {
            setEditing(null);
            setPreselected([]);
          }
        }}
        customers={data?.customers ?? []}
        certificate={editing}
        preselected={preselected}
        outstanding={outstanding}
      />

      <Dialog
        open={voiding !== null}
        onOpenChange={(o) => {
          if (!o) setVoiding(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Void this certificate?</DialogTitle>
            <DialogDescription>
              It stays readable — it may already have been counted on a filed
              return.{" "}
              {voiding && voiding.allocations.length > 0
                ? `The ${voiding.allocations.length} withholding${voiding.allocations.length === 1 ? "" : "s"} it claims will go back on the chase list.`
                : "It claims nothing, so nothing moves."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="void-reason">Why</Label>
            <Input
              id="void-reason"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="Duplicate, wrong customer, replaced by a corrected form…"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoiding(null)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              onClick={confirmVoid}
              disabled={voidCert.isPending}
            >
              Void certificate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | undefined;
  hint: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "good" && "text-emerald-700 dark:text-emerald-400",
          tone === "bad" && "text-amber-700 dark:text-amber-400"
        )}
      >
        {value === undefined ? "—" : peso(value)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
