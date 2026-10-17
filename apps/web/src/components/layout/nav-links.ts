import { BookOpen, Bookmark, ClipboardPaste, MapIcon, type LucideIcon } from "lucide-react";
import type { MessageKey } from "@/lib/format/messages";

export const navLinks: {
  href: "/areas" | "/paste" | "/shortlist" | "/data";
  label: MessageKey;
  icon: LucideIcon;
}[] = [
  { href: "/areas", label: "layout.nav.areas", icon: MapIcon },
  { href: "/paste", label: "layout.nav.paste", icon: ClipboardPaste },
  { href: "/shortlist", label: "layout.nav.shortlist", icon: Bookmark },
  { href: "/data", label: "layout.nav.data", icon: BookOpen },
];
