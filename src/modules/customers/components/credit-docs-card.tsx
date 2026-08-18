"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckIcon, MailIcon, SendIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  updateCreditDocsAction,
  sendCreditApplicationEmailAction,
} from "@/app/(app)/customers/actions";
import { buildCreditApplicationEmail } from "@/modules/customers/services/credit-application-email";

const CREDIT_APP_FORM_URL =
  "https://docs.google.com/document/d/1LXGQ0qm1CBjjPuL_XFoBCqDBUdP_woNN/edit";

type Docs = {
  docBusinessReg: boolean;
  docCreditAppForm: boolean;
  docBir2303: boolean;
  docMayorPermit: boolean;
};

const DOCS: { key: keyof Docs; label: string }[] = [
  { key: "docBusinessReg", label: "Business Registration — DTI (Sole Prop) or SEC (Corp)" },
  { key: "docCreditAppForm", label: "Filled-up Credit Application Form (Ormoc Printshoppe)" },
  { key: "docBir2303", label: "BIR Certificate of Registration (Form 2303)" },
  { key: "docMayorPermit", label: "Mayor's Business Permit" },
];

export function CreditDocsCard({
  companyId,
  companyName,
  companyEmail,
  docs,
  canEdit,
}: {
  companyId: string;
  companyName: string;
  companyEmail: string | null;
  docs: Docs;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<Docs>(docs);
  const [saving, setSaving] = useState(false);
  const keys = DOCS.map((d) => d.key);
  const dirty = keys.some((k) => state[k] !== docs[k]);
  const done = keys.filter((k) => state[k]).length;

  const save = async () => {
    setSaving(true);
    const res = await updateCreditDocsAction({ id: companyId, ...state });
    setSaving(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success("Checklist saved.");
    router.refresh();
  };

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">
          Credit line documents{" "}
          <span className="font-normal text-muted-foreground">
            ({done}/{DOCS.length})
          </span>
        </CardTitle>
        <SendCreditEmailButton
          companyId={companyId}
          companyName={companyName}
          defaultTo={companyEmail ?? ""}
          disabled={!canEdit}
        />
      </CardHeader>
      <CardContent className="grid gap-2">
        <p className="text-xs text-muted-foreground">
          Supporting documents to submit for a credit line.{" "}
          <a
            href={CREDIT_APP_FORM_URL}
            target="_blank"
            rel="noopener"
            className="underline underline-offset-2"
          >
            Credit Application Form
          </a>
          .
        </p>
        {DOCS.map((d) => {
          const checked = state[d.key];
          return (
            <button
              key={d.key}
              type="button"
              disabled={!canEdit}
              onClick={() => setState((s) => ({ ...s, [d.key]: !s[d.key] }))}
              className={cn(
                "flex items-center gap-2.5 rounded-lg border p-2.5 text-left text-sm transition-colors",
                checked
                  ? "border-emerald-300 bg-emerald-50/50 dark:border-emerald-900/60 dark:bg-emerald-950/20"
                  : "hover:bg-accent/40",
                !canEdit && "cursor-default"
              )}
            >
              <span
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded border",
                  checked
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "border-input"
                )}
              >
                {checked && <CheckIcon className="size-3.5" />}
              </span>
              {d.label}
            </button>
          );
        })}
        {canEdit && dirty && (
          <Button size="sm" className="w-fit" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save checklist"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function SendCreditEmailButton({
  companyId,
  companyName,
  defaultTo,
  disabled,
}: {
  companyId: string;
  companyName: string;
  defaultTo: string;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(defaultTo);
  const [sending, setSending] = useState(false);
  const { subject, body } = buildCreditApplicationEmail(companyName);

  const send = async () => {
    setSending(true);
    const res = await sendCreditApplicationEmailAction({ id: companyId, to });
    setSending(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success("Credit application email sent with the form attached.");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="outline" size="sm" disabled={disabled} />}
      >
        <MailIcon /> Send credit application
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Send credit application email</DialogTitle>
          <DialogDescription>
            Sends the standard letter with the Credit Application Form PDF
            attached.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="credit-to" className="text-xs">To</Label>
            <Input
              id="credit-to"
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="company@email.com"
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Subject</Label>
            <Input value={subject} readOnly className="bg-muted/50" />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Message (auto)</Label>
            <Textarea
              value={body}
              readOnly
              rows={12}
              className="bg-muted/50 text-xs leading-relaxed"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            📎 Credit Application Form PDF is attached automatically.
          </p>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button onClick={send} disabled={sending || !to.trim()}>
            <SendIcon /> {sending ? "Sending…" : "Send email"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
