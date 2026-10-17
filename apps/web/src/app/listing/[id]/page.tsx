import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/layout/page-placeholder";
import { t } from "@/lib/format/messages";

export const metadata: Metadata = { title: t("listing.title") };

// Placeholder until the listing detail page (P2.30).
export default function ListingPage() {
  return <PagePlaceholder title={t("listing.title")} />;
}
