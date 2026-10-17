import type { Metadata } from "next";
import { ListingDetail } from "@/components/listing/listing-detail";
import { t } from "@/lib/format/messages";

export const metadata: Metadata = { title: t("listing.title") };

export default async function ListingPage({ params }: PageProps<"/listing/[id]">) {
  const { id } = await params;
  // Keyed by id so moving between listings (e.g. a comparable) starts fresh.
  return <ListingDetail key={id} id={id} />;
}
