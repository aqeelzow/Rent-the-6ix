import type { Metadata } from "next";
import { SearchView } from "@/components/search/search-view";
import { t } from "@/lib/format/messages";

export const metadata: Metadata = { title: t("search.title") };

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const { q } = await searchParams;
  const prompt = typeof q === "string" && q.trim() ? q.trim() : null;

  // Keyed by prompt so a new search starts from a fresh view.
  return <SearchView key={prompt ?? ""} prompt={prompt} />;
}
