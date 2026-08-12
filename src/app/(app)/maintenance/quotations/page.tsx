import { redirect } from "next/navigation";

// Product + pricing management moved to Masters → Products (the catalog's
// logical home). This former "Quotation Maintenance" price-list page is kept
// only as a redirect so existing links/bookmarks don't 404.
export default function QuotationMaintenanceRedirect() {
  redirect("/products");
}
