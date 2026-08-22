import { redirect } from "next/navigation";

// The Archive JOs page was replaced by Transactions History (a filterable
// ledger of the whole JO book). Old links/bookmarks land there.
export default function ArchiveJosPage() {
  redirect("/job-orders/transactions");
}
