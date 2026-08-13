"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileTextIcon, InboxIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { InquiryDialog } from "./inquiry-dialog";

// The single sales entry point. "New Quotation" opens a choice — the customer is
// either just asking around (Log Inquiry → stored in the Inquiries tracker) or
// ready to commit (Create Quotation → the full form). Sales picks per customer.
export function NewQuotationButton() {
  const router = useRouter();
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [inquiryOpen, setInquiryOpen] = useState(false);

  return (
    <>
      <Dialog open={choiceOpen} onOpenChange={setChoiceOpen}>
        <DialogTrigger render={<Button />}>
          <PlusIcon /> New Quotation
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>How do you want to proceed?</DialogTitle>
            <DialogDescription>
              Log an inquiry if the customer is just asking around, or create a
              quotation if they&apos;re ready to commit.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <ChoiceCard
              icon={<FileTextIcon className="size-5 text-primary" />}
              title="Create Quotation"
              desc="Prepare a formal price quote now."
              onClick={() => {
                setChoiceOpen(false);
                router.push("/quotations/new/custom");
              }}
            />
            <ChoiceCard
              icon={<InboxIcon className="size-5 text-primary" />}
              title="Log Inquiry"
              desc="Customer is asking around — save it and quote later."
              onClick={() => {
                setChoiceOpen(false);
                setInquiryOpen(true);
              }}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Controlled — opened when "Log Inquiry" is chosen above. */}
      <InquiryDialog open={inquiryOpen} onOpenChange={setInquiryOpen} />
    </>
  );
}

function ChoiceCard({
  icon,
  title,
  desc,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "grid gap-1.5 rounded-lg border p-4 text-left transition-colors",
        "hover:border-primary hover:bg-accent/40 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
      )}
    >
      <span className="flex items-center gap-2 font-semibold">
        {icon}
        {title}
      </span>
      <span className="text-sm text-muted-foreground">{desc}</span>
    </button>
  );
}
