import { t } from "@/lib/format/messages";

/** Stand-in for pages that aren't built yet, so early deploys have no dead links. */
export function PagePlaceholder({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {children}
      <p className="text-muted-foreground">{t("common.comingSoon")}</p>
    </div>
  );
}
