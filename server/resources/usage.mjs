/**
 * Server-only, read-only provider adapters. No credentials are read from files,
 * process.env or the browser: callers must pass explicitly scoped RESOURCE_* env.
 *
 * Schemas verified against these official sources:
 * https://api.instabox.sh/v1/openapi.json
 * https://docs.firecrawl.dev/api-reference/endpoint/credit-usage
 * https://docs.firecrawl.dev/api-reference/endpoint/credit-usage-historical
 * https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/
 * https://developers.cloudflare.com/kv/observability/metrics-analytics/
 * https://developers.cloudflare.com/d1/observability/metrics-analytics/
 * https://developers.cloudflare.com/r2/platform/metrics-analytics/
 */

const PROVIDER_TIMEOUT_MS = 8000;
const INSTANT_MAX_AGE_MS = 120_000;
const DISK_MAX_AGE_MS = 600_000;
const R2_MAX_AGE_MS = 86_400_000;
const QUERY_LIMIT = 10_000;
const INSTA = 'https://api.instabox.sh/v1';
const FIRECRAWL = 'https://api.firecrawl.dev/v2/team';
const GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql';
const HOSTS = new Set(['api.instabox.sh', 'api.firecrawl.dev', 'api.cloudflare.com']);
const MACHINE_STATES = new Set([
  'creating', 'starting', 'running', 'stopping', 'stopped', 'suspending',
  'suspended', 'resuming', 'deleting', 'deleted', 'error',
]);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const count = value => number(value) && Number.isSafeInteger(value);
const positiveCount = value => count(value) && value > 0;
const secret = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const numberText = value => new Intl.NumberFormat('en-US', value > 0 && value < 0.01
  ? { notation: 'scientific', maximumSignificantDigits: 3 } : { maximumFractionDigits: 2 }).format(value);
const dateMs = value => typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
  && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const iso = now => new Date(now).toISOString();
const freshTime = (value, now, maxAge) => {
  const ms = dateMs(value);
  const age = new Date(now).getTime() - ms;
  return ms !== null && age >= 0 && age <= maxAge ? new Date(ms).toISOString() : null;
};
const machineId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(value);

function bytesText(value, scale = value) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  const index = scale > 0 ? Math.min(units.length - 1, Math.floor(Math.log(scale) / Math.log(1024))) : 0;
  return { amount: numberText(value / 1024 ** index), unit: units[index] };
}

function ratioMetric(key, label, kind, used, limit, unit, checkedAt) {
  const percent = used / limit * 100;
  if (!number(used) || !number(limit) || limit <= 0 || !number(percent)) return null;
  const tinyBytes = unit === 'bytes' && used > 0 && used < limit / 1000;
  const displayValue = unit === 'bytes'
    ? tinyBytes
      ? `${bytesText(used).amount} ${bytesText(used).unit} / ${bytesText(limit).amount} ${bytesText(limit).unit}`
      : `${bytesText(used, limit).amount} / ${bytesText(limit).amount} ${bytesText(limit).unit}`
    : `${numberText(used)} / ${numberText(limit)} ${unit}`;
  return { key, label, kind, mode: 'usage', displayValue, unit, used, limit, percent,
    basis: 'observed', checkedAt };
}

function absoluteMetric(key, label, kind, used, unit, checkedAt, periodLabel) {
  if (!number(used)) return null;
  const formatted = unit === 'bytes' ? bytesText(used) : null;
  return { key, label, kind, mode: 'usage',
    displayValue: formatted ? `${formatted.amount} ${formatted.unit}` : `${numberText(used)} ${unit}`,
    unit, used, basis: 'observed', checkedAt, ...(periodLabel ? { periodLabel } : {}) };
}

/** Metrics are host samples; this function never infers usage from machine spec. */
export function normalizeInstaBoxMetrics(body, { now = new Date(), state = 'running' } = {}) {
  if (state !== 'running' || !Array.isArray(body?.metrics)) return [];
  const samples = body.metrics.filter(sample => object(sample) && dateMs(sample.timestamp) !== null);
  samples.sort((a, b) => dateMs(b.timestamp) - dateMs(a.timestamp));
  const sample = samples[0];
  const checkedAt = sample && freshTime(sample.timestamp, now, INSTANT_MAX_AGE_MS);
  if (!checkedAt) return [];
  const metrics = [];
  if (number(sample.cpuUsedPct) && sample.cpuUsedPct <= 100 && positiveCount(sample.cpuCount)) {
    const metric = ratioMetric('cpu', 'CPU', 'cpu', sample.cpuUsedPct / 100 * sample.cpuCount,
      sample.cpuCount, 'vCPU', checkedAt);
    if (metric) metrics.push(metric);
  }
  if (count(sample.memUsed) && positiveCount(sample.memTotal)) {
    const metric = ratioMetric('memory', '内存', 'memory', sample.memUsed, sample.memTotal, 'bytes', checkedAt);
    if (metric) metrics.push(metric);
  }
  return metrics;
}

/** /disk runs a read without waking a machine. Its timestamp is independent of CPU. */
export function normalizeInstaBoxDisk(body, { now = new Date(), state = 'running' } = {}) {
  if (state !== 'running' || !Array.isArray(body?.filesystems)) return [];
  const checkedAt = freshTime(body.measuredAt, now, DISK_MAX_AGE_MS);
  const disks = body.filesystems.filter(disk => disk?.mount === '/data');
  if (!checkedAt || disks.length !== 1) return [];
  const disk = disks[0];
  if (!count(disk.usedBytes) || !positiveCount(disk.sizeBytes)) return [];
  // df usedPct uses used / (used + available), which differs when blocks are
  // reserved. Here the displayed denominator is the actual physical size.
  const metric = ratioMetric('storage', '存储', 'storage', disk.usedBytes, disk.sizeBytes, 'bytes', checkedAt);
  return metric ? [metric] : [];
}

/** REST uses {success,data}; the Firecrawl connector's flat response is different. */
export function normalizeFirecrawlCurrent(body, { now = new Date() } = {}) {
  if (body?.success !== true || !object(body.data)) return [];
  const checkedAt = iso(now);
  const metrics = [];
  if (number(body.data.remainingCredits)) metrics.push({
    key: 'credits', label: '剩余额度', kind: 'quota', mode: 'balance',
    displayValue: `${numberText(body.data.remainingCredits)} credits`, unit: 'credits',
    remaining: body.data.remainingCredits, basis: 'observed', checkedAt,
  });
  if (number(body.data.planCredits)) metrics.push({
    key: 'plan_credits', label: '账期额度', kind: 'quota', mode: 'capacity',
    displayValue: `${numberText(body.data.planCredits)} credits`, unit: 'credits',
    value: body.data.planCredits, basis: 'observed', checkedAt,
  });
  return metrics;
}

/** Only an explicit, unambiguous billing-period total is a consumption reading. */
export function normalizeFirecrawlHistory(body, { current, now = new Date() } = {}) {
  if (body?.success !== true || !Array.isArray(body.periods) || current?.success !== true) return [];
  const start = dateMs(current.data?.billingPeriodStart);
  const end = dateMs(current.data?.billingPeriodEnd);
  const nowMs = new Date(now).getTime();
  if (start === null || end === null || start >= end || nowMs < start || nowMs > end) return [];
  const periods = body.periods.filter(period => object(period)
    && dateMs(period.startDate) === start && dateMs(period.endDate) === end);
  if (periods.length !== 1 || !number(periods[0].totalCredits)) return [];
  return [absoluteMetric('consumed_credits', '本账期已用', 'quota', periods[0].totalCredits,
    'credits', iso(now))];
}

function cloudflareRows(body, dataset) {
  if (!object(body) || (body.errors !== null && body.errors !== undefined
    && (!Array.isArray(body.errors) || body.errors.length > 0))) return null;
  const accounts = body.data?.viewer?.accounts;
  if (!Array.isArray(accounts) || accounts.length !== 1) return null;
  const rows = accounts[0]?.[dataset];
  // At the query limit there may be omitted groups: do not publish a partial sum.
  if (!Array.isArray(rows) || rows.length === 0 || rows.length >= QUERY_LIMIT) return null;
  return rows.every(object) ? rows : null;
}

function sumField(rows, field, group = 'sum') {
  if (!rows?.length || !rows.every(row => count(row[group]?.[field]))) return null;
  const total = rows.reduce((sum, row) => sum + row[group][field], 0);
  return count(total) ? total : null;
}

export function normalizeCloudflareWorkers(body, { now = new Date() } = {}) {
  const rows = cloudflareRows(body, 'workersInvocationsAdaptive');
  const value = sumField(rows, 'requests');
  return value === null ? [] : [absoluteMetric('today_requests', '今日请求', 'requests',
    value, 'requests', iso(now), 'UTC 00:00 起')];
}

export function normalizeCloudflareKV(body, { now = new Date() } = {}) {
  const rows = cloudflareRows(body, 'kvOperationsAdaptiveGroups');
  if (!rows || rows.some(row => typeof row.dimensions?.actionType !== 'string')) return [];
  return [['read', 'today_reads', '今日读取'], ['write', 'today_writes', '今日写入']].flatMap(([action, key, label]) => {
    const value = sumField(rows.filter(row => row.dimensions.actionType === action), 'requests');
    return value === null ? [] : [absoluteMetric(key, label, 'requests', value, 'operations', iso(now), 'UTC 00:00 起')];
  });
}

export function normalizeCloudflareD1(body, { now = new Date() } = {}) {
  const rows = cloudflareRows(body, 'd1AnalyticsAdaptiveGroups');
  return [['rowsRead', 'today_rows_read', '今日读取行数'], ['rowsWritten', 'today_rows_written', '今日写入行数']]
    .flatMap(([field, key, label]) => {
      const value = sumField(rows, field);
      return value === null ? [] : [absoluteMetric(key, label, 'requests', value, 'rows', iso(now), 'UTC 00:00 起')];
    });
}

export function normalizeCloudflareR2(body, { now = new Date() } = {}) {
  const rows = cloudflareRows(body, 'r2StorageAdaptiveGroups');
  if (!rows) return [];
  const latestByBucket = new Map();
  for (const row of rows) {
    const bucket = row.dimensions?.bucketName;
    const timestamp = dateMs(row.dimensions?.datetime);
    if (typeof bucket !== 'string' || !bucket || timestamp === null) return [];
    const previous = latestByBucket.get(bucket);
    if (!previous || timestamp > dateMs(previous.dimensions.datetime)) latestByBucket.set(bucket, row);
    else if (timestamp === dateMs(previous.dimensions.datetime)
      && row.max?.payloadSize !== previous.max?.payloadSize) return [];
  }
  const latest = [...latestByBucket.values()];
  if (latest.some(row => !freshTime(row.dimensions.datetime, now, R2_MAX_AGE_MS))) return [];
  const value = sumField(latest, 'payloadSize', 'max');
  if (value === null) return [];
  // A storage gauge is not a daily sum. Keep each bucket's latest point only;
  // the oldest included point is the honest freshness bound for the total.
  const checkedAt = new Date(Math.min(...latest.map(row => dateMs(row.dimensions.datetime)))).toISOString();
  return [absoluteMetric('storage_used', '对象存储', 'storage', value, 'bytes', checkedAt)];
}

const CF_QUERIES = [
  {
    id: 'cloudflare-workers', dataset: 'workersInvocationsAdaptive', normalize: normalizeCloudflareWorkers,
    query: `query ResourceWorkers($accountTag: string!, $start: string!, $end: string!) {
      viewer { accounts(filter: {accountTag: $accountTag}) {
        workersInvocationsAdaptive(limit: 10000, filter: {datetime_geq: $start, datetime_leq: $end}) { sum { requests } }
      } }
    }`,
    variables: now => ({ start: `${iso(now).slice(0, 10)}T00:00:00.000Z`, end: iso(now) }),
  },
  {
    id: 'cloudflare-kv', dataset: 'kvOperationsAdaptiveGroups', normalize: normalizeCloudflareKV,
    query: `query ResourceKV($accountTag: string!, $start: Date, $end: Date) {
      viewer { accounts(filter: {accountTag: $accountTag}) {
        kvOperationsAdaptiveGroups(limit: 10000, filter: {date_geq: $start, date_leq: $end}) {
          sum { requests } dimensions { actionType }
        }
      } }
    }`,
    variables: now => ({ start: iso(now).slice(0, 10), end: iso(now).slice(0, 10) }),
  },
  {
    id: 'cloudflare-d1', dataset: 'd1AnalyticsAdaptiveGroups', normalize: normalizeCloudflareD1,
    query: `query ResourceD1($accountTag: string!, $start: Date, $end: Date) {
      viewer { accounts(filter: {accountTag: $accountTag}) {
        d1AnalyticsAdaptiveGroups(limit: 10000, filter: {date_geq: $start, date_leq: $end}) {
          sum { rowsRead rowsWritten }
        }
      } }
    }`,
    variables: now => ({ start: iso(now).slice(0, 10), end: iso(now).slice(0, 10) }),
  },
  {
    id: 'cloudflare-r2-webdav', dataset: 'r2StorageAdaptiveGroups', normalize: normalizeCloudflareR2,
    query: `query ResourceR2($accountTag: string!, $start: Time, $end: Time) {
      viewer { accounts(filter: {accountTag: $accountTag}) {
        r2StorageAdaptiveGroups(limit: 10000, filter: {datetime_geq: $start, datetime_leq: $end}, orderBy: [datetime_DESC]) {
          max { payloadSize } dimensions { bucketName datetime }
        }
      } }
    }`,
    variables: now => ({ start: new Date(new Date(now).getTime() - R2_MAX_AGE_MS).toISOString(), end: iso(now) }),
  },
];

/** One cumulative eight-second deadline per provider, including JSON reads. */
function jsonClient(fetchImpl) {
  const deadline = Date.now() + PROVIDER_TIMEOUT_MS;
  return async (url, init) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !HOSTS.has(parsed.hostname) || parsed.username || parsed.password
      || parsed.port || !['GET', 'POST'].includes(init.method)
      || (init.method === 'POST' && url !== GRAPHQL)) throw new Error('provider_request');
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('provider_timeout');
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('provider_timeout')); }, remaining);
    });
    try {
      return await Promise.race([
        (async () => {
          const response = await fetchImpl(url, { ...init, redirect: 'error', signal: controller.signal });
          if (!response?.ok) throw new Error('provider_response');
          return await response.json();
        })(),
        timeout,
      ]);
    } finally { clearTimeout(timer); }
  };
}

async function collectInstaBox(env, request, now) {
  const headers = { Accept: 'application/json', 'X-API-Key': env.RESOURCE_INSTABOX_API_KEY.trim() };
  const get = url => request(url, { method: 'GET', headers });
  const selectedId = secret(env.RESOURCE_INSTABOX_MACHINE_ID);
  let machine;
  if (selectedId) {
    if (!machineId(selectedId)) throw new Error('provider_configuration');
    machine = await get(`${INSTA}/machines/${encodeURIComponent(selectedId)}`);
    if (machine?.id !== selectedId) throw new Error('provider_response');
  } else {
    const list = await get(`${INSTA}/machines`);
    if (!Array.isArray(list?.machines) || !Object.hasOwn(list, 'nextCursor')) throw new Error('provider_response');
    if (list.machines.length === 0 && list.nextCursor === null) return { resources: [] };
    if (list.machines.length !== 1 || list.nextCursor !== null) return { resources: [], hadError: true };
    machine = list.machines[0];
  }
  if (!machineId(machine?.id) || !MACHINE_STATES.has(machine.state)) throw new Error('provider_response');
  const states = { running: 'running', suspended: 'paused', stopped: 'stopped' };
  const state = states[machine.state];
  const resource = { id: 'instabox-free', metrics: [], ...(state ? { state } : {}), checkedAt: iso(now) };
  if (state !== 'running') return { resources: [resource] };
  const base = `${INSTA}/machines/${encodeURIComponent(machine.id)}`;
  const since = new Date(new Date(now).getTime() - 300_000).toISOString();
  const readings = await Promise.allSettled([
    get(`${base}/metrics?since=${encodeURIComponent(since)}`), get(`${base}/disk`),
  ]);
  const validMetrics = readings[0].status === 'fulfilled' && Array.isArray(readings[0].value?.metrics);
  const validDisk = readings[1].status === 'fulfilled' && Array.isArray(readings[1].value?.filesystems);
  if (validMetrics) resource.metrics.push(...normalizeInstaBoxMetrics(readings[0].value, { now, state }));
  if (validDisk) resource.metrics.push(...normalizeInstaBoxDisk(readings[1].value, { now, state }));
  return { resources: [resource], hadError: !validMetrics || !validDisk };
}

async function collectFirecrawl(env, request, now) {
  const headers = { Accept: 'application/json', Authorization: `Bearer ${env.RESOURCE_FIRECRAWL_API_KEY.trim()}` };
  const current = await request(`${FIRECRAWL}/credit-usage`, { method: 'GET', headers });
  const metrics = normalizeFirecrawlCurrent(current, { now });
  if (!metrics.length) throw new Error('provider_response');
  let hadError = false;
  if (dateMs(current.data?.billingPeriodStart) !== null && dateMs(current.data?.billingPeriodEnd) !== null) {
    try {
      const historical = await request(`${FIRECRAWL}/credit-usage/historical`, { method: 'GET', headers });
      if (historical?.success !== true || !Array.isArray(historical.periods)) hadError = true;
      else metrics.push(...normalizeFirecrawlHistory(historical, { now, current }));
    } catch { hadError = true; }
  }
  return { resources: [{ id: 'firecrawl-free', metrics, checkedAt: iso(now) }], hadError };
}

async function collectCloudflare(env, request, now) {
  const accountTag = secret(env.RESOURCE_CLOUDFLARE_ACCOUNT_ID);
  if (!accountTag) throw new Error('provider_configuration');
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json',
    Authorization: `Bearer ${env.RESOURCE_CLOUDFLARE_API_TOKEN.trim()}` };
  const outcomes = await Promise.allSettled(CF_QUERIES.map(async ({ id, dataset, query, variables, normalize }) => {
    const body = await request(GRAPHQL, { method: 'POST', headers,
      body: JSON.stringify({ query, variables: { accountTag, ...variables(now) } }) });
    if (!object(body) || (body.errors != null && (!Array.isArray(body.errors) || body.errors.length))) {
      throw new Error('provider_response');
    }
    if (!Array.isArray(body.data?.viewer?.accounts) || body.data.viewer.accounts.length !== 1
      || !Array.isArray(body.data.viewer.accounts[0]?.[dataset])) {
      throw new Error('provider_response');
    }
    const metrics = normalize(body, { now });
    return metrics.length ? { id, metrics, checkedAt: iso(now) } : null;
  }));
  if (outcomes.every(result => result.status === 'rejected')) throw new Error('provider_response');
  return { resources: outcomes.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : []),
    hadError: outcomes.some(result => result.status === 'rejected') };
}

/**
 * @returns {Promise<{resources: Array<object>, connectedProviders: string[], errors: string[]}>}
 * connectedProviders means a valid provider response, including an empty list.
 * A provider may appear in both lists when one subrequest failed. No raw errors,
 * credentials, machine identifiers or account identifiers enter the result.
 */
export async function collectUsage(env = {}, { fetchImpl = fetch, now = new Date() } = {}) {
  if (!Number.isFinite(new Date(now).getTime())) throw new TypeError('Invalid observation time');
  const providers = [
    ['instabox', 'RESOURCE_INSTABOX_API_KEY', collectInstaBox],
    ['firecrawl', 'RESOURCE_FIRECRAWL_API_KEY', collectFirecrawl],
    ['cloudflare', 'RESOURCE_CLOUDFLARE_API_TOKEN', collectCloudflare],
  ].filter(([, key]) => secret(env[key]));
  const result = { resources: [], connectedProviders: [], errors: [] };
  const outcomes = await Promise.all(providers.map(async ([id, , collect]) => {
    try { return { id, value: await collect(env, jsonClient(fetchImpl), now) }; }
    catch { return { id, failed: true }; }
  }));
  for (const outcome of outcomes) {
    if (outcome.failed) { result.errors.push(outcome.id); continue; }
    result.connectedProviders.push(outcome.id);
    result.resources.push(...outcome.value.resources);
    if (outcome.value.hadError) result.errors.push(outcome.id);
  }
  return result;
}
