import { z } from "zod";

// Maintained dropdown lists (Maintenance section). JO_* types mirror the
// legacy DatabaseLink sheets; quotation/sales types get added with their
// modules. Employees live in their own master table (see schemas/employee).
export const lookupTypeInput = z.enum(["JO_STATUS", "JO_CATEGORY"]);

export const lookupCreateInput = z.object({
  type: lookupTypeInput,
  label: z.string().trim().min(1, "Enter a value").max(120),
  isLFP: z.boolean().optional(),
});

export const lookupUpdateInput = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1, "Enter a value").max(120).optional(),
  isLFP: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const lookupDeleteInput = z.object({ id: z.string().min(1) });

export type LookupTypeInput = z.infer<typeof lookupTypeInput>;
export type LookupCreateInput = z.infer<typeof lookupCreateInput>;
export type LookupUpdateInput = z.infer<typeof lookupUpdateInput>;

export type LookupImportSummaryDto = {
  created: number;
  skippedExisting: string[];
  errors: { line: number; message: string }[];
};

export type LookupDto = {
  id: string;
  type: LookupTypeInput;
  label: string;
  isLFP: boolean;
  isActive: boolean;
  sortOrder: number;
};
