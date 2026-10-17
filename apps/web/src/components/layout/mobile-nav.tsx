"use client";

import { MenuIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { t } from "@/lib/format/messages";
import { navLinks } from "./nav-links";

export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon-lg" className="md:hidden" aria-label={t("common.menu")}>
          <MenuIcon aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-72">
        <SheetHeader>
          <SheetTitle>{t("common.appName")}</SheetTitle>
        </SheetHeader>
        <nav aria-label={t("layout.nav.label")} className="flex flex-col gap-1 px-4">
          {navLinks.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className="hover:bg-accent focus-visible:ring-ring/50 flex items-center gap-3 rounded-md px-3 py-3 text-base font-medium outline-none focus-visible:ring-3"
            >
              <Icon aria-hidden className="text-muted-foreground size-5" />
              {t(label)}
            </Link>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
