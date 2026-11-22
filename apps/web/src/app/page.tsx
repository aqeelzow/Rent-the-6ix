import { ArrowDown } from "lucide-react";
import Link from "next/link";
import { HeroScene, SayScene, StreetcarScene } from "@/components/landing/scenes";
import { ScrollScenes } from "@/components/landing/scroll-scenes";
import { PromptBox } from "@/components/search/prompt-box";
import { t, type MessageKey } from "@/lib/format/messages";
import "@/components/landing/landing.css";

const examples = ["student", "couple", "family"] as const;

function searchHref(prompt: string) {
  return `/search?q=${encodeURIComponent(prompt)}`;
}

export default async function Home({ searchParams }: PageProps<"/">) {
  // "Change request" on /search comes back to #start with the prompt, so it can be edited.
  const { q } = await searchParams;
  const prompt = typeof q === "string" ? q.slice(0, 4000) : "";

  return (
    <div className="landing">
      <ScrollScenes />
      <HeroScene />
      <SayScene />
      <StreetcarScene />
      <a href="#start" className="jump">
        {t("landing.jump")}
        <ArrowDown aria-hidden className="size-4" />
      </a>

      <div id="start" className="landing-start">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-12 px-4 pt-16 pb-20 sm:pt-24">
          <section aria-labelledby="start-title" className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <h2 id="start-title" className="start-title text-balance">
                {t("landing.start.title")}
              </h2>
              <p className="text-lg text-pretty text-[var(--ink-soft)]">{t("landing.subtitle")}</p>
            </div>

            <PromptBox defaultPrompt={prompt} />

            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-[var(--ink-soft)]">
                {t("landing.examplesLabel")}
              </p>
              <ul className="flex flex-col gap-2">
                {examples.map((id) => {
                  const prompt = t(`landing.examples.${id}.prompt` as MessageKey);
                  return (
                    <li key={id}>
                      <Link
                        href={searchHref(prompt)}
                        className="bg-card hover:bg-accent focus-visible:ring-ring/50 flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-3"
                      >
                        <span className="font-medium">
                          {t(`landing.examples.${id}.label` as MessageKey)}
                        </span>
                        <span className="text-muted-foreground line-clamp-2">{prompt}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
