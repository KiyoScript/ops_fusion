"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CopyIcon, MessageCircleIcon } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";

export function CopyQuoteButton({ text }: { text: string }) {
  const [open, setOpen] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Quote copied — paste it into Viber, Messenger, or SMS.");
      setOpen(false);
    } catch {
      toast.error("Couldn't copy automatically — select the text and copy it.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <MessageCircleIcon /> Copy quote
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Messenger / Viber quote</DialogTitle>
          <DialogDescription>
            Ready-to-send text for chat or SMS. Copy it and paste to the customer.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          readOnly
          value={text}
          rows={14}
          className="text-sm leading-relaxed"
          onFocus={(e) => e.currentTarget.select()}
        />
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Close</DialogClose>
          <Button onClick={copy}>
            <CopyIcon /> Copy to clipboard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
