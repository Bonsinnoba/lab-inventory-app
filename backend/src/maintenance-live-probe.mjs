// Backward-compatible probe command; the versioned implementation has a stricter HTTP contract.
if (process.env.LABOS_LIVE_MAINTENANCE_PROBE !== '1') throw new Error('Set LABOS_LIVE_MAINTENANCE_PROBE=1');
process.env.LABOS_PHASE2_MAINTENANCE_PROBE = '1';
await import('./phase2-maintenance-live-probe.mjs');
