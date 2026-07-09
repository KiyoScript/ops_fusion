"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArchiveIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { archiveJobOrderAction } from "@/app/(app)/job-orders/actions";

export function ArchiveJobOrderButton({
  id,
  joNumber,
  onArchived,
}: {
  id: string;
  joNumber: string;
  /** Modal usage: called after archiving instead of navigating. */
  onArchived?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const confirm = () => {
    startTransition(async () => {
      const result = await archiveJobOrderAction({ id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${joNumber} archived.`);
      setOpen(false);
      if (onArchived) onArchived();
      else router.push("/job-orders");
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="destructive" />}>
        <ArchiveIcon /> Archive
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Archive {joNumber}?</DialogTitle>
          <DialogDescription>
            Nothing is deleted: every item moves to the archive and the JO
            leaves the active board. Admins can browse it anytime under
            Archive JOs.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter showCloseButton>
          <Button variant="destructive" onClick={confirm} disabled={pending}>
            {pending ? "Archiving…" : "Archive"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
