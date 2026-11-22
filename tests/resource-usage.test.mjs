import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectUsage, normalizeInstaBoxMetrics, normalizeInstaBoxDisk,
  normalizeFirecrawlCurrent, normalizeFirecrawlHistory,
  normalizeCloudflareWorkers, normalizeCloudflareKV, normalizeCloudflareD1, normalizeCloudflareR2,
} from '../server/resources/usage.mjs';

const now = new Date('2026-11-22T23:00:00Z');
const checkedAt = '2026-11-22T22:59:30.000Z';
const gib = 1024 ** 3;
const sample = overrides => ({ timestamp: checkedAt, cpuUsedPct: 25, cpuCount: 4,
  memUsed: 2 * gib, memTotal: 8 * gib, diskTotal: 20 * gib, ...overrides });
const samples = overrides => ({ metrics: [sample(overrides)] });
const disk = (overrides = {}, root = {}) => ({ measuredAt: '2026-11-22T22:55:00Z',
  filesystems: [{ mount: '/data', sizeBytes: 20 * gib, usedBytes: 5 * gib,
    availableBytes: 10 * gib, usedPct: 33.333, ...overrides }], ...root });
const current = overrides => ({ success: true, data: {
  remainingCredits: 1025, planCredits: 1000,
  billingPeriodStart: '2026-11-08T09:02:09.578Z',
  billingPeriodEnd: '2026-12-08T09:02:09.578Z', ...overrides,
} });
const period = overrides => ({ startDate: current().data.billingPeriodStart,
  endDate: current().data.billingPeriodEnd, totalCredits: 200, ...overrides });
const graphql = (dataset, rows) => ({ data: { viewer: { accounts: [{ [dataset]: rows }] } }, errors: null });
const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('InstaBox CPU and RAM share one real, fresh sample and same-unit denominators', () => {
  const [cpu, memory] = normalizeInstaBoxMetrics(samples(), { now });
  assert.equal(cpu.key, 'cpu');
  assert.equal(cpu.used, 1);
  assert.equal(cpu.limit, 4);
  assert.equal(cpu.unit, 'vCPU');
  assert.equal(cpu.percent, 25);
  assert.equal(cpu.displayValue, '1 / 4 vCPU');
  assert.equal(memory.used, 2 * gib);
  assert.equal(memory.limit, 8 * gib);
  assert.equal(memory.unit, 'bytes');
  assert.equal(memory.percent, 25);
  assert.equal(memory.displayValue, '2 / 8 GiB');
  assert.equal(memory.checkedAt, checkedAt);
});

test('explicit zero CPU, memory, disk and credits are observed values', () => {
  for (const metric of normalizeInstaBoxMetrics(samples({ cpuUsedPct: 0, memUsed: 0 }), { now })) {
    assert.equal(metric.used, 0);
    assert.equal(metric.percent, 0);
  }
  assert.equal(normalizeInstaBoxDisk(disk({ usedBytes: 0 }), { now })[0].used, 0);
  const credits = normalizeFirecrawlCurrent(current({ remainingCredits: 0, planCredits: 0 }), { now });
  assert.equal(credits[0].remaining, 0);
  assert.equal(credits[1].value, 0);
});

test('tiny positive readings do not format to a false zero', () => {
  const [cpu, memory] = normalizeInstaBoxMetrics(samples({ cpuUsedPct: 0.01, memUsed: 1 }), { now });
  assert.equal(cpu.used, 0.0004);
  assert.notEqual(cpu.displayValue, '0 / 4 vCPU');
  assert.equal(memory.displayValue, '1 B / 8 GiB');
});

for (const invalid of [-1, NaN, Infinity, 101, '25', null]) {
  test(`invalid normalized CPU ${String(invalid)} is not a utilization reading`, () => {
    const metrics = normalizeInstaBoxMetrics(samples({ cpuUsedPct: invalid }), { now });
    assert.deepEqual(metrics.map(metric => metric.key), ['memory']);
  });
}

test('missing, negative and nonfinite memory values do not become zero', () => {
  for (const memUsed of [undefined, null, -1, NaN, Infinity, '20']) {
    assert.deepEqual(normalizeInstaBoxMetrics(samples({ memUsed }), { now }).map(metric => metric.key), ['cpu']);
  }
  assert.equal(normalizeInstaBoxMetrics(samples({ cpuCount: 0, memTotal: 0 }), { now }).length, 0);
});

test('a genuine used/limit overflow is preserved for a visually clamped bar', () => {
  const memory = normalizeInstaBoxMetrics(samples({ memUsed: 9 * gib }), { now }).find(m => m.key === 'memory');
  assert.equal(memory.used, 9 * gib);
  assert.equal(memory.limit, 8 * gib);
  assert.equal(memory.percent, 112.5);
  const storage = normalizeInstaBoxDisk(disk({ usedBytes: 21 * gib }), { now })[0];
  assert.equal(storage.percent, 105);
});

test('paused, stopped, stale and future machine samples do not become current values', () => {
  for (const state of ['paused', 'suspended', 'stopped', 'starting']) {
    assert.deepEqual(normalizeInstaBoxMetrics(samples(), { now, state }), []);
  }
  assert.equal(normalizeInstaBoxMetrics(samples({ timestamp: '2026-11-22T22:58:00Z' }), { now }).length, 2);
  for (const timestamp of ['2026-11-22T22:57:59Z', '2026-11-22T23:00:01Z', 'not a time', '2026-11-22']) {
    assert.deepEqual(normalizeInstaBoxMetrics(samples({ timestamp }), { now }), []);
  }
  assert.deepEqual(normalizeInstaBoxMetrics({ metrics: [] }, { now }), []);
});

test('the latest sample is selected without borrowing a denominator from older samples', () => {
  const body = { metrics: [sample(), sample({ timestamp: '2026-11-22T22:59:50Z', memTotal: undefined })] };
  const metrics = normalizeInstaBoxMetrics(body, { now });
  assert.deepEqual(metrics.map(metric => metric.key), ['cpu']);
  assert.equal(metrics[0].checkedAt, '2026-11-22T22:59:50.000Z');
});

test('disk fullness uses actual size, not df available-space percentage', () => {
  const [metric] = normalizeInstaBoxDisk(disk(), { now });
  assert.equal(metric.percent, 25);
  assert.equal(metric.used, 5 * gib);
  assert.equal(metric.limit, 20 * gib);
  assert.equal(metric.checkedAt, '2026-11-22T22:55:00.000Z');
  assert.notEqual(metric.checkedAt, checkedAt);
});

test('disk requires its own fresh /data measurement', () => {
  assert.deepEqual(normalizeInstaBoxDisk(disk({ mount: '/' }), { now }), []);
  assert.deepEqual(normalizeInstaBoxDisk(disk({}, { measuredAt: '2026-11-22T22:49:59Z' }), { now }), []);
  assert.deepEqual(normalizeInstaBoxDisk(disk({}, { measuredAt: '2026-11-22T23:00:01Z' }), { now }), []);
  assert.deepEqual(normalizeInstaBoxDisk(disk(), { now, state: 'paused' }), []);
  assert.deepEqual(normalizeInstaBoxDisk(disk({ sizeBytes: 0 }), { now }), []);
  assert.deepEqual(normalizeInstaBoxDisk(disk({ usedBytes: -1 }), { now }), []);
  assert.deepEqual(normalizeInstaBoxDisk({ ...disk(), filesystems: [...disk().filesystems, ...disk().filesystems] }, { now }), []);
});

test('Firecrawl extra credits remain an absolute balance, separate from plan', () => {
  const [balance, plan] = normalizeFirecrawlCurrent(current(), { now });
  assert.equal(balance.remaining, 1025);
  assert.equal(plan.value, 1000);
  for (const metric of [balance, plan]) {
    assert.equal(metric.percent, undefined);
    assert.equal(metric.used, undefined);
    assert.equal(metric.limit, undefined);
  }
  assert.equal(normalizeFirecrawlCurrent(current({ remainingCredits: 900 }), { now })[0].used, undefined);
});

test('the REST adapter rejects connector-flat, error and missing-value bodies', () => {
  assert.deepEqual(normalizeFirecrawlCurrent(current().data, { now }), []);
  assert.deepEqual(normalizeFirecrawlCurrent({ success: false, data: current().data }, { now }), []);
  assert.deepEqual(normalizeFirecrawlCurrent(current({ remainingCredits: null, planCredits: undefined }), { now }), []);
  assert.deepEqual(normalizeFirecrawlCurrent(current({ remainingCredits: -1, planCredits: NaN }), { now }), []);
});

test('only an explicit matching billing-period history total can be displayed as consumed', () => {
  const settings = { now, current: current() };
  const [metric] = normalizeFirecrawlHistory({ success: true, periods: [period({ totalCredits: 0 })] }, settings);
  assert.equal(metric.used, 0);
  assert.equal(metric.percent, undefined);
  for (const periods of [[], [period({ startDate: '2026-11-01T00:00:00Z' })],
    [period(), period()], [period({ totalCredits: -1 })], [period({ totalCredits: undefined, creditsUsed: 0 })]]) {
    assert.deepEqual(normalizeFirecrawlHistory({ success: true, periods }, settings), []);
  }
  assert.deepEqual(normalizeFirecrawlHistory({ success: true, periods: [period()] },
    { now, current: current({ billingPeriodStart: null }) }), []);
});

test('Cloudflare empty, error and incomplete datasets are not zero usage', () => {
  for (const [normalizer, dataset] of [[normalizeCloudflareWorkers, 'workersInvocationsAdaptive'],
    [normalizeCloudflareKV, 'kvOperationsAdaptiveGroups'], [normalizeCloudflareD1, 'd1AnalyticsAdaptiveGroups'],
    [normalizeCloudflareR2, 'r2StorageAdaptiveGroups']]) {
    assert.deepEqual(normalizer(graphql(dataset, []), { now }), []);
    assert.deepEqual(normalizer({ ...graphql(dataset, [{}]), errors: [{ message: 'denied' }] }, { now }), []);
    assert.deepEqual(normalizer(graphql(dataset, [{}]), { now }), []);
  }
  assert.deepEqual(normalizeCloudflareWorkers(graphql('workersInvocationsAdaptive', Array(10000).fill({ sum: { requests: 1 } })), { now }), []);
});

test('Workers aggregates only numeric counts and preserves a real zero', () => {
  const body = graphql('workersInvocationsAdaptive', [{ sum: { requests: 0 } }]);
  const [metric] = normalizeCloudflareWorkers(body, { now });
  assert.equal(metric.used, 0);
  assert.equal(metric.limit, undefined);
  assert.equal(metric.percent, undefined);
  assert.equal(metric.periodLabel, '2026-11-22 · UTC');
  assert.equal(normalizeCloudflareWorkers(graphql('workersInvocationsAdaptive',
    [{ sum: { requests: 2 } }, { sum: { requests: 3 } }]), { now })[0].used, 5);
  assert.deepEqual(normalizeCloudflareWorkers(graphql('workersInvocationsAdaptive',
    [{ sum: { requests: 2 } }, { sum: { requests: null } }]), { now }), []);
});

test('KV does not invent a write zero when only reads are present', () => {
  const metrics = normalizeCloudflareKV(graphql('kvOperationsAdaptiveGroups', [
    { dimensions: { actionType: 'read' }, sum: { requests: 0 } },
    { dimensions: { actionType: 'read' }, sum: { requests: 2 } },
    { dimensions: { actionType: 'delete' }, sum: { requests: 10 } },
  ]), { now });
  assert.equal(metrics.length, 1);
  assert.equal(metrics[0].key, 'today_reads');
  assert.equal(metrics[0].used, 2);
});

test('D1 publishes rows, without relabeling query counts as billable rows', () => {
  const metrics = normalizeCloudflareD1(graphql('d1AnalyticsAdaptiveGroups', [
    { sum: { rowsRead: 0, rowsWritten: 30, readQueries: 99, writeQueries: 7 } },
  ]), { now });
  assert.deepEqual(metrics.map(metric => metric.used), [0, 30]);
  assert.ok(metrics.every(metric => metric.unit === 'rows'));
});

test('R2 sums latest gauges per bucket, without summing their historical snapshots', () => {
  const row = (bucketName, datetime, payloadSize) => ({ dimensions: { bucketName, datetime }, max: { payloadSize } });
  const metrics = normalizeCloudflareR2(graphql('r2StorageAdaptiveGroups', [
    row('private-bucket-a', '2026-11-22T22:45:00Z', 11 * gib),
    row('private-bucket-a', '2026-11-22T22:30:00Z', 20 * gib),
    row('private-bucket-b', '2026-11-22T22:40:00Z', 2 * gib),
  ]), { now });
  assert.equal(metrics[0].used, 13 * gib);
  assert.equal(metrics[0].checkedAt, '2026-11-22T22:40:00.000Z');
  assert.equal(metrics[0].percent, undefined);
  assert.equal(metrics[0].limit, undefined);
  assert.equal(JSON.stringify(metrics).includes('private-bucket'), false);
});

test('R2 invalid latest gauges never silently fall back or produce a partial account total', () => {
  const rows = [
    { dimensions: { bucketName: 'a', datetime: checkedAt }, max: { payloadSize: null } },
    { dimensions: { bucketName: 'a', datetime: '2026-11-22T22:30:00Z' }, max: { payloadSize: 1 } },
    { dimensions: { bucketName: 'b', datetime: checkedAt }, max: { payloadSize: 10 } },
  ];
  assert.deepEqual(normalizeCloudflareR2(graphql('r2StorageAdaptiveGroups', rows), { now }), []);
  rows[0].max.payloadSize = 0;
  assert.equal(normalizeCloudflareR2(graphql('r2StorageAdaptiveGroups', rows), { now })[0].used, 10);
  rows[0].dimensions.datetime = '2026-11-22T23:00:01Z';
  assert.deepEqual(normalizeCloudflareR2(graphql('r2StorageAdaptiveGroups', rows), { now }), []);
});

test('unconfigured and legacy env names cannot cause outbound requests', async () => {
  let calls = 0;
  const result = await collectUsage({ INSTABOX_API_KEY: 'legacy-value', FIRECRAWL_API_KEY: 'legacy-value',
    RESOURCE_CLOUDFLARE_API_TOKEN: '   ' }, { now, fetchImpl: () => { calls++; throw new Error('must not fetch'); } });
  assert.equal(calls, 0);
  assert.deepEqual(result, { resources: [], connectedProviders: [], errors: [] });
});

test('a suspended unique machine returns state only and never requests metrics or wakes it', async () => {
  const calls = [];
  const result = await collectUsage({ RESOURCE_INSTABOX_API_KEY: 'fake-instabox' }, { now, fetchImpl: async (url, init) => {
    calls.push([url, init]);
    return json({ machines: [{ id: 'private-machine', name: 'Private Name', state: 'suspended' }], nextCursor: null });
  } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'https://api.instabox.sh/v1/machines');
  assert.equal(calls[0][1].method, 'GET');
  assert.equal(calls[0][1].redirect, 'error');
  assert.deepEqual(result.resources, [{ id: 'instabox-free', state: 'paused', metrics: [], checkedAt: now.toISOString() }]);
  assert.deepEqual(result.connectedProviders, ['instabox']);
  assert.equal(JSON.stringify(result).includes('private-machine'), false);
  assert.equal(JSON.stringify(result).includes('Private Name'), false);
});

test('multiple or paginated machines are not guessed', async () => {
  for (const list of [
    { machines: [{ id: 'a', state: 'running' }, { id: 'b', state: 'running' }], nextCursor: null },
    { machines: [{ id: 'a', state: 'running' }], nextCursor: 'next' },
  ]) {
    let calls = 0;
    const result = await collectUsage({ RESOURCE_INSTABOX_API_KEY: 'fake' }, { now,
      fetchImpl: async () => { calls++; return json(list); } });
    assert.equal(calls, 1);
    assert.deepEqual(result.resources, []);
    assert.deepEqual(result.errors, ['instabox']);
  }
});

test('an explicit machine uses direct response schema and only fixed read endpoints', async () => {
  const calls = [];
  const result = await collectUsage({ RESOURCE_INSTABOX_API_KEY: 'fake', RESOURCE_INSTABOX_MACHINE_ID: 'selected-1' }, {
    now, fetchImpl: async (url, init) => {
      calls.push([url, init]);
      if (url.endsWith('/selected-1')) return json({ id: 'selected-1', state: 'running' });
      if (url.includes('/metrics?')) return json(samples());
      if (url.endsWith('/disk')) return json(disk());
      throw new Error('unexpected URL');
    },
  });
  assert.equal(calls.length, 3);
  assert.ok(calls.every(([url, init]) => new URL(url).hostname === 'api.instabox.sh' && init.method === 'GET'));
  assert.deepEqual(result.resources[0].metrics.map(metric => metric.key), ['cpu', 'memory', 'storage']);
  assert.deepEqual(result.errors, []);
});

test('unsafe machine selection is rejected before fetch', async () => {
  let calls = 0;
  const result = await collectUsage({ RESOURCE_INSTABOX_API_KEY: 'fake', RESOURCE_INSTABOX_MACHINE_ID: '../resume' },
    { now, fetchImpl: () => { calls++; } });
  assert.equal(calls, 0);
  assert.deepEqual(result.errors, ['instabox']);
});

test('one failed machine subrequest preserves other observed measurements', async () => {
  const result = await collectUsage({ RESOURCE_INSTABOX_API_KEY: 'fake' }, { now, fetchImpl: async url => {
    if (url.endsWith('/machines')) return json({ machines: [{ id: 'one', state: 'running' }], nextCursor: null });
    if (url.endsWith('/disk')) return new Response('private failure body', { status: 409 });
    return json(samples());
  } });
  assert.deepEqual(result.resources[0].metrics.map(metric => metric.key), ['cpu', 'memory']);
  assert.deepEqual(result.errors, ['instabox']);
});

test('Firecrawl empty history does not create a consumed-zero metric', async () => {
  const calls = [];
  const result = await collectUsage({ RESOURCE_FIRECRAWL_API_KEY: 'fake-firecrawl' }, { now, fetchImpl: async (url, init) => {
    calls.push([url, init]);
    return json(url.endsWith('/historical') ? { success: true, periods: [] } : current());
  } });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(([url, init]) => new URL(url).hostname === 'api.firecrawl.dev' && init.method === 'GET'));
  assert.deepEqual(result.resources[0].metrics.map(metric => metric.key), ['credits', 'plan_credits']);
  assert.deepEqual(result.errors, []);
});

test('missing Firecrawl billing period skips history but keeps actual balance', async () => {
  let calls = 0;
  const result = await collectUsage({ RESOURCE_FIRECRAWL_API_KEY: 'fake' }, { now, fetchImpl: async () => {
    calls++; return json(current({ billingPeriodStart: null, billingPeriodEnd: null }));
  } });
  assert.equal(calls, 1);
  assert.equal(result.resources[0].metrics[0].remaining, 1025);
});

test('provider failures do not remove another provider or leak tokens/raw errors', async () => {
  const fakeSecret = 'must-not-appear-in-result';
  const result = await collectUsage({ RESOURCE_INSTABOX_API_KEY: 'fake', RESOURCE_FIRECRAWL_API_KEY: fakeSecret }, {
    now, fetchImpl: async url => {
      if (new URL(url).hostname === 'api.firecrawl.dev') throw new Error(`private user@example.com ${fakeSecret}`);
      return json({ machines: [{ id: 'private-id', state: 'suspended' }], nextCursor: null });
    },
  });
  assert.deepEqual(result.connectedProviders, ['instabox']);
  assert.deepEqual(result.errors, ['firecrawl']);
  const serialized = JSON.stringify(result);
  for (const privateText of [fakeSecret, 'user@example.com', 'private-id', 'private']) {
    assert.equal(serialized.includes(privateText), false);
  }
});

test('Cloudflare independent read queries retain good datasets after a permission error', async () => {
  const calls = [];
  const result = await collectUsage({ RESOURCE_CLOUDFLARE_API_TOKEN: 'fake-cf', RESOURCE_CLOUDFLARE_ACCOUNT_ID: 'private-account' }, {
    now, fetchImpl: async (url, init) => {
      calls.push([url, init]);
      const { query, variables } = JSON.parse(init.body);
      assert.equal(variables.accountTag, 'private-account');
      if (query.includes('ResourceWorkers')) {
        assert.equal(variables.start, '2026-11-22T00:00:00.000Z');
        return json(graphql('workersInvocationsAdaptive', [{ sum: { requests: 0 } }]));
      }
      if (query.includes('ResourceKV')) return json({ errors: [{ message: 'private permission details' }] });
      if (query.includes('ResourceD1')) return json(graphql('d1AnalyticsAdaptiveGroups', [{ sum: { rowsRead: 2, rowsWritten: 0 } }]));
      return json(graphql('r2StorageAdaptiveGroups', []));
    },
  });
  assert.equal(calls.length, 4);
  assert.ok(calls.every(([url, init]) => url === 'https://api.cloudflare.com/client/v4/graphql'
    && init.method === 'POST' && JSON.parse(init.body).query.trim().startsWith('query ')));
  assert.deepEqual(result.resources.map(resource => resource.id), ['cloudflare-workers', 'cloudflare-d1']);
  assert.deepEqual(result.connectedProviders, ['cloudflare']);
  assert.deepEqual(result.errors, ['cloudflare']);
  assert.equal(JSON.stringify(result).includes('private'), false);
});

test('Cloudflare missing account configuration produces no outgoing request', async () => {
  let calls = 0;
  const result = await collectUsage({ RESOURCE_CLOUDFLARE_API_TOKEN: 'fake' }, { now, fetchImpl: () => { calls++; } });
  assert.equal(calls, 0);
  assert.deepEqual(result.errors, ['cloudflare']);
});

test('a malformed success envelope cannot mark Cloudflare or machine metrics as healthy', async () => {
  const result = await collectUsage({ RESOURCE_CLOUDFLARE_API_TOKEN: 'fake',
    RESOURCE_CLOUDFLARE_ACCOUNT_ID: 'fake-account', RESOURCE_INSTABOX_API_KEY: 'fake' }, {
    now, fetchImpl: async url => {
      if (url.endsWith('/machines')) return json({ machines: [{ id: 'one', state: 'running' }], nextCursor: null });
      if (new URL(url).hostname === 'api.cloudflare.com') return json({ data: { viewer: { accounts: [{}] } } });
      return json({});
    },
  });
  assert.deepEqual(result.errors, ['instabox', 'cloudflare']);
  assert.deepEqual(result.connectedProviders, ['instabox']);
  assert.equal(result.resources[0].state, 'running');
  assert.deepEqual(result.resources[0].metrics, []);
});

test('provider deadline aborts even a fetch implementation that never settles', async () => {
  let signal;
  const result = await collectUsage({ RESOURCE_INSTABOX_API_KEY: 'fake-timeout-only' }, {
    now, fetchImpl: (_url, options) => { signal = options.signal; return new Promise(() => {}); },
  });
  assert.equal(signal.aborted, true);
  assert.deepEqual(result, { resources: [], connectedProviders: [], errors: ['instabox'] });
});
