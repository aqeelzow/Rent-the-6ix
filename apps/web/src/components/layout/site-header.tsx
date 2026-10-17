import { Bookmark } from "lucide-react";
import Link from "next/link";
import { CnTower } from "@/components/brand/cn-tower";
import { ShortlistCount } from "@/components/shortlist/shortlist-count";
import { t } from "@/lib/format/messages";
import { MobileNav } from "./mobile-nav";
import { navLinks } from "./nav-links";
import { ThemeToggle } from "./theme-toggle";

export function SiteHeader() {
  return (
    <header className="bg-background/95 sticky top-0 z-40 border-b backdrop-blur">
      <a
        href="#main"
        className="bg-primary text-primary-foreground sr-only z-50 rounded-md px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        {t("layout.skipToContent")}
      </a>
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4">
        <Link
          href="/"
          aria-label={t("layout.homeLink")}
          className="flex items-center gap-2 text-lg font-semibold tracking-tight"
        >
          <span aria-hidden className="text-primary">
            <CnTower id="header" className="h-8 w-auto" />
          </span>
          {t("common.appName")}
        </Link>
        <nav aria-label={t("layout.nav.label")} className="hidden items-center gap-1 md:flex">
          {navLinks.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium outline-none focus-visible:ring-3"
            >
              <Icon aria-hidden className="size-4" />
              {t(label)}
              {href === "/shortlist" && <ShortlistCount />}
            </Link>
          ))}
          <ThemeToggle />
        </nav>
        <div className="flex items-center gap-1 md:hidden">
          {/* The shortlist stays one tap away on phones, not only inside the menu. */}
          <Link
            href="/shortlist"
            className="hover:bg-accent focus-visible:ring-ring/50 flex h-10 items-center gap-1.5 rounded-md px-2.5 outline-none focus-visible:ring-3"
          >
            <Bookmark aria-hidden className="size-5" />
            <span className="sr-only">{t("layout.nav.shortlist")}</span>
            <ShortlistCount />
          </Link>
          <ThemeToggle />
          <MobileNav />
        </div>
      </div>
    </header>
  );
}
