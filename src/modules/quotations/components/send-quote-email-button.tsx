"use client";

import { useState } from "react";
import { toast } from "sonner";
import { MailIcon, SendIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { sendQuotationEmailAction } from "@/app/(app)/quotations/actions";

export function SendQuoteEmailButton({
  id,
  defaultTo,
  defaultSubject,
  defaultBody,
}: {
  id: string;
  defaultTo: string;
  defaultSubject: string;
  defaultBody: string;
}) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  const [sending, setSending] = useState(false);

  const send = async () => {
    setSending(true);
    const res = await sendQuotationEmailAction({ id, to, subject, body });
    setSending(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success("Quotation emailed with the PDF attached.");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <MailIcon /> Send email
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Email quotation</DialogTitle>
          <DialogDescription>
            Sends the quote to the customer with the PDF attached.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="email-to" className="text-xs">To</Label>
            <Input
              id="email-to"
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="customer@email.com"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="email-subject" className="text-xs">Subject</Label>
            <Input
              id="email-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="email-body" className="text-xs">Message</Label>
            <Textarea
              id="email-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={14}
              className="text-sm leading-relaxed"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            The PDF quotation is attached automatically.
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
