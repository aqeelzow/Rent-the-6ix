import type { Metadata } from "next";
import { SearchView } from "@/components/search/search-view";
import { t } from "@/lib/format/messages";

export const metadata: Metadata = { title: t("search.title") };

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const { q, s } = await searchParams;
  const prompt = typeof q === "string" && q.trim() ? q.trim() : null;
  // A shared link's edited filters (SPEC 15); validated in the browser before use.
  const shared = typeof s === "string" && s ? s : null;

  // Keyed by prompt and filters so a new search starts from a fresh view.
  return <SearchView key={`${prompt ?? ""}|${shared ?? ""}`} prompt={prompt} shared={shared} />;
}
