import { redirect } from "next/navigation";

// Paste a listing is switched off (team decision, 2026-10-17); old links land on search.
export default function PastePage() {
  redirect("/search");
}
