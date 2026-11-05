// Cloudflare Pages Function —— studio.miki2022.eu.org/api/*
// 与静态页同源的服务端代理。所有 API Key 存 Pages 环境变量（secret_text），
// 绝不写进 public 仓库 / 静态页 / 构建产物。
//
// 与本机 vite 代理的差异：
//   - Gemini 反代 CLIProxyAPI 在用户本机 localhost:8317，云端不可达 → 线上不启用，
//     /api/status 里报 false，前端自动退到 Agnes（免费、云端可达）。
//   - 本机 dev 仍默认 gemini-3.1-flash-image。

const PROVIDERS = {
  openai: { base: 'https://api.openai.com', env: 'OPENAI_API_KEY', header: 'authorization' },
  hunyuan: { base: 'https://tokenhub.tencentmaas.com', env: 'HUNYUAN_API_KEY', header: 'authorization' },
  dashscope: { base: 'https://dashscope.aliyuncs.com', env: 'DASHSCOPE_API_KEY', header: 'authorization' },
  gemini: { base: 'https://generativelanguage.googleapis.com', env: 'GEMINI_API_KEY', header: 'x-goog-api-key' },
}

const IMAGE_HOSTS = [
  /\.myqcloud\.com$/, /\.aliyuncs\.com$/, /\.googleusercontent\.com$/,
  /\.openai\.com$/, /\.agnes-ai\.cn$/, /\.modelscope\.cn$/,
]

const ALLOWED_ORIGINS = [
  'https://studio.miki2022.eu.org',
  'https://wang-bingqi-studio.pages.dev',
  'http://localhost:5173',
]

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
})

function withTimeout(ms) {
  const c = new AbortController()
  setTimeout(() => c.abort(), ms)
  return c.signal
}

function bytesToBase64(bytes) {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

async function fetchAsInline(url, headers = {}) {
  const r = await fetch(url, { headers, signal: withTimeout(120000) })
  if (!r.ok) throw new Error(`下载生成图失败（HTTP ${r.status}）`)
  const mime = (r.headers.get('content-type') || 'image/png').split(';')[0]
  return { mimeType: mime, data: bytesToBase64(new Uint8Array(await r.arrayBuffer())) }
}

function dims(aspect, quality) {
  const table = quality === '2k'
    ? { '16:9': [2048, 1152], '4:3': [1792, 1344], '1:1': [1536, 1536], '3:4': [1344, 1792] }
    : { '16:9': [1280, 720], '4:3': [1152, 864], '1:1': [1024, 1024], '3:4': [864, 1152] }
  return table[aspect] || table['16:9']
}

async function generate(req, env) {
  const [w, h] = dims(req.aspect, req.quality)

  if (req.provider === 'agnes') {
    if (!env.AGNES_API_KEY) throw new Error('未配置 AGNES_API_KEY')
    const r = await fetch('https://api.agnes-ai.cn/v1/images/generations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.AGNES_API_KEY}` },
      body: JSON.stringify({
        model: req.model || 'agnes-image-2.1-flash',
        prompt: req.prompt,
        size: req.quality === '2k' ? '2K' : '1K',
        ratio: req.aspect,
        n: 1,
      }),
      signal: withTimeout(180000),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(`Agnes HTTP ${r.status}：${j?.error?.message || JSON.stringify(j).slice(0, 160)}`)
    const url = j?.data?.[0]?.url
    if (!url) throw new Error('Agnes 没有返回图片 URL')
    return fetchAsInline(url)
  }

  if (req.provider === 'pollinations') {
    if (!env.POLLINATIONS_API_KEY) throw new Error('未配置 POLLINATIONS_API_KEY')
    const q = new URLSearchParams({
      model: req.model || 'tongyi-mai/z-image-turbo',
      width: String(w), height: String(h), quality: 'medium', seed: String(Date.now() % 100000),
    })
    const r = await fetch(`https://gen.pollinations.ai/image/${encodeURIComponent(req.prompt)}?${q}`, {
      headers: { authorization: `Bearer ${env.POLLINATIONS_API_KEY}` },
      signal: withTimeout(180000),
    })
    if (!r.ok) throw new Error(`Pollinations HTTP ${r.status}：${(await r.text()).slice(0, 160)}`)
    const mime = (r.headers.get('content-type') || 'image/jpeg').split(';')[0]
    return { mimeType: mime, data: bytesToBase64(new Uint8Array(await r.arrayBuffer())) }
  }

  if (req.provider === 'cloudflare' || req.provider === 'modelscope') {
    throw new Error(`${req.provider} 的凭据尚未配置，当前线上请用 Agnes 或 Pollinations`)
  }

  if (req.provider === 'gemini-relay') {
    throw new Error('Gemini 反代是本机服务（localhost:8317），云端不可达；请用 npm run dev 在本机使用，或在线上选择 Agnes')
  }

  throw new Error(`未知出图供应商：${req.provider}`)
}

export async function onRequest(context) {
  const { request, env } = context
  const url = new URL(request.url)

  // 只放行本站与本机 dev 的跨站调用；无 Origin 的直接访问（curl / 地址栏）放行，便于自检
  const origin = request.headers.get('Origin') || ''
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return json({ error: '不允许从这个来源调用' }, 403)
  }

  const path = url.pathname.replace(/^\/api\/?/, '')
  try {
    if (path === 'status') {
      return json({
        proxy: true,
        keys: {
          openai: !!env.OPENAI_API_KEY,
          hunyuan: !!env.HUNYUAN_API_KEY,
          dashscope: !!env.DASHSCOPE_API_KEY,
          gemini: !!env.GEMINI_API_KEY,
          'gemini-relay': false, // 本机反代，云端不可达
          agnes: !!env.AGNES_API_KEY,
          pollinations: !!env.POLLINATIONS_API_KEY,
          cloudflare: false,
          modelscope: false,
        },
      })
    }

    if (path === 'gen' && request.method === 'POST') {
      const body = await request.json()
      return json(await generate(body, env))
    }

    if (path === 'image') {
      const target = new URL(url.searchParams.get('url') || '')
      if (!/^https?:$/.test(target.protocol) || !IMAGE_HOSTS.some((r) => r.test(target.hostname))) {
        return json({ error: '不允许代理这个地址' }, 400)
      }
      const r = await fetch(target, { signal: withTimeout(60000) })
      return new Response(r.body, {
        status: r.status,
        headers: { 'content-type': r.headers.get('content-type') || 'application/octet-stream' },
      })
    }

    const m = path.match(/^p\/(\w+)(\/.*)$/)
    const p = m && PROVIDERS[m[1]]
    if (!m || !p) return json({ error: '未知接口' }, 404)

    const key = env[p.env]
    if (!key) return json({ error: `${p.env} 未配置` }, 503)
    const headers = new Headers(request.headers)
    headers.set('content-type', 'application/json')
    headers.set(p.header, p.header === 'authorization' ? `Bearer ${key}` : key)
    headers.delete('host')
    headers.delete('origin')
    headers.delete('referer')
    headers.delete('cookie')
    const r = await fetch(p.base + m[2] + url.search, {
      method: request.method,
      headers,
      body: request.method === 'GET' ? undefined : await request.arrayBuffer(),
      signal: withTimeout(180000),
    })
    return new Response(r.body, {
      status: r.status,
      headers: { 'content-type': r.headers.get('content-type') || 'application/json' },
    })
  } catch (e) {
    return json({ error: `云端代理请求失败：${e.message}` }, 502)
  }
}
