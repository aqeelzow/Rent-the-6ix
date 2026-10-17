import type { CSSProperties } from "react";
import { CnTower } from "@/components/brand/cn-tower";
import { t, type MessageKey } from "@/lib/format/messages";
import { FarSkyline, MidBlocks, NearStreet, Streetcar } from "./skyline";

type Vars = CSSProperties & Record<`--${string}`, string | number>;

/** Night over the city: the wordmark sits between the downtown towers and the street, which rises over it. */
export function HeroScene() {
  return (
    <section data-scene data-still="0" className="scene scene-hero" aria-labelledby="hero-title">
      <div className="scene-stage">
        <div className="hero-sky" />
        <FarSkyline className="layer layer-far" />
        <div className="hero-mark">
          <p className="hero-tagline">{t("landing.tagline")}</p>
          <h1 id="hero-title" className="wordmark" aria-label={t("common.appName")}>
            <span className="wordmark-top">{t("landing.logoTop")}</span>
            <span className="wordmark-big">
              {t("landing.logoBottom")
                .split(/(i)/i)
                .map((part, i) =>
                  /^i$/i.test(part) ? (
                    <CnTower key={i} id="wordmark" className="wordmark-tower" />
                  ) : (
                    part
                  ),
                )}
            </span>
          </h1>
        </div>
        <MidBlocks className="layer layer-mid" />
        <div className="layer-near">
          <NearStreet className="layer-near-street" />
          <div className="layer-near-fill" />
        </div>
        <p className="scroll-cue" aria-hidden>
          {t("landing.scrollCue")}
          <span />
        </p>
      </div>
    </section>
  );
}

const chips = [
  { id: "beds", must: true, x: "18%", y: "30%", depth: 1.6 },
  { id: "near", must: false, x: "76%", y: "24%", depth: 2.6 },
  { id: "rent", must: true, x: "30%", y: "68%", depth: 2.1 },
  { id: "pets", must: true, x: "72%", y: "62%", depth: 1.2 },
  { id: "ac", must: false, x: "52%", y: "46%", depth: 3 },
] as const;

/** The prompt types itself out as you scroll, then breaks into filter chips. */
export function SayScene() {
  const prompt = t("landing.say.prompt");
  const phrases = chips.map((c) => t(`landing.say.chips.${c.id}.phrase` as MessageKey));
  // Split the prompt into plain text and the phrases that become chips.
  const pattern = new RegExp(`(${phrases.map((p) => p.replace(/[$.]/g, "\\$&")).join("|")})`);
  const parts = prompt.split(pattern).filter(Boolean);
  let index = 0;

  return (
    <section data-scene className="scene scene-say" aria-labelledby="say-title">
      <div className="scene-stage">
        <h2 id="say-title" className="say-title">
          {t("landing.say.title")}
        </h2>
        <p className="say-prompt">
          <span className="sr-only">{prompt}</span>
          <span aria-hidden>
            {parts.map((part, i) => {
              const chars = Array.from(part).map((ch) => (
                <span key={index} className="ch" style={{ "--t": index++ / prompt.length } as Vars}>
                  {ch}
                </span>
              ));
              return phrases.includes(part) ? (
                <span key={i} className="phrase">
                  {chars}
                </span>
              ) : (
                chars
              );
            })}
          </span>
        </p>
        <ul className="say-chips">
          {chips.map((c) => (
            <li
              key={c.id}
              className={c.must ? "chip chip-must" : "chip"}
              style={{ "--x": c.x, "--y": c.y, "--d": c.depth } as Vars}
            >
              {t(`landing.say.chips.${c.id}.label` as MessageKey)}
            </li>
          ))}
        </ul>
        <p className="say-caption">{t("landing.say.caption")}</p>
      </div>
    </section>
  );
}

/** A streetcar drives across and pulls the page from night into morning. */
export function StreetcarScene() {
  return (
    <section data-scene className="scene scene-ride" aria-hidden>
      <div className="scene-stage">
        <div className="ride-morning" />
        <div className="wire" />
        <Streetcar className="streetcar" />
      </div>
    </section>
  );
}
