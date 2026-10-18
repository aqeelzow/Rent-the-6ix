"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { t } from "@/lib/format/messages";

/**
 * Keeps a ward's crime rates hidden until the renter asks for them (SPEC 9.1's "Show
 * police-reported crime rates"). The disclaimer above it is always visible, so it's read first.
 */
export function CrimeReveal({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="text-primary focus-visible:ring-ring/50 flex items-center gap-1.5 self-start rounded-sm text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3"
      >
        <ChevronDown
          aria-hidden
          className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
        />
        {t(open ? "areas.crime.hide" : "areas.crime.show")}
      </button>
      <div id={id} hidden={!open} className="flex flex-col gap-3">
        {children}
      </div>
    </div>
  );
}
