"use client";

import { ArrowRight } from "lucide-react";
import Form from "next/form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/lib/format/messages";

/**
 * The landing prompt. A GET form to /search?q=…, so it works before JS loads; with JS, next/form
 * navigates client-side and /search reads the prompt with B's parser.
 */
export function PromptBox({ defaultPrompt = "" }: { defaultPrompt?: string }) {
  return (
    <Form action="/search" className="flex flex-col gap-3">
      <Label htmlFor="prompt" className="text-base">
        {t("landing.promptLabel")}
      </Label>
      <Textarea
        id="prompt"
        name="q"
        defaultValue={defaultPrompt}
        // Coming back to edit a request: focus it with the cursor at the end.
        autoFocus={defaultPrompt !== ""}
        onFocus={(event) => {
          const end = event.currentTarget.value.length;
          event.currentTarget.setSelectionRange(end, end);
        }}
        required
        maxLength={4000}
        rows={4}
        placeholder={t("landing.promptPlaceholder")}
        className="bg-card min-h-28 resize-y text-base md:text-base"
        onKeyDown={(event) => {
          // Enter searches; Shift+Enter adds a line.
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <Button type="submit" size="lg" className="h-11 self-stretch px-5 text-base sm:self-end">
        {t("landing.submit")}
        <ArrowRight aria-hidden data-icon="inline-end" />
      </Button>
    </Form>
  );
}
