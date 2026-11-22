import { describe, expect, it, vi } from "vitest";
import { addressLabel, loadBuilding } from "./building";

vi.mock("../db", () => ({ getClient: vi.fn(() => null) }));

describe("addressLabel", () => {
  it("writes City address points the way people do", () => {
    expect(addressLabel("330 PHILLIP ST")).toBe("330 Phillip St");
    expect(addressLabel("155 KING ST N")).toBe("155 King St N");
    expect(addressLabel("16 BARREL YARDS BLVD")).toBe("16 Barrel Yards Blvd");
  });
});

describe("loadBuilding", () => {
  it("never queries for a malformed slug", async () => {
    const sql = vi.fn();
    expect(await loadBuilding(sql as never, "ICON'; DROP")).toBeNull();
    expect(sql).not.toHaveBeenCalled();
  });
});
