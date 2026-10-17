// Worker schedule (SPEC 8.4): run a job now and then every interval, never two at once.
// A run that overruns its slot starts the next one as soon as it finishes; a failed run is logged
// and the schedule carries on.
export interface Schedule {
  stop(): void;
}

export function every(
  intervalMs: number,
  name: string,
  job: () => Promise<unknown>,
  log: (message: string) => void = console.log,
): Schedule {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  async function tick() {
    const startedAt = Date.now();
    log(`${name}: started`);
    try {
      await job();
      log(`${name}: finished in ${Math.round((Date.now() - startedAt) / 1000)} s`);
    } catch (error) {
      log(`${name}: failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (stopped) return;
    const wait = Math.max(0, startedAt + intervalMs - Date.now());
    log(`${name}: next run at ${new Date(Date.now() + wait).toISOString()}`);
    timer = setTimeout(tick, wait);
  }

  void tick();
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
