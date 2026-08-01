"use client";

/**
 * docs/sales.txt §5.1 step 4 — all copies of a spoiled receipt (original,
 * duplicate, triplicate) stay bound in the booklet, in sequence.
 *
 * The system cannot see whether the paper is there, so it makes someone say
 * so out loud before the number is burned. Both the cancel flow and the
 * replace flow gate on this.
 */
export function OnHandCheck({
  id,
  checked,
  onChange,
  documentNo,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  documentNo: string;
}) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-2 rounded-md border bg-background p-2.5 text-xs"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-primary"
      />
      <span>
        I have <strong>{documentNo}</strong> in front of me — all copies
        (original, duplicate, triplicate) are accounted for and stay attached in
        the booklet.
      </span>
    </label>
  );
}
