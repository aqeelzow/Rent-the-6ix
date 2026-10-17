import Link from "next/link";
import { t } from "@/lib/format/messages";

export function SiteFooter() {
  return (
    <footer className="text-muted-foreground border-t text-sm">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-6 sm:flex-row sm:items-center sm:justify-between">
        <p>{t("layout.footer.askingRents")}</p>
        <nav aria-label={t("layout.footer.label")} className="flex gap-4">
          <Link href="/data" className="hover:text-foreground underline-offset-4 hover:underline">
            {t("layout.footer.data")}
          </Link>
          <Link href="/status" className="hover:text-foreground underline-offset-4 hover:underline">
            {t("layout.footer.status")}
          </Link>
        </nav>
      </div>
    </footer>
  );
}
