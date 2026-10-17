import { describe, expect, it } from "vitest";
import { htmlToText } from "./text.ts";

describe("htmlToText", () => {
  it("turns breaks into newlines, drops tags, decodes entities", () => {
    expect(
      htmlToText("<b>Renovated 1 bed</b>\n<br>Near Church &amp; Wellesley<br><br><br>- 1 bath"),
    ).toBe("Renovated 1 bed\nNear Church & Wellesley\n\n- 1 bath");
    expect(
      htmlToText("<p>Indoor parking: $175/month</p><p>Caf&eacute; &#233; &#x27;ok&#x27;</p>"),
    ).toBe("Indoor parking: $175/month\nCaf&eacute; é 'ok'");
  });
});
