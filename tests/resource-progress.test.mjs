import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isValidMetric, isVisibleResource, getMetricProgress,
  metricDisplayValue, isRedundantPlanMetric,
} from '../src/lib/resource-metrics.mjs';

const metric = overrides => ({
  key: 'consumed', label: '账户消费', kind: 'quota', mode: 'usage',
  displayValue: '$0', unit: 'USD', used: 0, limit: 5,
  basis: 'observed', checkedAt: '2026-11-22T22:02:08Z', ...overrides,
});
const exhausted = {
  key: 'actions_quota', label: 'Actions 额度', kind: 'quota', mode: 'usage',
  displayValue: '已用完', percent: 100, quotaState: 'exhausted',
  basis: 'user-confirmed', checkedAt: '2026-11-22T23:15:20Z',
};

test('confirmed Actions exhaustion renders a full warning bar without inventing minute totals', () => {
  assert.equal(isValidMetric(exhausted), true);
  assert.equal('used' in exhausted, false);
  assert.equal('limit' in exhausted, false);
  const progress = getMetricProgress(exhausted);
  assert.equal(progress.fill, 100);
  assert.equal(progress.tone, 'exhausted');
  assert.match(progress.valueText, /已用完/);
  assert.equal(metricDisplayValue(exhausted), '已用完');
  assert.equal(isVisibleResource({ claimStatus: 'claimed', availability: 'restricted', metrics: [exhausted] }), true);
});

test('an unmeasured percentage alone cannot manufacture an exhausted quota', () => {
  const { quotaState, ...noConfirmationState } = exhausted;
  assert.equal(isValidMetric(noConfirmationState), false);
  assert.equal(getMetricProgress(noConfirmationState), null);
  assert.equal(isValidMetric({ ...exhausted, basis: 'unknown' }), false);
  assert.equal(isValidMetric({ ...exhausted, percent: 99 }), false);
});

test('actual zero spending remains visible and produces zero utilization', () => {
  const actual = metric({ remaining: 5, referenceLabel: '消费上限' });
  const progress = getMetricProgress(actual);
  assert.equal(progress.percent, 0);
  assert.equal(progress.fill, 0);
  assert.equal(progress.tone, 'normal');
  assert.equal(metricDisplayValue(actual), '$0 / $5');
  assert.match(progress.right, /消费上限/);
  assert.equal(isVisibleResource({ claimStatus: 'registered', availability: 'awaiting-setup', metrics: [actual] }), true);
});

test('observed absolute counts without a denominator do not become invented percentage bars', () => {
  const actual = metric({ key: 'browser_minutes', kind: 'runtime', displayValue: '0 分钟', unit: 'minutes', limit: undefined });
  assert.equal(isValidMetric(actual), true);
  assert.equal(getMetricProgress(actual), null);
  assert.equal(isVisibleResource({ claimStatus: 'registered', metrics: [actual] }), true);
});

test('capacity-only registrations and unknown fields remain hidden', () => {
  const capacity = metric({ mode: 'capacity', basis: 'plan-limit', value: 5, used: undefined });
  assert.equal(isVisibleResource({ claimStatus: 'registered', metrics: [capacity] }), false);
  assert.equal(getMetricProgress(capacity), null);
  assert.equal(isValidMetric({ ...capacity, mode: 'unknown', basis: 'unknown' }), false);
  assert.equal(isVisibleResource({ claimStatus: 'claimed', availability: 'historical', metrics: [exhausted] }), false);
});

test('extra Firecrawl balance is shown as balance, never inferred consumption', () => {
  const balance = metric({ key: 'credits', mode: 'balance', displayValue: '1,025 credits',
    used: undefined, remaining: 1025, limit: 1000, unit: 'credits', referenceLabel: '账期额度' });
  const progress = getMetricProgress(balance);
  assert.equal(progress.kind, 'balance');
  assert.ok(Math.abs(progress.percent - 102.5) < 1e-10);
  assert.equal(progress.fill, 100);
  assert.equal(progress.tone, 'available');
  assert.match(progress.valueText, /1,025 credits/);
  assert.doesNotMatch(progress.valueText, /已用|负|\-25/);
  assert.equal(metricDisplayValue(balance), '1,025 credits');
});

test('HF personal GPU balance uses its own quota label rather than billing-period credits', () => {
  const balance = metric({ key: 'gpu_minutes', label: 'GPU 时长', kind: 'runtime', mode: 'balance',
    displayValue: '5 分钟', used: undefined, remaining: 5, limit: 5, unit: 'minutes', referenceLabel: '个人配额' });
  const progress = getMetricProgress(balance);
  assert.equal(progress.fill, 100);
  assert.match(progress.right, /个人配额 5 分钟/);
  assert.doesNotMatch(progress.valueText, /运行中|已用|账期/);
});

test('over-limit values remain numerically visible while only the painted bar is clamped', () => {
  const actual = metric({ used: 7.5, limit: 5, displayValue: '$7.50' });
  const progress = getMetricProgress(actual);
  assert.equal(progress.percent, 150);
  assert.equal(progress.fill, 100);
  assert.equal(progress.tone, 'exhausted');
  assert.match(progress.valueText, /150%/);
  assert.equal(metricDisplayValue(actual), '$7.5 / $5');
});

test('tiny positive usage is not displayed as a measured zero', () => {
  const progress = getMetricProgress(metric({ used: 1e-11, limit: 1 }));
  assert.ok(progress.percent > 0);
  assert.match(progress.left, /<0\.1%/);
});

test('machine byte ratios retain their readable server units and format remaining memory', () => {
  const actual = metric({ key: 'memory', label: '内存', kind: 'memory', unit: 'bytes',
    used: 2 * 1024 ** 3, limit: 8 * 1024 ** 3, displayValue: '2 / 8 GiB' });
  assert.equal(metricDisplayValue(actual), '2 / 8 GiB');
  assert.equal(getMetricProgress(actual).percent, 25);
  assert.equal(getMetricProgress(actual).right, '剩余 6 GiB');
});

test('tiny byte use stays readable beside a much larger disk', () => {
  const actual = metric({ key: 'storage', label: '存储', kind: 'storage', unit: 'bytes',
    used: 1024, limit: 20 * 1024 ** 3, displayValue: '1 KiB / 20 GiB' });
  assert.equal(metricDisplayValue(actual), '1 KiB / 20 GiB');
  assert.ok(getMetricProgress(actual).percent > 0);
  assert.match(getMetricProgress(actual).left, /<0\.1%/);
});

test('negative, non-finite and string numbers cannot become public progress', () => {
  for (const value of [-1, NaN, Infinity, '0', null]) {
    const actual = metric({ used: value });
    assert.equal(isValidMetric(actual), false);
    assert.equal(getMetricProgress(actual), null);
  }
  assert.equal(getMetricProgress(metric({ limit: 0 })), null);
});

test('a duplicate plan tile is hidden only when the displayed balance already names that exact reference', () => {
  const balance = metric({ key: 'credits', mode: 'balance', used: undefined, remaining: 1025, limit: 1000, unit: 'credits' });
  const plan = metric({ key: 'plan_credits', mode: 'capacity', value: 1000, unit: 'credits' });
  assert.equal(isRedundantPlanMetric(plan, [balance, plan]), true);
  assert.equal(isRedundantPlanMetric({ ...plan, value: 2000 }, [balance]), false);
  assert.equal(isRedundantPlanMetric({ ...plan, unit: 'USD' }, [balance]), false);
});

test('deployed catalog plus snapshot exposes the four confirmed quota/account cards', () => {
  const catalog = JSON.parse(readFileSync(new URL('../src/data/cloud-resources.json', import.meta.url)));
  const snapshot = JSON.parse(readFileSync(new URL('../src/data/resource-usage-snapshot.json', import.meta.url)));
  const merged = catalog.resources.map(resource => {
    const byKey = new Map((resource.metrics || []).map(item => [item.key, item]));
    for (const item of snapshot.resources.find(item => item.id === resource.id)?.metrics || []) byKey.set(item.key, item);
    return { ...resource, metrics: [...byKey.values()] };
  });
  for (const id of ['github-actions-compute', 'apify-free', 'hf-zerogpu', 'browserbase-free']) {
    const resource = merged.find(item => item.id === id);
    assert.ok(resource, id);
    assert.equal(isVisibleResource(resource), true, id);
  }
  const github = merged.find(item => item.id === 'github-actions-compute');
  const quota = github.metrics.find(item => item.key === 'actions_quota');
  assert.equal(quota.basis, 'user-confirmed');
  assert.equal('used' in quota, false);
  assert.equal('limit' in quota, false);
});
