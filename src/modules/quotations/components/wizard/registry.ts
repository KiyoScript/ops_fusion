// Products that have a dedicated step-by-step wizard. Product NAME → URL
// slug (must match the /quotations/new/<slug> route folder). Everything not
// listed here falls back to the generic full quotation form.
//
// Rollout: add a wizard component + a route folder + a line here.
export const WIZARD_SLUGS: Record<string, string> = {
  Tarpaulin: "tarpaulin",
  "Signage (Metal Frame)": "signage",
};
