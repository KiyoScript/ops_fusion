"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";

// Input components that constrain what the user can type, so a "numbers
// only" field can never hold letters and a contact number is always a
// clean PH mobile string. Each is a controlled input: it sanitizes the
// value on change and calls onChange with the cleaned string.

type BaseProps = Omit<
  React.ComponentProps<typeof Input>,
  "value" | "onChange" | "type" | "inputMode"
>;

/** Digits only (optionally one decimal point). Blocks every other char. */
export function NumberField({
  value,
  onChange,
  decimal = false,
  maxDigits,
  ...props
}: BaseProps & {
  value: string;
  onChange: (value: string) => void;
  /** Allow a single decimal point (money/dimensions). */
  decimal?: boolean;
  /** Cap the number of digits (ignoring the decimal point). */
  maxDigits?: number;
}) {
  const clean = (raw: string): string => {
    let s = raw.replace(decimal ? /[^\d.]/g : /\D/g, "");
    if (decimal) {
      // keep only the first dot
      const first = s.indexOf(".");
      if (first !== -1) {
        s = s.slice(0, first + 1) + s.slice(first + 1).replace(/\./g, "");
      }
    }
    if (maxDigits !== undefined) {
      const [intPart = "", decPart] = s.split(".");
      const capped = intPart.slice(0, maxDigits);
      s = decPart !== undefined ? `${capped}.${decPart}` : capped;
    }
    return s;
  };

  return (
    <Input
      {...props}
      type="text"
      inputMode={decimal ? "decimal" : "numeric"}
      value={value}
      onChange={(e) => onChange(clean(e.target.value))}
    />
  );
}

/** PH mobile number: 0917 123 4567 or +63 917 123 4567. Blocks everything
 *  except digits (and one leading +); caps the length; spaces for display. */
export function ContactField({
  value,
  onChange,
  ...props
}: BaseProps & {
  value: string;
  onChange: (value: string) => void;
}) {
  // Stored form: "09171234567" or "+639171234567"; format only for display.
  const clean = (raw: string): string => {
    const digits = raw.replace(/\D/g, "");
    return raw.trimStart().startsWith("+")
      ? `+${digits.slice(0, 12)}` // +63 + 10-digit mobile
      : digits.slice(0, 11); // 09 + 9 digits
  };
  const stored = clean(value);
  const display = stored.startsWith("+")
    ? [
        stored.slice(0, 3), // +63
        stored.slice(3, 6),
        stored.slice(6, 9),
        stored.slice(9),
      ]
        .filter(Boolean)
        .join(" ")
    : stored.length > 7
      ? `${stored.slice(0, 4)} ${stored.slice(4, 7)} ${stored.slice(7)}`
      : stored.length > 4
        ? `${stored.slice(0, 4)} ${stored.slice(4)}`
        : stored;

  return (
    <Input
      {...props}
      type="text"
      inputMode="tel"
      autoComplete="tel"
      maxLength={16} // "+63 917 123 4567"
      placeholder={props.placeholder ?? "0917 123 4567 / +63 917 123 4567"}
      value={display}
      onChange={(e) => onChange(clean(e.target.value))}
    />
  );
}

/** True for a valid PH mobile: 09XXXXXXXXX or +639XXXXXXXXX. */
export function isValidPhContact(value: string): boolean {
  const v = value.replace(/[^\d+]/g, "");
  return /^09\d{9}$/.test(v) || /^\+639\d{9}$/.test(v);
}

/** Today as "yyyy-MM-dd" (local) — use as the `min` on forward-looking
 *  date inputs (deadlines, date needed, valid-until) so past dates can't
 *  be picked. */
export function todayISO(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}
