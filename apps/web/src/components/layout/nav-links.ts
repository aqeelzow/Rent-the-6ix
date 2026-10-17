import { BookOpen, ClipboardPaste, MapIcon, type LucideIcon } from "lucide-react";
import type { MessageKey } from "@/lib/format/messages";

export const navLinks: {
  href: "/areas" | "/paste" | "/data";
  label: MessageKey;
  icon: LucideIcon;
}[] = [
  { href: "/areas", label: "layout.nav.areas", icon: MapIcon },
  { href: "/paste", label: "layout.nav.paste", icon: ClipboardPaste },
  { href: "/data", label: "layout.nav.data", icon: BookOpen },
];
