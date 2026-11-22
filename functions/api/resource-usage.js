import dashboard from '../../src/data/cloud-resources.json';
import snapshot from '../../src/data/resource-usage-snapshot.json';
import { collectUsage } from '../../server/resources/usage.mjs';

const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const TTL = 60;
const visible = new Set(dashboard.resources.filter(resource => resource.claimStatus === 'claimed' && !['historical', 'restricted'].includes(resource.availability)).map(resource => resource.id));
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const fields = ['key', 'label', 'kind', 'mode', 'displayValue', 'unit', 'value', 'used', 'limit', 'remaining', 'percent', 'basis', 'checkedAt', 'periodLabel'];

export function publicResource(resource) {
  if (!resource || !visible.has(resource.id)) return null;
  const metrics = (resource.metrics || []).filter(metric => metric.basis === 'observed'
    && ['usage', 'balance', 'capacity'].includes(metric.mode)
    && typeof metric.key === 'string' && /^[a-z0-9_]{1,48}$/.test(metric.key)
    && typeof metric.displayValue === 'string' && metric.displayValue.length > 0
    && (metric.mode === 'usage' ? finite(metric.used) : metric.mode === 'balance' ? finite(metric.remaining) : finite(metric.value))
    && typeof metric.checkedAt === 'string' && Number.isFinite(Date.parse(metric.checkedAt))
    && ['value', 'used', 'limit', 'remaining', 'percent'].every(key => metric[key] === undefined || finite(metric[key])))
    .map(metric => Object.fromEntries(fields.filter(key => metric[key] !== undefined).map(key => [key, metric[key]])));
  const checkedAt = typeof resource.checkedAt === 'string' && Number.isFinite(Date.parse(resource.checkedAt)) ? resource.checkedAt : undefined;
  const state = checkedAt && ['running', 'paused', 'stopped'].includes(resource.state) ? resource.state : undefined;
  if (!metrics.length && !state) return null;
  return { id: resource.id, metrics, ...(state ? { state } : {}), ...(checkedAt ? { checkedAt } : {}) };
}

function mergeResources(...groups) {
  const output = new Map();
  for (const resources of groups) for (const resource of resources || []) {
    const safe = publicResource(resource);
    if (!safe) continue;
    const previous = output.get(safe.id);
    const metrics = new Map((previous?.metrics || []).map(metric => [metric.key, metric]));
    for (const metric of safe.metrics) {
      const old = metrics.get(metric.key);
      if (!old || Date.parse(metric.checkedAt || '') >= Date.parse(old.checkedAt || '') || !old.checkedAt) metrics.set(metric.key, metric);
    }
    const isNewer = !previous?.checkedAt || Date.parse(safe.checkedAt || '') >= Date.parse(previous.checkedAt);
    output.set(safe.id, { ...previous, id: safe.id, ...(isNewer && safe.checkedAt ? { checkedAt: safe.checkedAt } : {}), ...(isNewer && safe.state ? { state: safe.state } : {}), metrics: [...metrics.values()] });
  }
  return [...output.values()];
}

export async function onRequest(context) {
  if (!['GET', 'HEAD'].includes(context.request.method)) return new Response(null, { status: 405, headers: { ...HEADERS, allow: 'GET, HEAD' } });
  if (context.request.method === 'HEAD') return new Response(null, { headers: HEADERS });
  const cache = typeof caches === 'undefined' ? null : caches.default;
  const cacheKey = new Request(new URL('/api/resource-usage?cache=studio-v1', context.request.url));
  let previous;
  try { previous = await cache?.match(cacheKey).then(response => response?.json()); } catch { /* Cache is optional. */ }
  const now = Date.now();
  if (previous && now - previous.cachedAt < TTL * 1000) return Response.json(previous.data, { headers: HEADERS });

  const collected = await collectUsage(context.env).catch(() => ({ resources: [], connectedProviders: [], errors: [] }));
  const base = dashboard.resources.map(resource => ({ id: resource.id, metrics: resource.metrics || [] }));
  const resources = mergeResources(base, previous?.data?.resources, snapshot.resources, collected.resources);
  const data = { version: 1, refreshAfterSeconds: TTL, connectedProviders: collected.connectedProviders, resources };
  // A failed provider retains its original observation time. It never becomes zero usage.
  if (cache) context.waitUntil(cache.put(cacheKey, Response.json({ cachedAt: now, data }, { headers: { 'cache-control': 'max-age=86400' } })).catch(() => {}));
  return Response.json(data, { headers: HEADERS });
}
