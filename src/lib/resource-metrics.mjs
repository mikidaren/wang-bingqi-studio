// Shared by the server-rendered dashboard, refreshed cards and public usage API.
const kinds = new Set(['cpu', 'memory', 'storage', 'gpu', 'quota', 'runtime', 'network', 'concurrency', 'requests']);
export const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export const formatNumber = value => new Intl.NumberFormat('zh-CN', value !== 0 && value < 0.01
  ? { notation: 'scientific', maximumSignificantDigits: 3 } : { maximumFractionDigits: 2 }).format(value);
const displayUnit = unit => ({ minutes: '分钟', seconds: '秒', hours: '小时', requests: '次' })[unit] || unit;
export function formatAmount(value, unit = '') {
  if (unit === 'USD') return `$${formatNumber(value)}`;
  if (unit === 'bytes') {
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    let scaled = value;
    let index = 0;
    while (scaled >= 1024 && index < units.length - 1) { scaled /= 1024; index += 1; }
    return `${formatNumber(scaled)} ${units[index]}`;
  }
  return `${formatNumber(value)}${unit ? ` ${displayUnit(unit)}` : ''}`;
}
export const confirmedExhausted = metric => metric?.mode === 'usage'
  && ['user-confirmed', 'observed'].includes(metric.basis)
  && metric.quotaState === 'exhausted' && metric.percent === 100;

export function isValidMetric(metric) {
  if (!metric || typeof metric.key !== 'string' || !/^[a-z0-9_]{1,48}$/.test(metric.key)
    || !kinds.has(metric.kind) || typeof metric.label !== 'string'
    || typeof metric.displayValue !== 'string' || !metric.displayValue.trim()
    || !['recorded-config', 'plan-limit', 'observed', 'user-confirmed'].includes(metric.basis)
    || !['value', 'used', 'limit', 'remaining', 'percent'].every(key => metric[key] === undefined || finite(metric[key]))) return false;
  if (confirmedExhausted(metric)) return true;
  if (metric.basis === 'user-confirmed') return false;
  if (metric.mode === 'usage') return metric.basis === 'observed' && finite(metric.used);
  if (metric.mode === 'balance') return metric.basis === 'observed' && finite(metric.remaining);
  if (metric.mode === 'capacity') return finite(metric.value)
    || (metric.kind === 'gpu' && metric.basis === 'recorded-config' && metric.value === undefined);
  return false;
}

export function isVisibleResource(resource) {
  if (!resource || resource.availability === 'historical') return false;
  const metrics = (resource.metrics || []).filter(isValidMetric);
  if (resource.availability === 'restricted') return metrics.some(confirmedExhausted);
  if (resource.claimStatus === 'claimed') return true;
  return resource.claimStatus === 'registered' && metrics.some(metric => metric.basis === 'observed' && ['usage', 'balance'].includes(metric.mode));
}

export function getMetricProgress(metric) {
  if (!isValidMetric(metric)) return null;
  if (metric.mode === 'usage') {
    const percent = confirmedExhausted(metric) ? 100 : finite(metric.percent) ? metric.percent
      : finite(metric.used) && finite(metric.limit) && metric.limit > 0 ? metric.used / metric.limit * 100 : null;
    if (percent === null || !Number.isFinite(percent)) return null;
    const remaining = finite(metric.remaining) ? metric.remaining
      : finite(metric.used) && finite(metric.limit) ? Math.max(0, metric.limit - metric.used) : null;
    const remainingLabel = metric.referenceLabel === '消费上限' ? '距消费上限' : '剩余';
    return {
      kind: 'usage', percent, fill: Math.min(100, percent),
      tone: percent >= 100 ? 'exhausted' : percent >= 80 ? 'warning' : 'normal',
      left: `已用 ${percent > 0 && percent < 0.1 ? '<0.1' : formatNumber(percent)}%`,
      right: confirmedExhausted(metric) ? '额度已用完' : remaining !== null ? `${remainingLabel} ${formatAmount(remaining, metric.unit)}` : metric.periodLabel || '',
      valueText: confirmedExhausted(metric) ? '额度已用完，已用 100%' : `已用 ${String(percent)}%${remaining !== null ? `，${remainingLabel} ${formatAmount(remaining, metric.unit)}` : ''}`,
    };
  }
  if (metric.mode === 'balance' && finite(metric.remaining) && finite(metric.limit) && metric.limit > 0) {
    const percent = metric.remaining / metric.limit * 100;
    if (!Number.isFinite(percent)) return null;
    return {
      kind: 'balance', percent, fill: Math.min(100, percent), tone: 'available',
      left: metric.key === 'credits' ? '可用余额' : '剩余可用', right: `${metric.referenceLabel || '账期额度'} ${formatAmount(metric.limit, metric.unit)}`,
      valueText: `剩余可用 ${formatAmount(metric.remaining, metric.unit)}，${metric.referenceLabel || '账期额度'} ${formatAmount(metric.limit, metric.unit)}`,
    };
  }
  return null;
}

export function metricLabel(metric) {
  return metric.mode === 'balance' && metric.key === 'credits' ? '可用余额' : metric.label;
}

export function metricDisplayValue(metric) {
  if (confirmedExhausted(metric)) return '已用完';
  if (metric.mode === 'usage' && finite(metric.used) && finite(metric.limit) && metric.limit > 0) {
    if (metric.displayValue.includes('/')) return metric.displayValue;
    if (metric.unit === 'bytes') return `${formatAmount(metric.used, 'bytes')} / ${formatAmount(metric.limit, 'bytes')}`;
    return metric.unit === 'USD' ? `${formatAmount(metric.used, 'USD')} / ${formatAmount(metric.limit, 'USD')}`
      : `${formatNumber(metric.used)} / ${formatAmount(metric.limit, metric.unit)}`;
  }
  return metric.displayValue;
}

export function isRedundantPlanMetric(metric, metrics) {
  return metric.key === 'plan_credits' && metrics.some(balance => balance.mode === 'balance'
    && balance.basis === 'observed' && finite(balance.limit) && balance.limit === metric.value
    && balance.unit === metric.unit && getMetricProgress(balance));
}
