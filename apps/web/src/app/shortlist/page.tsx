import type { Metadata } from "next";
import { ShortlistView } from "@/components/shortlist/shortlist-view";
import { t } from "@/lib/format/messages";

export const metadata: Metadata = { title: t("shortlist.title") };

export default function ShortlistPage() {
  return <ShortlistView />;
}
