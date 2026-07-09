"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2Icon } from "lucide-react";
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
import { deleteJobOrderAction } from "@/app/(app)/job-orders/actions";

export function DeleteJobOrderButton({
  id,
  joNumber,
  onDeleted,
}: {
  id: string;
  joNumber: string;
  /** Modal usage: called after delete instead of navigating. */
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const confirm = () => {
    startTransition(async () => {
      const result = await deleteJobOrderAction({ id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${joNumber} deleted.`);
      setOpen(false);
      if (onDeleted) onDeleted();
      else router.push("/job-orders");
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="destructive" />}>
        <Trash2Icon /> Delete
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {joNumber}?</DialogTitle>
          <DialogDescription>
            The job order is soft-deleted: it disappears from every list but
            stays in the database for traceability.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter showCloseButton>
          <Button variant="destructive" onClick={confirm} disabled={pending}>
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
