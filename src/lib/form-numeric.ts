import type { ChangeEvent } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";

// Input-level numeric enforcement: strip non-numeric characters AS THE USER
// TYPES so money/qty fields can never hold letters. The Zod schema still
// validates ranges on submit — this is the first line of defense.

/** Digits only (whole numbers). */
export function sanitizeInteger(value: string): string {
  return value.replace(/\D/g, "");
}

/** Digits + a single decimal point, capped at 2 decimal places. Allows a
 *  trailing dot mid-typing (e.g. "12."). */
export function sanitizeDecimal(value: string): string {
  let s = value.replace(/[^\d.]/g, "");
  const firstDot = s.indexOf(".");
  if (firstDot !== -1) {
    // keep the first dot, drop any others, cap to 2 decimals
    const intPart = s.slice(0, firstDot);
    const decPart = s.slice(firstDot + 1).replace(/\./g, "").slice(0, 2);
    s = `${intPart}.${decPart}`;
  }
  return s;
}

/**
 * Spread onto an <Input> together with a React Hook Form registration to
 * make it accept numbers only. Cleans the value on each keystroke and then
 * forwards the sanitized event to RHF.
 *
 *   <Input {...numericField(form.register("amount"), "decimal")} />
 */
export function numericField(
  registration: UseFormRegisterReturn,
  mode: "integer" | "decimal"
) {
  return {
    ...registration,
    inputMode: (mode === "integer" ? "numeric" : "decimal") as
      | "numeric"
      | "decimal",
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      event.target.value =
        mode === "integer"
          ? sanitizeInteger(event.target.value)
          : sanitizeDecimal(event.target.value);
      return registration.onChange(event);
    },
  };
}
