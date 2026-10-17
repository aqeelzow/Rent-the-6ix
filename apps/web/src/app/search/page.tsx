import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/layout/page-placeholder";
import { t } from "@/lib/format/messages";

export const metadata: Metadata = { title: t("search.title") };

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const { q } = await searchParams;
  const prompt = typeof q === "string" ? q : undefined;

  return (
    <PagePlaceholder title={t("search.title")}>
      {prompt && (
        <p className="bg-card rounded-lg border p-3">
          <span className="text-muted-foreground block text-sm">{t("search.yourRequest")}</span>
          {prompt}
        </p>
      )}
    </PagePlaceholder>
  );
}
