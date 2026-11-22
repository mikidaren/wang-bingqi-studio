type Metric = {
  key: string; label: string; kind: string; mode: string; displayValue: string;
  basis: string; checkedAt?: string; periodLabel?: string;
  used?: number; limit?: number; remaining?: number; percent?: number; unit?: string;
};
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const format = (value: number) => new Intl.NumberFormat('zh-CN', value !== 0 && value < 0.01 ? { notation: 'scientific', maximumSignificantDigits: 3 } : { maximumFractionDigits: 2 }).format(value);
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
  let interval = 60_000;
  let disposed = false;
  let controller: AbortController | null = null;
  const timeFormatter = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

  function renderMetric(resourceId: string, metric: Metric) {
    if (metric.basis !== 'observed' || !['usage', 'balance', 'capacity'].includes(metric.mode)
      || !/^[a-z0-9_]{1,48}$/.test(metric.key) || !icons[metric.kind] || !metric.displayValue
      || !['used', 'limit', 'remaining', 'percent'].every(key => metric[key as 'used' | 'limit' | 'remaining' | 'percent'] === undefined || finite(metric[key as 'used' | 'limit' | 'remaining' | 'percent']))) return null;
    const template = root.querySelector<HTMLTemplateElement>('[data-usage-metric-template]');
    const element = template?.content.firstElementChild?.cloneNode(true) as HTMLElement | undefined;
    if (!element) return null;
    const label = metric.mode === 'balance' ? '剩余额度' : metric.key === 'plan_credits' ? '账期额度' : metric.label;
    element.classList.add(`cloud-metric--${metric.kind}`, `cloud-metric--${metric.mode}`);
    Object.assign(element.dataset, { metricKey: metric.key, metricMode: metric.mode, metricKind: metric.kind, metricBasis: 'observed' });
    const labelElement = element.querySelector<HTMLElement>('[data-metric-label]')!;
    labelElement.id = `${resourceId}-metric-${metric.key}`;
    labelElement.textContent = label;
    element.setAttribute('aria-labelledby', labelElement.id);
    element.querySelector('use')!.setAttribute('href', `#cloud-icon-${icons[metric.kind]}`);
    const value = element.querySelector<HTMLElement>('.cloud-metric-value')!;
    value.textContent = metric.displayValue;
    if (metric.displayValue.length > 16) value.classList.add('cloud-metric-value--compact');
    const bar = element.querySelector<HTMLElement>('.cloud-usage-bar')!;
    const scale = element.querySelector<HTMLElement>('.cloud-usage-scale')!;
    if (metric.mode === 'usage' && finite(metric.percent)) {
      element.dataset.metricPercent = String(metric.percent);
      bar.setAttribute('role', 'meter');
      bar.setAttribute('aria-label', `${label}：${metric.displayValue}`);
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      bar.setAttribute('aria-valuenow', String(Math.min(100, metric.percent)));
      bar.setAttribute('aria-valuetext', `已用 ${String(metric.percent)}%`);
      bar.firstElementChild!.setAttribute('style', `transform:scaleX(${Math.min(100, metric.percent) / 100})`);
      scale.firstElementChild!.textContent = `已用 ${metric.percent > 0 && metric.percent < 0.1 ? '<0.1' : format(metric.percent)}%`;
      scale.lastElementChild!.textContent = finite(metric.remaining) ? `剩余 ${format(metric.remaining)} ${metric.unit || ''}` : metric.periodLabel || '';
    } else {
      bar.hidden = true;
      scale.firstElementChild!.textContent = metric.mode === 'usage' ? '已用' : '';
      scale.lastElementChild!.textContent = metric.periodLabel || '';
      if (!scale.textContent?.trim()) scale.hidden = true;
      element.querySelector<HTMLElement>('.cloud-capacity-line')!.hidden = metric.mode === 'usage';
    }
    if (metric.mode === 'usage' && finite(metric.percent)) element.querySelector<HTMLElement>('.cloud-capacity-line')!.hidden = true;
    element.title = [label, metric.displayValue, metric.periodLabel, validTime(metric.checkedAt) ? `采集于 ${timeFormatter.format(new Date(metric.checkedAt!))}` : ''].filter(Boolean).join('；');
    return element;
  }

  async function refresh(manual = false) {
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
        for (const metric of resource.metrics as Metric[]) {
          if (resource.id === 'instabox-free') {
            const freshness = ['cpu', 'memory'].includes(metric.key) ? 120_000 : 600_000;
            if (!validTime(metric.checkedAt) || Date.now() - Date.parse(metric.checkedAt!) > freshness) continue;
            if (['paused', 'stopped'].includes(resource.state) && ['cpu', 'memory'].includes(metric.key)) continue;
          }
          const element = renderMetric(resource.id, metric);
          if (!element) continue;
          const old = grid.querySelector<HTMLElement>(`[data-metric-key="${metric.key}"]`);
          old ? old.replaceWith(element) : grid.append(element);
          if (validTime(metric.checkedAt) && (!latest || Date.parse(metric.checkedAt!) > Date.parse(latest))) latest = metric.checkedAt!;
        }
        const stateBadge = card.querySelector<HTMLElement>('[data-resource-state]');
        if (stateBadge) stateBadge.hidden = true;
        if (stateBadge && validTime(resource.checkedAt) && Date.now() - Date.parse(resource.checkedAt) < 120_000 && ['running', 'paused', 'stopped'].includes(resource.state)) {
          stateBadge.textContent = ({ running: '运行中', paused: '已暂停', stopped: '已停止' } as Record<string, string>)[resource.state];
          stateBadge.hidden = false;
        }
        const date = card.querySelector<HTMLElement>('.cloud-record-date');
        if (date && latest) {
          const time = document.createElement('time');
          time.dateTime = latest;
          time.title = new Date(latest).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
          time.textContent = timeFormatter.format(new Date(latest));
          date.replaceChildren(document.createTextNode('更新于 '), time);
        }
        card.dataset.search = card.textContent?.normalize('NFKC').toLocaleLowerCase() || '';
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
      if (!disposed) { clearTimeout(timer); timer = setTimeout(() => refresh(), interval); }
    }
  }
  const onVisibility = () => { if (!document.hidden) void refresh(); };
  refreshButton.disabled = false;
  refreshButton.addEventListener('click', () => void refresh(true));
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('astro:before-swap', () => { disposed = true; clearTimeout(timer); controller?.abort(); document.removeEventListener('visibilitychange', onVisibility); }, { once: true });
  void refresh();
}
