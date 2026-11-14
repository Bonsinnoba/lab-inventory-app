// One active refresh plus at most one trailing request. In particular, a slow
// native read must not produce an ever-growing queue on every polling tick.
export function createCoalescedRefresh() {
  let active: Promise<void> | null = null;
  let latest: (() => Promise<void>) | null = null;
  return {
    clear() { latest = null; },
    run(work: () => Promise<void>): Promise<void> {
      latest = work;
      if (active) return active;
      // Defer execution until active is assigned, including synchronous throws.
      active = Promise.resolve().then(async () => {
        while (latest) {
          const next = latest;
          latest = null;
          await next();
        }
      }).finally(() => { active = null; latest = null; });
      return active;
    },
  };
}
