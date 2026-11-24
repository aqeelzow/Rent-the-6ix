"use client";

import { useState, type ReactNode } from "react";

/**
 * A listing's cover photo, hot-linked from the source (SPEC 8.4). Shows `fallback` instead when
 * the link stops loading, as Facebook's do after a few days.
 */
export function ListingPhoto({
  src,
  fallback,
  className,
}: {
  src: string | null | undefined;
  fallback: ReactNode;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) return fallback;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      className={className}
      onError={() => setFailed(src)}
    />
  );
}
