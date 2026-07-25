"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CompanyProfile } from "@/lib/company-profile";
import {
  saveContactInfoAction,
  saveOwnerNameAction,
  uploadSignatureAction,
} from "@/app/(app)/settings/actions";

/** Company profile for printables — the proprietor's name + signature stamped in
 *  the "Reviewed and Approved by" block, and the footer contact line, all shared
 *  across every printable (JO / Production / Quotation). */
export function SignatureUpload({ profile }: { profile: CompanyProfile }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [bust, setBust] = useState(() => Date.now()); // cache-buster for the current image
  const [name, setName] = useState(profile.ownerName);
  const [person, setPerson] = useState(profile.contactPerson);
  const [phone, setPhone] = useState(profile.contactPhone);
  const [email, setEmail] = useState(profile.contactEmail);
  const [pending, startTransition] = useTransition();

  const saveName = () => {
    if (!name.trim()) {
      toast.error("Enter the owner name.");
      return;
    }
    startTransition(async () => {
      const result = await saveOwnerNameAction({ ownerName: name.trim() });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Owner name saved — it now prints on new documents.");
      router.refresh();
    });
  };

  const saveContact = () => {
    if (!person.trim() || !phone.trim() || !email.trim()) {
      toast.error("Fill in the contact person, phone, and email.");
      return;
    }
    startTransition(async () => {
      const result = await saveContactInfoAction({
        contactPerson: person.trim(),
        contactPhone: phone.trim(),
        contactEmail: email.trim(),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Contact line saved — it now prints on new documents.");
      router.refresh();
    });
  };

  // Revoke object URLs so previews don't leak.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return f ? URL.createObjectURL(f) : null;
    });
  };

  const upload = () => {
    const f = fileRef.current?.files?.[0];
    if (!f) {
      toast.error("Choose a signature image first.");
      return;
    }
    const fd = new FormData();
    fd.append("file", f);
    startTransition(async () => {
      const result = await uploadSignatureAction(fd);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Signature updated — it now prints on new documents.");
      setPreview(null);
      if (fileRef.current) fileRef.current.value = "";
      setBust(Date.now());
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Company Profile</CardTitle>
        <CardDescription>
          The proprietor&apos;s name, signature, and footer contact line stamped
          on the Job Order, Production, and Quotation printables.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <div className="grid gap-2">
          <Label htmlFor="owner-name">Owner / proprietor name</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="owner-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Joel O. Ngo"
              className="max-w-sm"
            />
            <Button onClick={saveName} disabled={pending}>
              {pending ? "Saving…" : "Save name"}
            </Button>
          </div>
        </div>

        <div className="grid gap-4">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Footer contact line
          </span>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="contact-person">Contact person</Label>
              <Input
                id="contact-person"
                value={person}
                onChange={(e) => setPerson(e.target.value)}
                placeholder="e.g. Michelle Ca-ang"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="contact-phone">Phone</Label>
              <Input
                id="contact-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. 0963-1220016"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="contact-email">Email</Label>
              <Input
                id="contact-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. ormocprintshoppe@gmail.com"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Prints as: If you have any questions, please contact{" "}
            {person || "…"}, {phone || "…"}, {email || "…"}
          </p>
          <Button onClick={saveContact} disabled={pending} className="w-fit">
            {pending ? "Saving…" : "Save contact"}
          </Button>
        </div>

        <div className="grid gap-4">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Signature
          </span>
        <div className="flex flex-wrap gap-6">
          <div className="grid gap-1">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Current
            </span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/jon-signature.png?v=${bust}`}
              alt="Current signature"
              className="h-20 w-auto rounded border bg-white object-contain p-2"
            />
          </div>
          {preview && (
            <div className="grid gap-1">
              <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                New (preview)
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview}
                alt="New signature preview"
                className="h-20 w-auto rounded border bg-white object-contain p-2"
              />
            </div>
          )}
        </div>
          <Input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg"
            onChange={onFile}
            className="max-w-sm"
          />
          <Button onClick={upload} disabled={pending} className="w-fit">
            {pending ? "Uploading…" : "Upload signature"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
