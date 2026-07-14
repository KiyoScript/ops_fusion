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

/** PH mobile number: 11 digits starting 09 (e.g. 0917 123 4567). Blocks
 *  non-digits and caps at 11 digits; displays with spacing. */
export function ContactField({
  value,
  onChange,
  ...props
}: BaseProps & {
  value: string;
  onChange: (value: string) => void;
}) {
  // Store the raw 11-digit string; format only for display.
  const digits = value.replace(/\D/g, "").slice(0, 11);
  const display =
    digits.length > 7
      ? `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`
      : digits.length > 4
        ? `${digits.slice(0, 4)} ${digits.slice(4)}`
        : digits;

  return (
    <Input
      {...props}
      type="text"
      inputMode="numeric"
      autoComplete="tel"
      maxLength={13} // 11 digits + 2 spaces
      placeholder={props.placeholder ?? "0917 123 4567"}
      value={display}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 11))}
    />
  );
}

/** True when the string is a valid PH mobile (11 digits, starts 09). */
export function isValidPhContact(value: string): boolean {
  return /^09\d{9}$/.test(value.replace(/\D/g, ""));
}
