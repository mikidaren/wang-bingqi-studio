import { createEdgeHandler } from '../../../../server/iceworld/edge-handler.mjs'

let handler

export function onRequest({ request, env }) {
  try {
    handler ||= createEdgeHandler(env)
    return handler(request)
  } catch {
    return Response.json({ error: '生成功能暂时无法使用，请稍后重试。' }, {
      status: 503, headers: { 'cache-control': 'no-store' },
    })
  }
}
