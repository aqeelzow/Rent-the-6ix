import { describe, expect, it } from "vitest";
import { leaseTermFromText, subletFromText } from "./normalize.ts";

const term = (text: string) => leaseTermFromText(text.toLowerCase());
const sublet = (text: string) => subletFromText(text.toLowerCase());

describe("leaseTermFromText", () => {
  it("reads stated lengths", () => {
    expect(term("Furnished room, 4 month sublet")).toBe("4 months");
    expect(term("8-month lease starting May")).toBe("8 months");
    expect(term("Sublet for 4 months, all utilities included")).toBe("4 months");
    expect(term("1 year lease required")).toBe("12 months");
    expect(term("Month-to-month after the first year")).toBe("month-to-month");
  });

  it("reads month ranges only on a lease or sublet", () => {
    expect(term("Furnished Room Sublet at ICON 330 | Jan - Apr 2027")).toBe("4 months");
    expect(term("Spring 2027 Sublet | Dates: May 1 to August 27, 2027")).toBe("4 months");
    expect(term("Lease takeover Sept–Dec")).toBe("4 months");
    expect(term("Room for sublet. Available: January 1 – May 1, 2027")).toBe("4 months");
    expect(term("Sublet May 1 – August 31")).toBe("4 months");
    expect(term("Available Jan - Apr, sunny 2 bed")).toBeNull();
  });

  it("treats one named co-op term on a sublet as 4 months", () => {
    expect(term("Icon room winter term sublet")).toBe("4 months");
    expect(term("Winter term or summer term sublet")).toBeNull();
  });

  it("leaves several offered lengths unknown", () => {
    expect(term("Rez-One Elora Ensuite Sublet Jan 2027 | 4 or 8 mo")).toBeNull();
    expect(term("4 month lease or 8 month lease")).toBeNull();
  });
});

describe("subletFromText", () => {
  it("finds sublets and lease takeovers", () => {
    expect(sublet("W27 Sublet: Fergus House")).toBe("yes");
    expect(sublet("Lease Takeover - 2-Bedroom on Amos St")).toBe("yes");
    expect(sublet("Looking for someone to take over my lease")).toBe("yes");
    expect(sublet("Subleasing my room for the summer")).toBe("yes");
  });

  it("never claims a sublet it can't see", () => {
    expect(sublet("Bright 2 bed apartment, 1 year lease")).toBe("unknown");
    expect(sublet("No subletting allowed")).toBe("unknown");
  });
});
