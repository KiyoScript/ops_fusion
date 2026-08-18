// Subject + body for the "Send Credit Application Email" button. Fixed template
// with the company name populated. The Credit Information and Application Form
// PDF is attached by the action.
export function buildCreditApplicationEmail(companyName: string): {
  subject: string;
  body: string;
} {
  const name = companyName?.trim() || "Valued Customer";
  const subject = "Credit Line Application – Ormoc Printshoppe";
  const body = [
    `Dear ${name},`,
    "",
    "Thank you for your interest in establishing a credit line with Ormoc Printshoppe. We appreciate the opportunity to serve your printing requirements and build a long-term business relationship with your company.",
    "",
    "To begin the application process, please accomplish the attached Credit Information and Application Form and provide the requested information, including your company details, bank and supplier references, authorized signatories, preferred credit limit, and credit terms.",
    "",
    "Kindly submit the completed form together with the following supporting documents:",
    "• DTI or SEC Registration, as applicable",
    "• Mayor's Business Permit",
    "• BIR Certificate of Registration (Form 2303)",
    "",
    "Please ensure that the information provided is complete and accurate to facilitate our evaluation.",
    "",
    "Please note that submission of the application does not automatically guarantee approval. All credit applications are subject to review and approval by Ormoc Printshoppe Management. The approved credit limit and payment terms may differ from those requested based on the results of the evaluation.",
    "",
    "Once the application has been reviewed, we will advise you of the approved credit limit, payment terms, and applicable credit arrangements.",
    "",
    "Thank you for considering Ormoc Printshoppe as your printing partner. We look forward to serving you.",
    "",
    "Best regards,",
    "Joel Ngo",
    "President, Ormoc Printshoppe",
  ].join("\n");
  return { subject, body };
}
