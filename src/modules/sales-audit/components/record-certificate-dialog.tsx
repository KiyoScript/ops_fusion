"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangleIcon } from "lucide-react";
import { sanitizeDecimal } from "@/lib/form-numeric";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { WithholdingKind } from "@/generated/prisma/enums";
import {
  WITHHOLDING_KIND_HINT,
  WITHHOLDING_KIND_LABEL,
  type CertificateDto,
  type OutstandingWithholdingDto,
} from "../schemas/withholding";
import {
  useAmendCertificate,
  useRecordCertificate,
} from "../hooks/use-withholding";

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

const isoOf = (d: Date | string | null) =>
  d ? new Date(d).toISOString().slice(0, 10) : "";

/** Statutory default per kind, so the common case needs no typing. */
const DEFAULT_RATE: Record<WithholdingKind, string> = {
  EWT_2307: "2",
  VAT_2306: "5",
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customers: { id: string; name: string }[];
  /** Present → amend that certificate instead of recording a new one. */
  certificate?: CertificateDto | null;
  /** Pre-selected chase-list rows, when opened from the outstanding table. */
  preselected?: string[];
  /** The customer's unclaimed withholdings, for the picker. */
  outstanding: OutstandingWithholdingDto[];
};

/**
 * The shell only. The form is a separate component mounted fresh on open and
 * keyed to what it is editing, so it initialises from props once instead of
 * being reset by an effect — a cancelled entry can never bleed into the next
 * one, and a stale certificate number can never attach one customer's form to
 * another's payments.
 */
export function RecordCertificateDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        {props.open && (
          <CertificateForm
            key={props.certificate?.id ?? `new-${(props.preselected ?? []).join(",")}`}
            {...props}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CertificateForm({
  onOpenChange,
  customers,
  certificate,
  preselected = [],
  outstanding,
}: Props) {
  const editing = Boolean(certificate);

  const seeded = useMemo(
    () => outstanding.filter((o) => preselected.includes(o.allocationId)),
    [outstanding, preselected]
  );
  const seedKind: WithholdingKind =
    certificate?.kind ?? seeded[0]?.kind ?? "EWT_2307";

  const [customerId, setCustomerId] = useState(
    certificate?.customerId ?? seeded[0]?.customerId ?? ""
  );
  const [kind, setKind] = useState<WithholdingKind>(seedKind);
  const [certificateNo, setCertificateNo] = useState(
    certificate?.certificateNo ?? ""
  );
  const [periodFrom, setPeriodFrom] = useState(
    isoOf(certificate?.periodFrom ?? null)
  );
  const [periodTo, setPeriodTo] = useState(isoOf(certificate?.periodTo ?? null));
  const [taxBase, setTaxBase] = useState(certificate?.taxBase ?? "");
  const [ratePct, setRatePct] = useState(
    certificate?.ratePct ?? DEFAULT_RATE[seedKind]
  );
  const [receivedAt, setReceivedAt] = useState(
    certificate
      ? isoOf(certificate.receivedAt)
      : new Date().toISOString().slice(0, 10)
  );
  const [notes, setNotes] = useState(certificate?.notes ?? "");
  const [picked, setPicked] = useState<string[]>(
    seeded.map((o) => o.allocationId)
  );

  const record = useRecordCertificate();
  const amend = useAmendCertificate();
  const busy = record.isPending || amend.isPending;

  // What is actually attachable: this customer's unclaimed withholdings of
  // this tax. A 2306 can never cover income tax and no form covers another
  // company's — offering the choice would be offering a way to misfile.
  const choices = useMemo(
    () => outstanding.filter((o) => o.customerId === customerId && o.kind === kind),
    [outstanding, customerId, kind]
  );

  const pickedRows = choices.filter((o) => picked.includes(o.allocationId));
  const pickedTotal = pickedRows.reduce((t, o) => t + cents(o.withheld), 0);
  const pickedBase = pickedRows.reduce((t, o) => t + cents(o.vatableSales), 0);

  // The amount SHOWN follows the selection until the user overrules it, and
  // the override is what is stored — derived rather than synced, so there is
  // no moment where the field and the selection disagree by accident. The form
  // usually totals exactly what we recorded; when it does not, that difference
  // is the finding.
  const [amountOverride, setAmountOverride] = useState<string | null>(
    certificate?.amount ?? null
  );
  const amount =
    amountOverride ??
    (pickedTotal === 0 ? "" : (pickedTotal / 100).toFixed(2));

  const typedCents = cents(amount);
  const variance = typedCents - pickedTotal;
  const mismatched = !editing && picked.length > 0 && variance !== 0;

  function toggle(id: string) {
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  }

  async function submit() {
    if (!editing && !customerId) {
      toast.error("Choose the customer who issued the form.");
      return;
    }
    if (typedCents <= 0) {
      toast.error("Enter the tax shown on the certificate.");
      return;
    }
    try {
      if (editing && certificate) {
        await amend.mutateAsync({
          id: certificate.id,
          certificateNo: certificateNo.trim() || null,
          periodFrom: periodFrom || null,
          periodTo: periodTo || null,
          amount,
          taxBase: taxBase || null,
          ratePct: ratePct === "" ? null : Number(ratePct),
          receivedAt: receivedAt || null,
          notes: notes.trim() || null,
        });
        toast.success("Certificate amended.");
      } else {
        await record.mutateAsync({
          customerId,
          kind,
          certificateNo: certificateNo.trim() || null,
          periodFrom: periodFrom || null,
          periodTo: periodTo || null,
          amount,
          taxBase: taxBase || null,
          ratePct: ratePct === "" ? null : Number(ratePct),
          receivedAt: receivedAt || null,
          notes: notes.trim() || null,
          allocationIds: picked,
        });
        toast.success(
          picked.length > 0
            ? `Certificate recorded against ${picked.length} collection${picked.length === 1 ? "" : "s"}.`
            : "Certificate recorded."
        );
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save it.");
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {editing ? "Amend certificate" : "Record a withholding certificate"}
        </DialogTitle>
        <DialogDescription>
          {editing
            ? "Correct what the form says. To move it to another customer or another tax, void it and record the right one."
            : "The form the customer hands over for tax they already remitted on our behalf. Attach it to the collections it covers so the money stops showing as unclaimed."}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Customer</Label>
            {editing ? (
              <p className="text-sm font-medium">{certificate?.customerName}</p>
            ) : (
              <Select
                value={customerId}
                onValueChange={(v) => {
                  setCustomerId(v ?? "");
                  setPicked([]);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Who issued the form?" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label>Which tax</Label>
            {editing ? (
              <p className="text-sm font-medium">
                {certificate && WITHHOLDING_KIND_LABEL[certificate.kind]}
              </p>
            ) : (
              <Select
                value={kind}
                onValueChange={(v) => {
                  const next = (v ?? "EWT_2307") as WithholdingKind;
                  setKind(next);
                  setPicked([]);
                  setRatePct(DEFAULT_RATE[next]);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    Object.keys(WITHHOLDING_KIND_LABEL) as WithholdingKind[]
                  ).map((k) => (
                    <SelectItem key={k} value={k}>
                      {WITHHOLDING_KIND_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className="text-xs text-muted-foreground">
              {WITHHOLDING_KIND_HINT[kind]}
            </p>
          </div>
        </div>

        {!editing && customerId && (
          <div className="rounded-lg border">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
              <p className="text-sm font-medium">Collections this form covers</p>
              <p className="text-xs text-muted-foreground">
                {choices.length === 0
                  ? "Nothing unclaimed for this customer and tax"
                  : `${picked.length} of ${choices.length} selected · ${peso(pickedTotal / 100)}`}
              </p>
            </div>
            {choices.length > 0 && (
              <div className="max-h-56 overflow-y-auto">
                {choices.map((o) => {
                  const on = picked.includes(o.allocationId);
                  return (
                    <label
                      key={o.allocationId}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-muted/50",
                        on && "bg-muted/40"
                      )}
                    >
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={on}
                        onChange={() => toggle(o.allocationId)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">
                          {o.documentNo ?? o.joNumber ?? "—"}
                        </span>
                        <span className="ml-2 text-muted-foreground">
                          {o.crNumber ? `CR ${o.crNumber} · ` : ""}
                          {shortDate(o.collectedAt)}
                        </span>
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        base {peso(o.vatableSales)}
                      </span>
                      <span className="w-24 text-right font-medium tabular-nums">
                        {peso(o.withheld)}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            {pickedRows.length > 0 && (
              <div className="flex items-center justify-between border-t bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <span>Base covered</span>
                <span className="tabular-nums">{peso(pickedBase / 100)}</span>
              </div>
            )}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="wht-no">Certificate no.</Label>
            <Input
              id="wht-no"
              value={certificateNo}
              onChange={(e) => setCertificateNo(e.target.value)}
              placeholder="Leave blank if awaited"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="wht-amount">Tax on the form</Label>
            <Input
              id="wht-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmountOverride(sanitizeDecimal(e.target.value))}
              className={cn(mismatched && "border-amber-500")}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="wht-received">Received</Label>
            <Input
              id="wht-received"
              type="date"
              value={receivedAt}
              onChange={(e) => setReceivedAt(e.target.value)}
            />
          </div>
        </div>

        {mismatched && (
          <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
            <span>
              The form says {peso(typedCents / 100)} but the collections
              selected total {peso(pickedTotal / 100)} —{" "}
              {variance > 0 ? "more" : "less"} by{" "}
              <b>{peso(Math.abs(variance) / 100)}</b>. Recording it anyway is
              fine; it will show as a variance until somebody works out whether
              the gap is theirs or ours.
            </span>
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-4">
          <div className="grid gap-1.5">
            <Label htmlFor="wht-from">Period from</Label>
            <Input
              id="wht-from"
              type="date"
              value={periodFrom}
              onChange={(e) => setPeriodFrom(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="wht-to">Period to</Label>
            <Input
              id="wht-to"
              type="date"
              value={periodTo}
              onChange={(e) => setPeriodTo(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="wht-base">Tax base</Label>
            <Input
              id="wht-base"
              inputMode="decimal"
              value={taxBase}
              onChange={(e) => setTaxBase(sanitizeDecimal(e.target.value))}
              placeholder="VAT-exclusive"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="wht-rate">Rate %</Label>
            <Input
              id="wht-rate"
              inputMode="decimal"
              value={ratePct}
              onChange={(e) => setRatePct(sanitizeDecimal(e.target.value))}
            />
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="wht-notes">Notes</Label>
          <Textarea
            id="wht-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything the next person needs — a queried figure, a promised replacement…"
          />
        </div>
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button onClick={submit} disabled={busy}>
          {editing ? "Save changes" : "Record certificate"}
        </Button>
      </DialogFooter>
    </>
  );
}
