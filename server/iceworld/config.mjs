export const isLoopbackHost = host => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(String(host).toLowerCase())

export function readBasePath(value = '/') {
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(value)) throw new Error('页面挂载路径需以斜杠开头和结尾。')
  return value
}

function integer(value, fallback, maximum) {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) throw new Error('服务端数值配置无效。')
  return parsed
}

export function readGenerationConfig(env) {
  const password = env.SHOWCASE_LIVE_TOKEN || ''
  const base = new URL(env.CHUNXIAO_BASE_URL || 'https://api.chunxiao.pro')
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/' ||
      !(base.protocol === 'https:' || (base.protocol === 'http:' && isLoopbackHost(base.hostname)))) {
    throw new Error('生成服务地址配置无效。')
  }
  const textProvider = env.SHOWCASE_TEXT_PROVIDER || 'chunxiao'
  if (!['chunxiao', 'openai'].includes(textProvider)) throw new Error('文本生成渠道配置无效。')
  const imageProvider = env.SHOWCASE_IMAGE_PROVIDER || 'chunxiao'
  if (!['chunxiao', 'openai', 'magpie', 'agnes'].includes(imageProvider)) throw new Error('图像生成渠道配置无效。')
  let magpieDrawOrigin
  if (imageProvider === 'magpie' && env.MAGPIE_DRAW_ORIGIN) {
    const origin = new URL(env.MAGPIE_DRAW_ORIGIN)
    if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' ||
        !(origin.protocol === 'https:' || (origin.protocol === 'http:' && isLoopbackHost(origin.hostname)))) {
      throw new Error('Magpie 绘图服务地址配置无效。')
    }
    magpieDrawOrigin = origin.origin
  }
  const imageModel = env.CHUNXIAO_IMAGE_MODEL || 'nano-banana-pro'
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(imageModel)) throw new Error('图像模型配置无效。')
  let publicOrigin
  if (env.SHOWCASE_ORIGIN) {
    const origin = new URL(env.SHOWCASE_ORIGIN)
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password ||
        origin.pathname !== '/' || origin.search || origin.hash) throw new Error('演示网站来源配置无效。')
    publicOrigin = origin.origin
  }
  return {
    password, username: env.SHOWCASE_USER || 'showcase',
    publicOrigin, baseUrl: base.origin, basePath: readBasePath(env.STUDIO_BASE_PATH),
    textProvider, textKey: env.CHUNXIAO_TEXT_KEY || '', imageKey: env.CHUNXIAO_IMAGE_KEY || '',
    imageProvider, imageModel, openaiKey: env.OPENAI_API_KEY || '', openaiImageKey: env.OPENAI_IMAGE_API_KEY || '',
    textModel: 'gpt-6-sol', magpieDrawOrigin, magpieDrawToken: env.MAGPIE_DRAW_TOKEN || '',
    agnesKey: env.AGNES_API_KEY || '',
    perClientLimit: integer(env.SHOWCASE_RATE_LIMIT, 20, 120),
    globalLimit: integer(env.SHOWCASE_GLOBAL_RATE_LIMIT, 60, 1000),
    concurrency: integer(env.SHOWCASE_MAX_CONCURRENT, 3, 8),
  }
}

export function readServerConfig(env) {
  const config = readGenerationConfig(env)
  const host = env.HOST || '127.0.0.1'
  if ((!isLoopbackHost(host) || (config.publicOrigin && !isLoopbackHost(new URL(config.publicOrigin).hostname))) && !config.password) {
    throw new Error('开放远程演示前，请设置服务端访问口令。')
  }
  return { ...config, host, port: integer(env.PORT, 3000, 65535) }
}
