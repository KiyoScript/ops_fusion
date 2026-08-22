import { z } from "zod";
import { WithholdingKind } from "@/generated/prisma/enums";

// ══════════════════════════════════════════════════════════════════════════
// WITHHOLDING CERTIFICATE REGISTER — the paper behind the deduction.
//
// Recording that a customer withheld ₱5,000 closes the receivable. It does
// NOT get the ₱5,000 back. That takes the certificate — BIR Form 2307 for
// income tax, 2306 for withheld VAT — filed with the corresponding return.
// Money withheld with no certificate on file is money given away with the
// arithmetic right, so the register's first job is to list exactly that.
//
// The forms usually arrive quarterly, long after the payment. Collections
// must never wait on paperwork, which is why the withholding is recorded at
// the counter and matched to a certificate here, later, in a separate act.
// ══════════════════════════════════════════════════════════════════════════

export const WITHHOLDING_KIND_LABEL: Record<WithholdingKind, string> = {
  EWT_2307: "BIR 2307 — Income tax",
  VAT_2306: "BIR 2306 — Withheld VAT",
};

/** What the certificate is worth to us, and where it gets claimed. */
export const WITHHOLDING_KIND_HINT: Record<WithholdingKind, string> = {
  EWT_2307: "Creditable against our income tax return",
  VAT_2306: "Creditable against output VAT — 2550M / 2550Q",
};

/** Which allocation column each kind reconciles against. */
export const WITHHOLDING_KIND_FIELD = {
  EWT_2307: "ewtWithheld",
  VAT_2306: "vatWithheld",
} as const satisfies Record<WithholdingKind, "ewtWithheld" | "vatWithheld">;

const money = z
  .string()
  .trim()
  .min(1, "Enter the amount on the certificate.")
  .regex(
    /^\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/,
    "Enter a valid amount."
  );

const optionalMoney = z
  .string()
  .trim()
  .regex(
    /^\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/,
    "Enter a valid amount."
  )
  .nullish()
  .or(z.literal(""));

const isoDate = z.iso.date().nullish();

// ——— create ———————————————————————————————————————————————————————————

export const createCertificateInput = z
  .object({
    customerId: z.string().min(1, "Choose a customer."),
    kind: z.enum(WithholdingKind),
    /**
     * The serial on the form. Optional, because a certificate is sometimes
     * logged as "promised for Q3" before the paper is in hand — and a blank
     * is not a duplicate, whereas an invented placeholder would be.
     */
    certificateNo: z.string().trim().max(60).nullish(),
    periodFrom: isoDate,
    periodTo: isoDate,
    amount: money,
    taxBase: optionalMoney,
    /** e.g. 2.00 — kept per certificate because it can differ by income type. */
    ratePct: z.coerce.number().min(0).max(100).nullish(),
    receivedAt: isoDate,
    notes: z.string().trim().max(500).nullish(),
    /**
     * The collection lines this form covers. One certificate commonly spans
     * several payments across a quarter, which is why the link points this
     * way rather than one-certificate-per-payment.
     */
    allocationIds: z.array(z.string().min(1)).default([]),
  })
  .refine(
    (v) => !v.periodFrom || !v.periodTo || v.periodFrom <= v.periodTo,
    { message: "The period ends before it starts.", path: ["periodTo"] }
  );

export type CreateCertificateInput = z.infer<typeof createCertificateInput>;

// ——— update ———————————————————————————————————————————————————————————
//
// `kind` and `customerId` are deliberately absent. Changing either would
// orphan every allocation already linked — the withheld VAT on a government
// job cannot become income tax, and cannot move to another customer, by
// editing a field. Void the certificate and record the right one.

export const updateCertificateInput = z
  .object({
    id: z.string().min(1),
    certificateNo: z.string().trim().max(60).nullish(),
    periodFrom: isoDate,
    periodTo: isoDate,
    amount: money,
    taxBase: optionalMoney,
    ratePct: z.coerce.number().min(0).max(100).nullish(),
    receivedAt: isoDate,
    notes: z.string().trim().max(500).nullish(),
  })
  .refine(
    (v) => !v.periodFrom || !v.periodTo || v.periodFrom <= v.periodTo,
    { message: "The period ends before it starts.", path: ["periodTo"] }
  );

export type UpdateCertificateInput = z.infer<typeof updateCertificateInput>;

// ——— linking ——————————————————————————————————————————————————————————

export const linkAllocationsInput = z.object({
  certificateId: z.string().min(1),
  allocationIds: z.array(z.string().min(1)).min(1, "Choose at least one."),
});

export type LinkAllocationsInput = z.infer<typeof linkAllocationsInput>;

export const unlinkAllocationsInput = z.object({
  certificateId: z.string().min(1),
  allocationIds: z.array(z.string().min(1)).min(1, "Choose at least one."),
});

export type UnlinkAllocationsInput = z.infer<typeof unlinkAllocationsInput>;

export const voidCertificateInput = z.object({
  id: z.string().min(1),
  reason: z.string().trim().min(3, "Say why — this is a tax record."),
});

export type VoidCertificateInput = z.infer<typeof voidCertificateInput>;

// ——— filters ——————————————————————————————————————————————————————————

export const CERTIFICATE_STATUS = {
  ALL: "ALL",
  /** Paper in hand — `receivedAt` set. */
  RECEIVED: "RECEIVED",
  /** Logged but the form has not arrived. */
  AWAITED: "AWAITED",
  /** Certificate total disagrees with the withholdings linked to it. */
  MISMATCHED: "MISMATCHED",
} as const;

export type CertificateStatus =
  (typeof CERTIFICATE_STATUS)[keyof typeof CERTIFICATE_STATUS];

export const certificateFilters = z.object({
  customerId: z.string().nullish(),
  kind: z.enum(WithholdingKind).nullish(),
  status: z.enum(CERTIFICATE_STATUS).default("ALL"),
  /** Matches the certificate PERIOD, not the date it was captured. */
  from: isoDate,
  to: isoDate,
  search: z.string().trim().nullish(),
});

export type CertificateFilters = z.infer<typeof certificateFilters>;

// ——— read models ——————————————————————————————————————————————————————

export type CertificateAllocationDto = {
  allocationId: string;
  crNumber: string | null;
  collectedAt: Date;
  /** The invoice the withholding was deducted from. */
  documentNo: string | null;
  joNumber: string | null;
  /** Withheld under THIS certificate's kind. */
  withheld: string;
  /** The VAT-exclusive base it was computed on. */
  vatableSales: string;
};

export type CertificateDto = {
  id: string;
  customerId: string;
  customerName: string;
  kind: WithholdingKind;
  certificateNo: string | null;
  periodFrom: Date | null;
  periodTo: Date | null;
  amount: string;
  taxBase: string | null;
  ratePct: string | null;
  receivedAt: Date | null;
  notes: string | null;
  hasFile: boolean;
  fileName: string | null;
  /** Sum of the withholdings linked to it. */
  linkedTotal: string;
  /**
   * `amount − linkedTotal`, signed. Non-zero is a flag for a human, never a
   * silent correction: either the customer's form is wrong or we have not
   * finished linking, and only a person can tell which.
   */
  variance: string;
  allocations: CertificateAllocationDto[];
  createdAt: Date;
  createdByName: string;
};

/** A withheld peso with no certificate against it — the chase list. */
export type OutstandingWithholdingDto = {
  allocationId: string;
  customerId: string;
  customerName: string;
  kind: WithholdingKind;
  crNumber: string | null;
  collectedAt: Date;
  documentNo: string | null;
  joNumber: string | null;
  withheld: string;
  vatableSales: string;
  /** Days since the money was withheld. Old ones are the ones we lose. */
  daysWaiting: number;
};

export type WithholdingRegisterDto = {
  certificates: CertificateDto[];
  outstanding: OutstandingWithholdingDto[];
  totals: {
    /** Everything withheld from us in range, certificate or not. */
    withheld: string;
    /** Backed by a certificate we hold. */
    certified: string;
    /** Withheld with nothing on file — at risk of being unclaimable. */
    uncertified: string;
    byKind: Record<
      WithholdingKind,
      { withheld: string; certified: string; uncertified: string }
    >;
  };
  customers: { id: string; name: string }[];
};
