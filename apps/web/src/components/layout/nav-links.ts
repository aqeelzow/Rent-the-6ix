import { Bookmark, type LucideIcon } from "lucide-react";
import type { MessageKey } from "@/lib/format/messages";

export const navLinks: {
  href: "/shortlist";
  label: MessageKey;
  icon: LucideIcon;
}[] = [{ href: "/shortlist", label: "layout.nav.shortlist", icon: Bookmark }];
