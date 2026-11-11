import { Buffer } from 'node:buffer'
import { createHash, timingSafeEqual } from 'node:crypto'
import { readGenerationConfig } from './config.mjs'
import { createLimiter } from './limits.mjs'
import { compileEdgeSchema } from './edge-schema.mjs'
import { composeDesign, drawDesign, MAX_BODY_BYTES, RequestFailure, validateCompose, validateDraw } from './relay-core.mjs'

function json(value, status = 200, headers = {}) {
  return Response.json(value, {
    status,
    headers: {
      'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      'referrer-policy': 'same-origin', ...headers,
    },
  })
}

function authorized(request, config) {
  if (!config.password) return true
  const match = /^Basic ([A-Za-z0-9+/=]+)$/.exec(request.headers.get('authorization') || '')
  if (!match) return false
  const actual = createHash('sha256').update(Buffer.from(match[1], 'base64')).digest()
  const expected = createHash('sha256').update(config.username + ':' + config.password).digest()
  return timingSafeEqual(actual, expected)
}

async function readJSON(request) {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('content-type') || '')) {
    throw new RequestFailure(415, '请使用 JSON 提交设计内容。')
  }
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) {
    throw new RequestFailure(413, '提交内容过大，请减少或压缩参考图片。')
  }
  if (!request.body) throw new RequestFailure(400, '请求内容有误，请重新提交。')
  const reader = request.body.getReader()
  const chunks = []
  let size = 0
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > MAX_BODY_BYTES) throw new RequestFailure(413, '提交内容过大，请减少或压缩参考图片。')
      chunks.push(Buffer.from(part.value))
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
    catch { throw new RequestFailure(400, '请求内容有误，请重新提交。') }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

/** Construct once per Pages isolate so requests share their rate/concurrency counters. */
export function createEdgeHandler(env) {
  const config = readGenerationConfig(env)
  const limits = createLimiter(config)
  const anonymousApp = env.SHOWCASE_ANONYMOUS_APP === '1' && config.imageProvider === 'agnes' && config.textProvider === 'chunxiao'
  return async request => {
    const url = new URL(request.url)
    const compose = url.pathname === '/category/project/design/compose'
    const draw = url.pathname === '/category/project/design/draw'
    const access = url.pathname === '/category/project/design/access' && request.method === 'GET'
    if (!compose && !draw && !access) return json({ error: '找不到这个接口。' }, 404)
    const privateProvider = ['openai', 'magpie'].includes(compose ? config.textProvider : config.imageProvider)
      || (draw && config.imageProvider === 'agnes' && !anonymousApp)
    if (privateProvider && !config.password) {
      return json({ error: '生成服务尚未开放。' }, 503)
    }
    if (!anonymousApp && !authorized(request, config)) {
      return json({ error: '请输入演示访问账号和口令。' }, 401, {
        'www-authenticate': 'Basic realm="IceWorld Private Showcase", charset="UTF-8"',
      })
    }
    if (access) return new Response(anonymousApp
      ? '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Studio</title><p>当前工作台可直接使用，无需登录。</p><a href="../">打开设计工作台</a></html>'
      : '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Studio 生成权限</title><p>已通过生成权限验证。</p><a href="../">返回设计工作台</a></html>', {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    })
    if (request.method !== 'POST') return json({ error: '请通过页面提交设计请求。' }, 405, { allow: 'POST' })
    if (url.search || request.headers.get('origin') !== (config.publicOrigin || url.origin)) {
      return json({ error: '请从当前演示网站发起请求。' }, 403)
    }
    if (!limits.enter(request.headers.get('cf-connecting-ip') || 'unknown')) {
      return json({ error: '当前生成请求较多，请稍后再试。' }, 429, { 'retry-after': '60' })
    }
    let operation = compose ? 'compose' : 'draw'
    try {
      const body = await readJSON(request)
      if (compose && typeof body?.name === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(body.name)) operation = body.name
      const result = compose
        ? await composeDesign(config, validateCompose(body, compileEdgeSchema), request.signal)
        : await drawDesign(config, validateDraw(body), request.signal, request.headers.get('x-studio-drawing-id'))
      return json(result)
    } catch (error) {
      if (error?.diagnostic || !(error instanceof RequestFailure)) {
        console.warn('[design]', JSON.stringify({
          operation, status: error instanceof RequestFailure ? error.status : 500,
          ...(error?.diagnostic || { stage: 'internal_error' }),
        }))
      }
      return json({
        error: error instanceof RequestFailure ? error.message : '服务暂时无法完成请求，请稍后重试。',
      }, error instanceof RequestFailure ? error.status : 500)
    } finally {
      limits.leave()
    }
  }
}
