"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ContactField } from "@/components/validated-fields";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  portalRequestInput,
  type PortalRequestInput,
} from "../schemas/inquiry";

/** Public quote-request form (successor of the legacy Customer.html
 *  portal) — no session; posts to /api/public/quote-request. */
export function QuoteRequestForm() {
  const [sent, setSent] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<PortalRequestInput>({
    resolver: zodResolver(portalRequestInput),
    defaultValues: {
      customerName: "",
      contactNumber: "",
      email: "",
      servicesRequested: "",
      notes: "",
      website: "",
    },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      const res = await fetch("/api/public/quote-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!body.ok) {
        setServerError(body.error ?? "Something went wrong — please try again.");
        return;
      }
      setSent(true);
    } catch {
      setServerError("Could not reach the server — please try again.");
    }
  });

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <CheckCircle2Icon className="size-10 text-emerald-500" />
        <p className="text-lg font-semibold">Salamat! Request received.</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Our team will prepare your quotation and contact you through the
          number or email you provided.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="qr-name">Your name</Label>
        <Input
          id="qr-name"
          autoComplete="name"
          aria-invalid={!!errors.customerName}
          {...form.register("customerName")}
        />
        {errors.customerName && (
          <p className="text-sm text-destructive">{errors.customerName.message}</p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="qr-contact">Contact number</Label>
          <Controller
            control={form.control}
            name="contactNumber"
            render={({ field }) => (
              <ContactField
                id="qr-contact"
                value={field.value ?? ""}
                onChange={field.onChange}
              />
            )}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="qr-email">Email</Label>
          <Input
            id="qr-email"
            type="email"
            autoComplete="email"
            aria-invalid={!!errors.email}
            {...form.register("email")}
          />
          {errors.email && (
            <p className="text-sm text-destructive">{errors.email.message}</p>
          )}
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="qr-services">What do you need?</Label>
        <Input
          id="qr-services"
          placeholder="e.g. Tarpaulin 3×6 ft for a birthday, 2 pcs"
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
        <Label htmlFor="qr-notes">Details (size, colors, deadline…)</Label>
        <Textarea id="qr-notes" rows={4} {...form.register("notes")} />
      </div>

      {/* Honeypot: hidden from humans, bots fill it and get silently dropped. */}
      <input
        type="text"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden"
        {...form.register("website")}
      />

      {serverError && <p className="text-sm text-destructive">{serverError}</p>}

      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? "Sending…" : "Request a quote"}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        We reply within business hours. Leave a contact number or email so we
        can reach you.
      </p>
    </form>
  );
}
