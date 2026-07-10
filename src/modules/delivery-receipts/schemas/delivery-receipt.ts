import { z } from "zod";

// DR issuance (spec 3.2): pick a completed JO, then deliver whole or partial
// quantities per line item. Advance-payment application is deferred until the
// Sales module lands (see the service TODO).

export const issueDrInput = z.object({
  jobOrderId: z.string().min(1, "Job order is required."),
  drNumber: z.string().trim().max(60).optional(), // blank → auto-generated
  notes: z.string().trim().max(2000).optional(),
  lines: z
    .array(
      z.object({
        jobOrderItemId: z.string().min(1),
        // qty to deliver on this DR; "0" means skip the line
        qty: z
          .string()
          .trim()
          .regex(/^\d+$/, "Qty must be a whole number"),
      })
    )
    .min(1, "Add at least one line item."),
});

export const drListFilters = z.object({
  q: z.string().trim().max(200).optional(),
  cursor: z.string().optional(),
  take: z.coerce.number().int().min(1).max(100).default(25),
});

export type IssueDrInput = z.infer<typeof issueDrInput>;
export type DrListFilters = z.infer<typeof drListFilters>;

// ——— DTOs ———

/** A JO with items that still have undelivered quantity (issue picker). */
export type DeliverableItemDto = {
  id: string;
  lineItemId: string;
  description: string;
  qty: number;
  qtyDelivered: number;
  remaining: number;
  unitPrice: string;
  lineTotal: string;
};

export type DeliverableJoDto = {
  jobOrderId: string;
  joNumber: string;
  customerId: string;
  customerName: string;
  completedAt: string | null;
  items: DeliverableItemDto[];
};

export type DrListRowDto = {
  id: string;
  drNumber: string;
  joNumber: string;
  customerName: string;
  status: string;
  issuedAt: string;
  lineCount: number;
  totalQty: number;
  amount: string;
};

export type DrListPageDto = {
  rows: DrListRowDto[];
  nextCursor: string | null;
};

export type DrLineDetailDto = {
  id: string;
  description: string;
  lineItemId: string;
  qty: number;
  unitPrice: string;
  lineTotal: string;
};

export type DrDetailDto = {
  id: string;
  drNumber: string;
  status: string;
  issuedAt: string;
  notes: string | null;
  createdByName: string;
  jobOrder: { id: string; joNumber: string };
  customer: {
    id: string;
    name: string;
    address: string | null;
    tin: string | null;
    company: string | null;
  };
  amount: string;
  lines: DrLineDetailDto[];
  // TODO(SALES): advancePaymentApplied / balance once Sales is integrated
};
