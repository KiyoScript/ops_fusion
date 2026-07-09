"use client";

import { useRef, useState, useTransition } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { CheckCircle2Icon, PaperclipIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchJson } from "@/lib/api-client";
import { revokeCustomerApprovalAction } from "@/app/(app)/job-orders/actions";
import type { JobOrderDetailDto } from "../schemas/job-order";

/** Customer-approval gate: checking it REQUIRES proof attachments. Once set,
 *  the JO is final — the printable drops "THIS IS FOR APPROVAL" and the board
 *  shows the Approved badge (work may start). */
export function CustomerApprovalSection({
  jo,
  onChanged,
}: {
  jo: JobOrderDetailDto;
  onChanged: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  const approve = async () => {
    const files = fileRef.current?.files;
    if (!jo.isApprovedByCustomer && (!files || files.length === 0)) {
      toast.error(
        "Attach at least one file proving the customer approved (signed quote, photo, any file)."
      );
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      for (const file of files ?? []) body.append("files", file);
      await fetchJson<null>(`/api/job-orders/${jo.id}/approve`, {
        method: "POST",
        body,
      });
      toast.success(
        jo.isApprovedByCustomer
          ? "Attachment(s) added."
          : `${jo.joNumber} marked as approved by customer — work may start.`
      );
      if (fileRef.current) fileRef.current.value = "";
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Approval failed.");
    } finally {
      setBusy(false);
    }
  };

  const revoke = () => {
    startTransition(async () => {
      const result = await revokeCustomerApprovalAction({ id: jo.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Customer approval revoked.");
      onChanged();
    });
  };

  return (
    <div
      className={
        jo.isApprovedByCustomer
          ? "grid gap-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-500/40 dark:bg-emerald-500/10"
          : "grid gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-500/10"
      }
    >
      {jo.isApprovedByCustomer ? (
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-emerald-800 dark:text-emerald-300">
          <CheckCircle2Icon className="size-4" />
          Approved by customer
          {jo.customerApprovedAt && (
            <span className="font-normal text-emerald-700 dark:text-emerald-400">
              — {format(new Date(jo.customerApprovedAt), "MMMM d, yyyy h:mm a")}
            </span>
          )}
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto text-muted-foreground"
            onClick={revoke}
            disabled={pending}
          >
            Revoke
          </Button>
        </div>
      ) : (
        <p className="text-sm font-medium text-amber-900 dark:text-amber-300">
          Not yet approved by customer — attach proof (signed quote, photo, any
          file) to mark it approved and signal that work may start.
        </p>
      )}

      {jo.attachments.length > 0 && (
        <ul className="grid gap-1 text-xs">
          {jo.attachments.map((file) => (
            <li key={file.id} className="flex items-center gap-1.5">
              <PaperclipIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <a
                href={`/api/job-orders/attachments/${file.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate underline underline-offset-2 hover:text-primary"
              >
                {file.fileName}
              </a>
              <span className="text-muted-foreground">
                ({Math.max(1, Math.round(file.size / 1024))} KB ·{" "}
                {file.uploadedByName} · {format(new Date(file.createdAt), "M/d/yyyy")})
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="file"
          multiple
          ref={fileRef}
          className="max-w-72"
          aria-label="Customer approval attachments"
        />
        <Button size="sm" onClick={approve} disabled={busy}>
          {busy
            ? "Uploading…"
            : jo.isApprovedByCustomer
              ? "Add attachment"
              : "Mark approved by customer"}
        </Button>
      </div>
    </div>
  );
}
