"use client";

import { useEffect } from "react";
import { startPersistence } from "@/lib/store/persist";

/** Loads the shortlist from this browser and keeps it saved (SPEC 15). Renders nothing. */
export function StorePersistence() {
  useEffect(() => startPersistence(), []);
  return null;
}
