import type { Metadata } from "next";
import { PasteView } from "@/components/paste/paste-view";
import { t } from "@/lib/format/messages";

export const metadata: Metadata = { title: t("layout.nav.paste") };

export default function PastePage() {
  return <PasteView />;
}
