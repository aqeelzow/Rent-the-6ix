"use client";

import { useEffect } from "react";

/**
 * Drives the landing parallax. Each `[data-scene]` element gets `--p`, its scroll progress from 0
 * (top reaches the top of the viewport) to 1 (bottom reaches the bottom); landing.css turns that
 * into motion. With reduced motion, scenes are static and `--p` is the scene's `data-still` value.
 */
export function ScrollScenes() {
  useEffect(() => {
    const scenes = Array.from(document.querySelectorAll<HTMLElement>("[data-scene]"));
    const landing = document.querySelector<HTMLElement>(".landing");
    const start = document.getElementById("start");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      for (const scene of scenes) scene.style.setProperty("--p", scene.dataset.still ?? "1");
      return;
    }

    let frame = 0;
    const update = () => {
      frame = 0;
      const vh = window.innerHeight;
      for (const scene of scenes) {
        const rect = scene.getBoundingClientRect();
        const range = rect.height - vh;
        const p = range > 0 ? Math.min(1, Math.max(0, -rect.top / range)) : 0;
        scene.style.setProperty("--p", p.toFixed(4));
      }
      // Hide "Skip to search" once the search section is on screen.
      if (landing && start) {
        landing.toggleAttribute("data-at-start", start.getBoundingClientRect().top < vh * 0.6);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  return null;
}
