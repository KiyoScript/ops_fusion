// Ormoc Printshoppe business details (from the official BIR-registered forms).
// Used on printed documents (JO printable, Delivery Receipt, etc.).
export const COMPANY = {
  name: "ORMOC PRINTSHOPPE",
  tagline: "PRINTING & GRAPHIC DESIGN SERVICES",
  address: "Agua Dulce St., Brgy. South 6541, Ormoc City, Leyte Philippines",
  tel: "(053) 520-7035 · 0963-1220016",
  proprietor: "JOEL NGO — Proprietor",
  vatTin: "VAT Reg. TIN: 197-783-797-00000",
  // Delivery Receipt booklet (BIR Authority to Print)
  dr: {
    atpNo: "BIR Authority to Print No.: 089AU20240000004334",
    atpDate: "Date Issued: September 11, 2024",
    series: "Approved Series: 7501-12500 · 100 BKLTS (2X)",
    accreditation: "Printer's Accreditation No.: 089MP20240000000008",
    accreditationDate: "Date Issued: August 14, 2024",
    disclaimer: "THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX",
  },
} as const;
