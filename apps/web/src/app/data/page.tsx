import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/layout/page-placeholder";
import { t } from "@/lib/format/messages";

export const metadata: Metadata = { title: t("layout.nav.data") };

export default function DataPage() {
  return <PagePlaceholder title={t("layout.nav.data")} />;
}
