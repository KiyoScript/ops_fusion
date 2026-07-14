import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { QuoteRequestForm } from "@/modules/quotations/components/quote-request-form";

export const metadata: Metadata = {
  title: "Get a Quote — Ormoc Printshoppe",
  description:
    "Tell us what you need printed and we'll get back to you with a quotation.",
};

// Public page (allowlisted in proxy.ts) — the ops_fusion successor of the
// legacy Customer.html portal. Submissions land in the staff Inquiries log.
export default function QuoteRequestPage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <p className="text-sm font-semibold tracking-wide text-primary">
            ORMOC PRINTSHOPPE
          </p>
          <CardTitle className="text-2xl">Get a Quote</CardTitle>
          <p className="text-sm text-muted-foreground">
            Tell us what you need — tarpaulin, shirts, mugs, signage, and
            more — and we&apos;ll send you a quotation.
          </p>
        </CardHeader>
        <CardContent>
          <QuoteRequestForm />
        </CardContent>
      </Card>
    </main>
  );
}
