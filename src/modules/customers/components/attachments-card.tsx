"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileTextIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  deleteCustomerAttachmentAction,
  uploadCustomerAttachmentAction,
} from "@/app/(app)/customers/actions";

type Attachment = {
  id: string;
  kind: string;
  fileName: string;
  size: number;
  createdAt: string;
  uploadedByName: string;
};

const KIND_LABEL: Record<string, string> = {
  CREDIT_REQUEST: "Credit Request",
  BIR_2303: "BIR 2303",
  OTHER: "Other",
};

export function AttachmentsCard({
  attachments,
  target,
  canEdit,
}: {
  attachments: Attachment[];
  target: { companyId?: string; customerId?: string };
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [kind, setKind] = useState("CREDIT_REQUEST");
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = (file: File) => {
    const fd = new FormData();
    fd.set("file", file);
    fd.set("kind", kind);
    if (target.companyId) fd.set("companyId", target.companyId);
    if (target.customerId) fd.set("customerId", target.customerId);
    start(async () => {
      const res = await uploadCustomerAttachmentAction(fd);
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("File uploaded.");
      router.refresh();
    });
  };

  const remove = (id: string) => {
    start(async () => {
      const res = await deleteCustomerAttachmentAction({ id, ...target });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("File removed.");
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Documents</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={kind} onValueChange={(v) => setKind(v ?? "CREDIT_REQUEST")}>
              <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="CREDIT_REQUEST">Credit Request</SelectItem>
                <SelectItem value="BIR_2303">BIR 2303</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>
            <input
              type="file"
              ref={inputRef}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
                e.target.value = "";
              }}
            />
            <Button variant="outline" size="sm" disabled={pending} onClick={() => inputRef.current?.click()}>
              <UploadIcon /> {pending ? "Uploading…" : "Upload"}
            </Button>
          </div>
        )}

        {attachments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>
        ) : (
          <ul className="grid gap-1.5">
            {attachments.map((a) => (
              <li key={a.id} className="flex items-center gap-2 rounded-lg border p-2 text-sm">
                <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <a
                    href={`/api/customers/attachments/${a.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate font-medium underline"
                  >
                    {a.fileName}
                  </a>
                  <div className="text-xs text-muted-foreground">
                    {KIND_LABEL[a.kind] ?? a.kind} · {(a.size / 1024).toFixed(0)} KB · {a.uploadedByName}
                  </div>
                </div>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => remove(a.id)}
                    disabled={pending}
                    aria-label={`Delete ${a.fileName}`}
                  >
                    <Trash2Icon />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
