import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { every } from "./schedule.ts";

const HOUR = 3_600_000;

describe("every", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs now, then once per interval", async () => {
    const job = vi.fn(async () => {});
    const schedule = every(6 * HOUR, "ingest", job, () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(job).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6 * HOUR - 1);
    expect(job).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(job).toHaveBeenCalledTimes(2);
    schedule.stop();
    await vi.advanceTimersByTimeAsync(12 * HOUR);
    expect(job).toHaveBeenCalledTimes(2);
  });

  it("can wait one interval before the first run", async () => {
    const log = vi.fn();
    const job = vi.fn(async () => {});
    const schedule = every(6 * HOUR, "ingest", job, log, { startNow: false });
    await vi.advanceTimersByTimeAsync(6 * HOUR - 1);
    expect(job).not.toHaveBeenCalled();
    expect(log.mock.calls[0][0]).toMatch(/^ingest: first run at /);
    await vi.advanceTimersByTimeAsync(1);
    expect(job).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6 * HOUR);
    expect(job).toHaveBeenCalledTimes(2);
    schedule.stop();
  });

  it("stops before a delayed first run", async () => {
    const job = vi.fn(async () => {});
    every(HOUR, "ingest", job, () => {}, { startNow: false }).stop();
    await vi.advanceTimersByTimeAsync(3 * HOUR);
    expect(job).not.toHaveBeenCalled();
  });

  it("never overlaps: a run longer than the interval delays the next one", async () => {
    let running = 0;
    let maxRunning = 0;
    const job = vi.fn(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 2 * HOUR));
      running--;
    });
    const schedule = every(HOUR, "ingest", job, () => {});
    await vi.advanceTimersByTimeAsync(5 * HOUR);
    schedule.stop();
    expect(maxRunning).toBe(1);
    expect(job).toHaveBeenCalledTimes(3);
  });

  it("logs a failed run and keeps going", async () => {
    const log = vi.fn();
    const job = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
    const schedule = every(HOUR, "ingest", job, log);
    await vi.advanceTimersByTimeAsync(HOUR);
    schedule.stop();
    expect(job).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith("ingest: failed: boom");
  });
});
