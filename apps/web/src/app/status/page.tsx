import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/layout/page-placeholder";
import { t } from "@/lib/format/messages";

export const metadata: Metadata = { title: t("layout.footer.status") };

export default function StatusPage() {
  return <PagePlaceholder title={t("layout.footer.status")} />;
}
