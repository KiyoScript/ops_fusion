"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { PlusIcon, PencilIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ContactField } from "@/components/validated-fields";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createInquiryAction,
  updateInquiryAction,
} from "@/app/(app)/inquiries/actions";
import {
  inquiryCreateInput,
  type InquiryCreateInput,
  type InquiryRowDto,
} from "../schemas/inquiry";
import { CustomerCombobox } from "@/modules/job-orders/components/customer-combobox";
import { useInvalidateInquiries } from "../hooks/use-inquiries";

const MEDIUM_OPTIONS = [
  { value: "WALK_IN", label: "Walk-in" },
  { value: "MESSENGER", label: "Messenger" },
  { value: "CALL", label: "Call" },
  { value: "EMAIL", label: "Email" },
  { value: "VIBER", label: "Viber" },
  { value: "PORTAL", label: "Portal" },
] as const;

/** Log-new or edit dialog for one inquiry (legacy spec 1.2 step 1). */
export function InquiryDialog({ inquiry }: { inquiry?: InquiryRowDto }) {
  const router = useRouter();
  const invalidate = useInvalidateInquiries();
  const [open, setOpen] = useState(false);
  const mode = inquiry ? "edit" : "create";

  const form = useForm<InquiryCreateInput>({
    resolver: zodResolver(inquiryCreateInput),
    defaultValues: inquiry
      ? {
          customerName: inquiry.customerName,
          contactNumber: inquiry.contactNumber ?? "",
          email: inquiry.email ?? "",
          medium: inquiry.medium as InquiryCreateInput["medium"],
          servicesRequested: inquiry.servicesRequested,
          notes: inquiry.notes ?? "",
        }
      : {
          customerName: "",
          contactNumber: "",
          email: "",
          medium: "WALK_IN",
          servicesRequested: "",
          notes: "",
        },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    const result =
      mode === "create"
        ? await createInquiryAction(values)
        : await updateInquiryAction({ ...values, id: inquiry!.id });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(mode === "create" ? "Inquiry logged." : "Inquiry updated.");
    setOpen(false);
    if (mode === "create") form.reset();
    invalidate();
    router.refresh();
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {mode === "create" ? (
        <DialogTrigger render={<Button />}>
          <PlusIcon /> Log inquiry
        </DialogTrigger>
      ) : (
        <DialogTrigger
          render={
            <Button variant="ghost" size="icon" aria-label="Edit inquiry" />
          }
        >
          <PencilIcon />
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Log an inquiry" : "Edit inquiry"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="inq-name">Customer</Label>
            <Controller
              control={form.control}
              name="customerName"
              render={({ field }) => (
                <CustomerCombobox
                  id="inq-name"
                  value={field.value}
                  onChange={field.onChange}
                  invalid={!!errors.customerName}
                />
              )}
            />
            {errors.customerName && (
              <p className="text-sm text-destructive">
                {errors.customerName.message}
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="inq-contact">Contact number</Label>
              <Controller
                control={form.control}
                name="contactNumber"
                render={({ field }) => (
                  <ContactField
                    id="inq-contact"
                    value={field.value ?? ""}
                    onChange={field.onChange}
                  />
                )}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="inq-email">Email</Label>
              <Input id="inq-email" type="email" {...form.register("email")} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Medium</Label>
              <Controller
                control={form.control}
                name="medium"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(v) => field.onChange(v ?? "WALK_IN")}
                  >
                    <SelectTrigger aria-label="Inquiry medium">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MEDIUM_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="inq-services">Services requested</Label>
            <Input
              id="inq-services"
              placeholder="e.g. Tarpaulin 3×6 ft, 2 pcs"
              aria-invalid={!!errors.servicesRequested}
              {...form.register("servicesRequested")}
            />
            {errors.servicesRequested && (
              <p className="text-sm text-destructive">
                {errors.servicesRequested.message}
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="inq-notes">Notes</Label>
            <Textarea id="inq-notes" rows={3} {...form.register("notes")} />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? "Saving…"
                : mode === "create"
                  ? "Log inquiry"
                  : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
