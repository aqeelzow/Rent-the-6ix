import { BookOpen, Bookmark, MapIcon, type LucideIcon } from "lucide-react";
import type { MessageKey } from "@/lib/format/messages";

export const navLinks: {
  href: "/areas" | "/shortlist" | "/data";
  label: MessageKey;
  icon: LucideIcon;
}[] = [
  { href: "/areas", label: "layout.nav.areas", icon: MapIcon },
  { href: "/shortlist", label: "layout.nav.shortlist", icon: Bookmark },
  { href: "/data", label: "layout.nav.data", icon: BookOpen },
];
