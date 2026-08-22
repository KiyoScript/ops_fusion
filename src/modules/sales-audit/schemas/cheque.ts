import { z } from "zod";
import { ChequeStatus } from "@/generated/prisma/enums";

export const CHEQUE_STATUS_LABEL: Record<ChequeStatus, string> = {
  RECEIVED: "On hand",
  DEPOSITED: "Deposited",
  CLEARED: "Cleared",
  BOUNCED: "Bounced",
};

/** What each state means for the money, in the words the counter would use. */
export const CHEQUE_STATUS_HINT: Record<ChequeStatus, string> = {
  RECEIVED: "In the drawer. Not in the bank, and not money yet.",
  DEPOSITED: "Lodged with the bank, still clearing. Not money yet.",
  CLEARED: "The funds are in. This is the only state that is money.",
  BOUNCED: "Returned by the bank. The debt it paid is open again.",
};

export const chequeFilters = z.object({
  status: z.enum(ChequeStatus).optional(),
  q: z.string().trim().max(200).optional(),
  /** Only cheques datable today or earlier — what may go to the bank now. */
  depositableOnly: z.coerce.boolean().optional(),
});
export type ChequeFilters = z.infer<typeof chequeFilters>;

export const depositChequesInput = z.object({
  chequeIds: z.array(z.string().min(1)).min(1, "Pick at least one cheque."),
  /** The deposit slip they went in on — the handle a bank line traces back by. */
  depositSlipNo: z.string().trim().max(60).optional(),
});
export type DepositChequesInput = z.infer<typeof depositChequesInput>;

export const clearChequesInput = z.object({
  chequeIds: z.array(z.string().min(1)).min(1, "Pick at least one cheque."),
});
export type ClearChequesInput = z.infer<typeof clearChequesInput>;

export const bounceChequeInput = z.object({
  chequeId: z.string().min(1),
  reason: z
    .string()
    .trim()
    .min(3, "Say why the bank returned it — DAIF, DAUD, account closed.")
    .max(200),
});
export type BounceChequeInput = z.infer<typeof bounceChequeInput>;

export type ChequeDto = {
  id: string;
  chequeNo: string;
  bank: string | null;
  chequeDate: string | null;
  status: ChequeStatus;
  statusLabel: string;
  /** From the tender line — the cheque's face value. */
  amount: string;
  customerId: string | null;
  customerName: string;
  /** The receipt this cheque paid for. */
  documentNo: string | null;
  joNumber: string | null;
  receivedAt: string;
  /** True when the cheque is the receipt's ONLY tender — see the service. */
  isSoleTender: boolean;
  /** True once the receipt it paid for has been cancelled. */
  receiptCancelled: boolean;
  depositSlipNo: string | null;
  depositedAt: string | null;
  depositedByName: string | null;
  clearedAt: string | null;
  clearedByName: string | null;
  bouncedAt: string | null;
  bouncedByName: string | null;
  bounceReason: string | null;
};

export type ChequeRegisterDto = {
  rows: ChequeDto[];
  /** Over every cheque, not just the rows above (R7). */
  totals: Record<ChequeStatus, { count: number; amount: string }>;
};

export type BounceResultDto = {
  id: string;
  chequeNo: string;
  /** Whether the receipt it paid for was cancelled in the same breath. */
  receiptReversed: boolean;
  /** Set when the receipt could not be reversed automatically. */
  followUp: string | null;
};
