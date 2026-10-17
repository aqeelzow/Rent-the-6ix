import assert from 'node:assert/strict';
import { test, vi } from 'vitest';

test('module reload replaces API handlers while preserving jobs across route bundles', async () => {
  const firstModule = await import('./runtime');
  const first = firstModule.getRuntime();
  assert.equal(firstModule.getRuntime(), first);
  const pending = first.jobs.start(async () => ({ status: 'completed', results: [], eligibleCount: 0, notices: [] }));
  assert.equal(pending.status, 'pending');
  if (pending.status !== 'pending') return;
  try {
    vi.resetModules();
    const second = (await import('./runtime')).getRuntime();
    assert.notEqual(second, first);
    assert.equal(second.jobs, first.jobs);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(second.jobs.poll(pending.jobToken).status, 'completed');
  } finally { first.jobs.dispose(); }
});
