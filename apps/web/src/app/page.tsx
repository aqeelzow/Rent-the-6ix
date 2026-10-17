import {
  ArrowRight,
  ClipboardPaste,
  MapIcon,
  Scale,
  SlidersHorizontal,
  Building2,
} from "lucide-react";
import Link from "next/link";
import { PromptBox } from "@/components/search/prompt-box";
import { t, type MessageKey } from "@/lib/format/messages";

const examples = ["student", "couple", "family"] as const;

const howItWorks = [
  { id: "filters", icon: SlidersHorizontal },
  { id: "price", icon: Scale },
  { id: "area", icon: Building2 },
] as const;

const secondary = [
  { href: "/areas", id: "areas", icon: MapIcon },
  { href: "/paste", id: "paste", icon: ClipboardPaste },
] as const;

function searchHref(prompt: string) {
  return `/search?q=${encodeURIComponent(prompt)}`;
}

export default function Home() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-12 px-4 py-10 sm:py-16">
      <section aria-labelledby="landing-title" className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <h1
            id="landing-title"
            className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl"
          >
            {t("landing.title")}
          </h1>
          <p className="text-muted-foreground text-lg text-pretty">{t("landing.subtitle")}</p>
        </div>

        <PromptBox />

        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm font-medium">{t("landing.examplesLabel")}</p>
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

      <section className="grid gap-3 sm:grid-cols-2">
        {secondary.map(({ href, id, icon: Icon }) => (
          <Link
            key={id}
            href={href}
            className="bg-card hover:bg-accent focus-visible:ring-ring/50 group flex gap-3 rounded-xl border p-4 outline-none focus-visible:ring-3"
          >
            <Icon aria-hidden className="text-primary mt-0.5 size-5 shrink-0" />
            <span className="flex flex-col gap-1">
              <span className="flex items-center gap-1 font-semibold">
                {t(`landing.${id}.title` as MessageKey)}
                <ArrowRight
                  aria-hidden
                  className="size-4 transition-transform group-hover:translate-x-0.5"
                />
              </span>
              <span className="text-muted-foreground text-sm">
                {t(`landing.${id}.body` as MessageKey)}
              </span>
            </span>
          </Link>
        ))}
      </section>

      <section aria-labelledby="how-title" className="flex flex-col gap-4">
        <h2 id="how-title" className="text-xl font-semibold tracking-tight">
          {t("landing.howTitle")}
        </h2>
        <ul className="grid gap-4 sm:grid-cols-3">
          {howItWorks.map(({ id, icon: Icon }) => (
            <li key={id} className="flex flex-col gap-2">
              <Icon aria-hidden className="text-primary size-5" />
              <h3 className="font-semibold">{t(`landing.how.${id}.title` as MessageKey)}</h3>
              <p className="text-muted-foreground text-sm">
                {t(`landing.how.${id}.body` as MessageKey)}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
