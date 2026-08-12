// The standardized production workflow (ruling 2026-08-12 — a fixed standard,
// replacing the editable GlobalProductionStep list). Steps a line item moves
// through, in order:
//   • LFP items (large-format): Layout → Plotting → Printing
//   • every applicable item: Capture (only when the JO opts in) → DR
// LFP-ness comes from the product (Product.isLFP), Capture from the per-JO
// needsCapture toggle. Copied onto JobOrderItemStep when a JO item is created.

export const LFP_PRODUCTION_STEPS = ["Layout", "Plotting", "Printing"] as const;
export const CAPTURE_STEP = "Capture";
export const DR_STEP = "DR";

/** Ordered step names for one line item: LFP steps (if large-format) → Capture
 *  (if the JO opted in) → DR. */
export function standardWorkflowSteps(
  isLFP: boolean,
  needsCapture: boolean
): string[] {
  return [
    ...(isLFP ? LFP_PRODUCTION_STEPS : []),
    ...(needsCapture ? [CAPTURE_STEP] : []),
    DR_STEP,
  ];
}
