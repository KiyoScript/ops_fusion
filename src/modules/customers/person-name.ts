// Canonical person-name handling. A customer's stored `name` is the DISPLAY
// form composed from these parts — "Lastname, Firstname MI." — so every reader
// (JO, quotation, DR, pickers) shows the same "Last, First" order without a
// join, and duplicate detection compares one normalized string.

export type PersonName = {
  firstName: string;
  lastName: string;
  /** Optional — a middle initial like "P" (a trailing period is normalized). */
  middleInitial?: string | null;
};

/**
 * "Lastname, Firstname MI." — MI omitted when blank. Falls back gracefully when
 * only one part is present (used by legacy rows mid-cleanup), so it never emits
 * a dangling comma.
 */
export function composePersonName({
  firstName,
  lastName,
  middleInitial,
}: PersonName): string {
  const last = (lastName ?? "").trim();
  const first = (firstName ?? "").trim();
  const mi = (middleInitial ?? "").trim().replace(/\.+$/, "");
  const miPart = mi ? ` ${mi}.` : "";
  if (!last && !first) return "";
  if (!last) return `${first}${miPart}`;
  if (!first) return `${last}${miPart}`;
  return `${last}, ${first}${miPart}`;
}
