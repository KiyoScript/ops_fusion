import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Editable company details for the printables. Kept as a tiny JSON file the
// Settings page writes and the PDF renderers read — same file-based approach as
// the signature (public/jon-signature.png). Holds the proprietor's name shown in
// the "Reviewed and Approved by" block and the contact line stamped in every
// printable's footer. Extend as needed.

const PROFILE_PATH = path.join(process.cwd(), "public", "company-profile.json");

export interface CompanyProfile {
  /** Proprietor name printed in the "Reviewed and Approved by" block. */
  ownerName: string;
  /** Footer contact line: who to reach, phone, email. */
  contactPerson: string;
  contactPhone: string;
  contactEmail: string;
}

// Defaults mirror the values that were previously hardcoded in the renderers,
// so behaviour is unchanged until someone edits them in Settings.
export const DEFAULT_PROFILE: CompanyProfile = {
  ownerName: "Joel O. Ngo",
  contactPerson: "Michelle Ca-ang",
  contactPhone: "0963-1220016",
  contactEmail: "ormocprintshoppe@gmail.com",
};

/** Full profile with every field filled in (missing keys fall back to default). */
export async function getCompanyProfile(): Promise<CompanyProfile> {
  try {
    const data = JSON.parse(
      await readFile(PROFILE_PATH, "utf8")
    ) as Partial<CompanyProfile>;
    return {
      ownerName: data.ownerName?.trim() || DEFAULT_PROFILE.ownerName,
      contactPerson: data.contactPerson?.trim() || DEFAULT_PROFILE.contactPerson,
      contactPhone: data.contactPhone?.trim() || DEFAULT_PROFILE.contactPhone,
      contactEmail: data.contactEmail?.trim() || DEFAULT_PROFILE.contactEmail,
    };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

/** The proprietor name printed on documents (falls back to the default). */
export async function getOwnerName(): Promise<string> {
  return (await getCompanyProfile()).ownerName;
}

/** Footer line stamped at the bottom of every printable (JO / Production / Quotation). */
export async function getContactLine(): Promise<string> {
  const p = await getCompanyProfile();
  return `If you have any questions, please contact ${p.contactPerson}, ${p.contactPhone}, ${p.contactEmail}`;
}

// Writes merge with the existing file so saving one section never clobbers the
// others (owner name and contact info have separate Save buttons).
async function patchProfile(patch: Partial<CompanyProfile>): Promise<void> {
  const current = await getCompanyProfile();
  const next: CompanyProfile = { ...current, ...patch };
  await writeFile(PROFILE_PATH, JSON.stringify(next, null, 2), "utf8");
}

export async function setOwnerName(name: string): Promise<void> {
  await patchProfile({ ownerName: name.trim() });
}

export async function setContactInfo(info: {
  contactPerson: string;
  contactPhone: string;
  contactEmail: string;
}): Promise<void> {
  await patchProfile({
    contactPerson: info.contactPerson.trim(),
    contactPhone: info.contactPhone.trim(),
    contactEmail: info.contactEmail.trim(),
  });
}
