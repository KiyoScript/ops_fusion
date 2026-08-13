"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DuplicateNameWarning } from "./duplicate-name-warning";

// Structured person-name inputs — "Lastname, Firstname MI." — shared by the
// create (individual + company contact) and edit forms so the standard is
// identical everywhere. Last + First required; M.I. optional. Renders the
// non-blocking duplicate warning right under the fields.
export function PersonNameFields({
  lastName,
  firstName,
  middleInitial,
  onLast,
  onFirst,
  onMi,
  attempted,
  excludeId,
  idPrefix = "pn",
}: {
  lastName: string;
  firstName: string;
  middleInitial: string;
  onLast: (v: string) => void;
  onFirst: (v: string) => void;
  onMi: (v: string) => void;
  attempted?: boolean;
  /** The customer being edited — excluded from duplicate matches. */
  excludeId?: string;
  idPrefix?: string;
}) {
  return (
    <div className="grid gap-2">
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_6rem]">
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-last`}>
            Last name <span className="text-destructive">*</span>
          </Label>
          <Input
            id={`${idPrefix}-last`}
            value={lastName}
            onChange={(e) => onLast(e.target.value)}
            aria-invalid={attempted && !lastName.trim()}
            placeholder="de Sape"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-first`}>
            First name <span className="text-destructive">*</span>
          </Label>
          <Input
            id={`${idPrefix}-first`}
            value={firstName}
            onChange={(e) => onFirst(e.target.value)}
            aria-invalid={attempted && !firstName.trim()}
            placeholder="John Lloyd"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-mi`}>M.I.</Label>
          <Input
            id={`${idPrefix}-mi`}
            value={middleInitial}
            onChange={(e) => onMi(e.target.value)}
            maxLength={20}
            placeholder="P"
          />
        </div>
      </div>
      <DuplicateNameWarning
        firstName={firstName}
        lastName={lastName}
        middleInitial={middleInitial}
        excludeId={excludeId}
      />
    </div>
  );
}
