import { finite, getMetricProgress, isValidMetric, isRedundantPlanMetric, metricLabel, metricDisplayValue } from '../lib/resource-metrics.mjs';

type Metric = {
  key: string; label: string; kind: string; mode: string; displayValue: string;
  basis: string; checkedAt?: string; periodLabel?: string; quotaState?: string; referenceLabel?: string;
  value?: number; used?: number; limit?: number; remaining?: number; percent?: number; unit?: string;
};
const icons: Record<string, string> = { cpu: 'cpu', memory: 'memory', storage: 'database', gpu: 'gpu', quota: 'spark', runtime: 'clock', network: 'globe', concurrency: 'box', requests: 'code' };
const validTime = (value?: string) => Boolean(value && Number.isFinite(Date.parse(value)));

export function startUsageRefresh(root: HTMLElement) {
  const refreshButton = root.querySelector<HTMLButtonElement>('[data-refresh-usage]');
  const status = root.querySelector<HTMLElement>('[data-usage-refresh-status]');
  if (!refreshButton || !status) return;
  const originals = new Map<string, HTMLElement>();
  const originalDates = new Map<string, HTMLElement>();
  root.querySelectorAll<HTMLElement>('[data-resource-card]').forEach(card => {
    const grid = card.querySelector<HTMLElement>('.cloud-metric-grid');
    if (grid && card.dataset.resourceId) originals.set(card.dataset.resourceId, grid.cloneNode(true) as HTMLElement);
    const date = card.querySelector<HTMLElement>('.cloud-record-date');
    if (date && card.dataset.resourceId) originalDates.set(card.dataset.resourceId, date.cloneNode(true) as HTMLElement);
  });
  let busy = false;
  let timer: ReturnType<typeof setTimeout>;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let interval = 60_000;
  let disposed = false;
  let controller: AbortController | null = null;
  const timeFormatter = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

  function updateSearch(card: HTMLElement) {
    const visibleText = ['h2', '.cloud-provider-name', '.cloud-card-purpose']
      .map(selector => card.querySelector<HTMLElement>(selector)?.textContent || '');
    card.querySelectorAll<HTMLElement>('.cloud-metric').forEach(metric => {
      if (metric.hidden) return;
      visibleText.push(metric.querySelector<HTMLElement>('.cloud-metric-label')?.textContent || '',
        metric.querySelector<HTMLElement>('.cloud-metric-value')?.textContent || '');
    });
    const badge = card.querySelector<HTMLElement>('[data-resource-state]');
    if (badge && !badge.hidden) visibleText.push(badge.textContent || '');
    card.dataset.search = visibleText.join(' ').normalize('NFKC').toLocaleLowerCase();
  }

  function clearState(badge: HTMLElement) {
    const changed = !badge.hidden || Boolean(badge.textContent) || Boolean(badge.dataset.stateCheckedAt);
    badge.hidden = true;
    badge.textContent = '';
    delete badge.dataset.stateCheckedAt;
    return changed;
  }

  function expireObserved() {
    clearTimeout(expiryTimer);
    expiryTimer = undefined;
    if (disposed) return;
    const card = root.querySelector<HTMLElement>('[data-resource-id="instabox-free"]');
    const grid = card?.querySelector<HTMLElement>('.cloud-metric-grid');
    if (!card || !grid) return;
    const freshness: Record<string, number> = { cpu: 120_000, memory: 120_000, storage: 600_000 };
    let nextExpiry = Infinity;
    let changed = false;
    const now = Date.now();

    grid.querySelectorAll<HTMLElement>('[data-metric-basis="observed"]').forEach(metric => {
      const key = metric.dataset.metricKey || '';
      if (!freshness[key]) return;
      const checkedAt = metric.dataset.metricCheckedAt;
      const expiresAt = validTime(checkedAt) ? Date.parse(checkedAt!) + freshness[key] : now;
      if (expiresAt <= now) {
        const original = originals.get('instabox-free')?.querySelector<HTMLElement>(`[data-metric-key="${key}"]`);
        original ? metric.replaceWith(original.cloneNode(true)) : metric.remove();
        changed = true;
      } else {
        nextExpiry = Math.min(nextExpiry, expiresAt);
      }
    });

    const badge = card.querySelector<HTMLElement>('[data-resource-state]');
    if (badge && !badge.hidden) {
      const checkedAt = badge.dataset.stateCheckedAt;
      const expiresAt = validTime(checkedAt) ? Date.parse(checkedAt!) + 120_000 : now;
      if (expiresAt <= now) changed = clearState(badge) || changed;
      else nextExpiry = Math.min(nextExpiry, expiresAt);
    } else if (badge) {
      changed = clearState(badge) || changed;
    }

    if (changed) {
      const date = card.querySelector<HTMLElement>('.cloud-record-date');
      const latest = Array.from(grid.querySelectorAll<HTMLElement>('[data-metric-basis="observed"]'))
        .map(metric => metric.dataset.metricCheckedAt).filter(validTime)
        .sort((a, b) => Date.parse(b!) - Date.parse(a!))[0];
      if (date && latest) {
        const time = document.createElement('time');
        time.dateTime = latest;
        time.title = new Date(latest).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        time.textContent = timeFormatter.format(new Date(latest));
        date.replaceChildren(document.createTextNode('更新于 '), time);
      } else {
        const originalDate = originalDates.get('instabox-free');
        if (date && originalDate) date.replaceChildren(...Array.from(originalDate.cloneNode(true).childNodes));
      }
      updateSearch(card);
      root.dispatchEvent(new Event('cloud:usage-updated'));
    }
    if (Number.isFinite(nextExpiry)) expiryTimer = setTimeout(expireObserved, Math.max(1, nextExpiry - Date.now()));
  }

  function renderMetric(resourceId: string, metric: Metric) {
    if (!['observed', 'user-confirmed'].includes(metric.basis) || !isValidMetric(metric)) return null;
    const template = root.querySelector<HTMLTemplateElement>('[data-usage-metric-template]');
    const element = template?.content.firstElementChild?.cloneNode(true) as HTMLElement | undefined;
    if (!element) return null;
    const label = metricLabel(metric);
    const displayValue = metricDisplayValue(metric);
    const progress = getMetricProgress(metric);
    element.classList.add(`cloud-metric--${metric.kind}`, `cloud-metric--${metric.mode}`);
    Object.assign(element.dataset, { metricKey: metric.key, metricMode: metric.mode, metricKind: metric.kind, metricBasis: metric.basis });
    if (validTime(metric.checkedAt)) element.dataset.metricCheckedAt = metric.checkedAt!;
    if (metric.quotaState === 'exhausted') element.dataset.quotaState = 'exhausted';
    const labelElement = element.querySelector<HTMLElement>('[data-metric-label]')!;
    labelElement.id = `${resourceId}-metric-${metric.key}`;
    labelElement.textContent = label;
    element.setAttribute('aria-labelledby', labelElement.id);
    element.querySelector('use')!.setAttribute('href', `#cloud-icon-${icons[metric.kind]}`);
    const value = element.querySelector<HTMLElement>('.cloud-metric-value')!;
    value.textContent = displayValue;
    if (displayValue.length > 20) value.classList.add('cloud-metric-value--compact');
    const bar = element.querySelector<HTMLElement>('.cloud-usage-bar')!;
    const scale = element.querySelector<HTMLElement>('.cloud-usage-scale')!;
    if (progress) {
      element.classList.add('cloud-metric--progress');
      element.dataset.metricPercent = String(progress.percent);
      element.dataset.progressTone = progress.tone;
      bar.setAttribute('role', 'meter');
      bar.setAttribute('aria-label', label);
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      bar.setAttribute('aria-valuenow', String(progress.fill));
      bar.setAttribute('aria-valuetext', progress.valueText);
      bar.firstElementChild!.setAttribute('style', `width:${progress.fill}%`);
      scale.firstElementChild!.textContent = progress.left;
      scale.lastElementChild!.textContent = progress.right;
    } else {
      bar.hidden = true;
      scale.firstElementChild!.textContent = metric.mode === 'usage' ? '已用' : '';
      scale.lastElementChild!.textContent = metric.periodLabel || '';
      if (!scale.textContent?.trim()) scale.hidden = true;
      if (!scale.textContent?.trim()) element.querySelector<HTMLElement>('.cloud-metric-visual')!.hidden = true;
    }
    if (progress && metric.periodLabel) {
      const period = document.createElement('span');
      period.classList.add('cloud-metric-period');
      period.textContent = metric.periodLabel;
      element.append(period);
    }
    element.title = [label, displayValue, metric.basis === 'user-confirmed' ? '用户确认' : '账户读数', progress?.valueText, metric.periodLabel,
      validTime(metric.checkedAt) ? `${metric.basis === 'user-confirmed' ? '确认' : '采集'}于 ${timeFormatter.format(new Date(metric.checkedAt!))}` : ''].filter(Boolean).join('；');
    return element;
  }

  function syncQuotaBadge(card: HTMLElement) {
    const exhausted = Boolean(card.querySelector('[data-metric-key][data-quota-state="exhausted"]'));
    const badge = card.querySelector<HTMLElement>('[data-claim-badge]');
    const label = card.querySelector<HTMLElement>('[data-claim-label]');
    if (exhausted) card.dataset.quotaState = 'exhausted';
    else delete card.dataset.quotaState;
    badge?.classList.toggle('cloud-claim-badge--exhausted', exhausted);
    if (label) label.textContent = exhausted ? '额度用完' : card.dataset.claimStatus === 'registered' ? '已注册' : '已领取';
  }

  async function refresh(manual = false) {
    expireObserved();
    if (busy || disposed || (!manual && document.hidden)) return;
    busy = true;
    refreshButton!.disabled = true;
    refreshButton!.setAttribute('aria-busy', 'true');
    if (manual) { status!.hidden = false; status!.textContent = '正在刷新'; }
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 20_000);
    try {
      const response = await fetch('/api/resource-usage', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
      if (!response.ok) throw new Error('refresh');
      const data = await response.json();
      if (data.version !== 1 || !Array.isArray(data.resources)) throw new Error('schema');
      for (const resource of data.resources) {
        if (typeof resource.id !== 'string' || !/^[a-z0-9-]+$/.test(resource.id) || !Array.isArray(resource.metrics)) continue;
        const card = root.querySelector<HTMLElement>(`[data-resource-id="${resource.id}"]`);
        const grid = card?.querySelector<HTMLElement>('.cloud-metric-grid');
        if (!card || !grid) continue;
        if (resource.id === 'instabox-free') {
          const original = originals.get(resource.id);
          if (original) grid.replaceChildren(...Array.from(original.cloneNode(true).childNodes));
          const date = card.querySelector('.cloud-record-date');
          const originalDate = originalDates.get(resource.id);
          if (date && originalDate) date.replaceChildren(...Array.from(originalDate.cloneNode(true).childNodes));
        }
        let latest = '';
        let latestBasis = '';
        for (const metric of resource.metrics as Metric[]) {
          if (isRedundantPlanMetric(metric, resource.metrics)) {
            grid.querySelector<HTMLElement>(`[data-metric-key="${metric.key}"]`)?.remove();
            continue;
          }
          if (resource.id === 'instabox-free') {
            const freshness = ['cpu', 'memory'].includes(metric.key) ? 120_000 : 600_000;
            if (!validTime(metric.checkedAt) || Date.now() - Date.parse(metric.checkedAt!) >= freshness) continue;
            if (['paused', 'stopped'].includes(resource.state) && ['cpu', 'memory'].includes(metric.key)) continue;
          }
          const element = renderMetric(resource.id, metric);
          if (!element) continue;
          const old = grid.querySelector<HTMLElement>(`[data-metric-key="${metric.key}"]`);
          old ? old.replaceWith(element) : grid.append(element);
          if (validTime(metric.checkedAt) && (!latest || Date.parse(metric.checkedAt!) > Date.parse(latest))) { latest = metric.checkedAt!; latestBasis = metric.basis; }
        }
        const stateBadge = card.querySelector<HTMLElement>('[data-resource-state]');
        if (stateBadge) clearState(stateBadge);
        if (stateBadge && validTime(resource.checkedAt) && Date.now() - Date.parse(resource.checkedAt) < 120_000 && ['running', 'paused', 'stopped'].includes(resource.state)) {
          stateBadge.textContent = ({ running: '运行中', paused: '已暂停', stopped: '已停止' } as Record<string, string>)[resource.state];
          stateBadge.dataset.stateCheckedAt = resource.checkedAt;
          stateBadge.hidden = false;
        }
        const date = card.querySelector<HTMLElement>('.cloud-record-date');
        if (date && latest) {
          const time = document.createElement('time');
          time.dateTime = latest;
          time.title = new Date(latest).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
          time.textContent = timeFormatter.format(new Date(latest));
          date.replaceChildren(document.createTextNode(latestBasis === 'user-confirmed' ? '确认于 ' : '更新于 '), time);
        }
        syncQuotaBadge(card);
        updateSearch(card);
      }
      interval = Math.max(60, Number(data.refreshAfterSeconds) || 60) * 1000;
      status!.hidden = false;
      status!.textContent = '每分钟检查更新';
      root.dispatchEvent(new Event('cloud:usage-updated'));
    } catch {
      if (manual && !disposed) { status!.hidden = false; status!.textContent = '刷新失败，已保留原数据'; }
    } finally {
      clearTimeout(timeout);
      busy = false;
      refreshButton!.disabled = false;
      refreshButton!.removeAttribute('aria-busy');
      if (!disposed) {
        expireObserved();
        clearTimeout(timer);
        timer = setTimeout(() => refresh(), interval);
      }
    }
  }
  const onVisibility = () => { expireObserved(); if (!document.hidden) void refresh(); };
  refreshButton.disabled = false;
  refreshButton.addEventListener('click', () => void refresh(true));
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('astro:before-swap', () => { disposed = true; clearTimeout(timer); clearTimeout(expiryTimer); controller?.abort(); document.removeEventListener('visibilitychange', onVisibility); }, { once: true });
  void refresh();
}
