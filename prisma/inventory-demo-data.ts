// Realistic Inventory demo data for Ormoc Printshoppe — mirrors the legacy
// StockDatabase "AllItems" columns (code, name, location, unit, area, supplier,
// unitCost/pc, status, reorderLevel, unitPrice/bundle, packSize, offcut) plus an
// opening stock count. No "DEMO" markers — reads as legitimate seed data.
// Shared by seed-inventory-demo.ts and unseed-inventory-demo.ts.

export type DemoSupplier = {
  code: string;
  name: string;
  contactPerson?: string;
  phone?: string;
};

export type DemoMaterial = {
  code: string;
  name: string;
  category: string;
  location: string;
  area: string;
  unit: string;
  packSize: number; // pcs per bundle; 0 ⇒ by piece
  unitCost: number; // per pc
  unitPrice?: number; // per bundle
  reorderLevel: number; // pcs
  possibleOffcut: boolean;
  supplierCode?: string;
  openingQty: number; // pcs
};

export const DEMO_SUPPLIERS: DemoSupplier[] = [
  { code: "WYT", name: "Warren Yu Trading", contactPerson: "Warren Yu", phone: "0917 555 0110" },
  { code: "PPC", name: "Prestige Paper Corporation", contactPerson: "Ana Lim", phone: "0917 555 0220" },
  { code: "SSP", name: "Sticker Supply PH", contactPerson: "Marco Reyes", phone: "0917 555 0330" },
];

export const DEMO_MATERIALS: DemoMaterial[] = [
  { code: "PAP-001", name: "Bond Paper A4 sub20", category: "Paper", location: "Storeroom", area: "Shelf A", unit: "sheet", packSize: 500, unitCost: 0.5, unitPrice: 250, reorderLevel: 2000, possibleOffcut: false, supplierCode: "PPC", openingQty: 8000 },
  { code: "PAP-002", name: "Bond Paper Long sub20", category: "Paper", location: "Storeroom", area: "Shelf A", unit: "sheet", packSize: 500, unitCost: 0.55, unitPrice: 275, reorderLevel: 1500, possibleOffcut: false, supplierCode: "PPC", openingQty: 5000 },
  { code: "INK-001", name: "Eco-Solvent Ink Black 1L", category: "Ink", location: "Ink Cabinet", area: "Bin 1", unit: "bottle", packSize: 0, unitCost: 1200, reorderLevel: 3, possibleOffcut: false, supplierCode: "WYT", openingQty: 2 },
  { code: "TAR-001", name: "Tarpaulin Roll 10oz 8ft", category: "Tarpaulin", location: "Roll Rack", area: "Rack 1", unit: "roll", packSize: 0, unitCost: 2400, reorderLevel: 2, possibleOffcut: true, supplierCode: "WYT", openingQty: 5 },
  { code: "LAM-001", name: "Cold Laminate Film 50in", category: "Laminate", location: "Roll Rack", area: "Rack 2", unit: "roll", packSize: 0, unitCost: 1800, reorderLevel: 2, possibleOffcut: true, supplierCode: "WYT", openingQty: 4 },
  { code: "EYE-001", name: "Eyelets #12 Silver", category: "Hardware", location: "Hardware", area: "Bin 3", unit: "pc", packSize: 1000, unitCost: 0.8, unitPrice: 800, reorderLevel: 2000, possibleOffcut: false, supplierCode: "WYT", openingQty: 5000 },
  { code: "VIN-001", name: "Sticker Vinyl Glossy 54in", category: "Vinyl", location: "Roll Rack", area: "Rack 3", unit: "roll", packSize: 0, unitCost: 2200, reorderLevel: 2, possibleOffcut: true, supplierCode: "SSP", openingQty: 3 },
  { code: "GLU-001", name: "Rubber Cement 1 gal", category: "Adhesive", location: "Storeroom", area: "Shelf B", unit: "can", packSize: 0, unitCost: 450, reorderLevel: 3, possibleOffcut: false, supplierCode: "WYT", openingQty: 4 },
];

export const DEMO_MATERIAL_CODES = DEMO_MATERIALS.map((m) => m.code);
export const DEMO_SUPPLIER_NAMES = DEMO_SUPPLIERS.map((s) => s.name);
