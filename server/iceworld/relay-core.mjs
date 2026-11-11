import { Buffer } from 'node:buffer'

const OPENAI_ORIGIN = 'https://api.openai.com'
const MAX_PROMPT = 120_000
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
export const MAX_BODY_BYTES = 40 * 1024 * 1024
const MAX_RESPONSE_BYTES = 40 * 1024 * 1024
const openaiSizes = new Map([
  ['16:9', '1536x864'], ['4:3', '1536x1152'], ['1:1', '1024x1024'], ['3:4', '1152x1536'],
])

export class RequestFailure extends Error {
  constructor(status, message, diagnostic) { super(message); this.status = status; this.diagnostic = diagnostic }
}
const invalid = diagnostic => new RequestFailure(400, '请求内容有误，请检查文字和参考图片。', diagnostic)
const upstreamFailure = (stage, upstreamStatus, validation) => new RequestFailure(
  502, '生成服务暂时无法完成请求，请稍后重试。',
  { stage, ...(upstreamStatus === undefined ? {} : { upstreamStatus }), ...(validation ? { validation } : {}) },
)
const validationPaths = errors => (errors || []).slice(0, 5).map(({ keyword, instancePath, schemaPath }) => ({
  keyword, instancePath, schemaPath,
}))

function text(value, maximum, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && !value.trim())) throw invalid()
  return value
}

function object(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) throw invalid()
}

function image(value, maximum = MAX_IMAGE_BYTES) {
  object(value, ['mimeType', 'data'])
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(value.mimeType) ||
      typeof value.data !== 'string' || !value.data.length || value.data.length > Math.ceil(maximum / 3) * 4 ||
      value.data.length % 4 !== 0 || /[^A-Za-z0-9+/]/.test(value.data.replace(/={1,2}$/, ''))) throw invalid()
  const bytes = Buffer.from(value.data, 'base64')
  const png = value.mimeType === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const jpeg = value.mimeType === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  const webp = value.mimeType === 'image/webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
  const gif = value.mimeType === 'image/gif' && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))
  if (bytes.length > maximum || !(png || jpeg || webp || gif)) throw invalid()
  return { mimeType: value.mimeType, data: bytes.toString('base64') }
}

function references(refs) {
  if (refs === undefined) return []
  if (!Array.isArray(refs) || refs.length > 8) throw invalid()
  return refs.map(ref => image(ref))
}

export function validateCompose(input, compileSchema) {
  object(input, ['name', 'system', 'prompt', 'schema', 'temperature', 'refs'])
  const name = text(input.name, 64)
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) throw invalid()
  const system = text(input.system, 24_000, true)
  const prompt = text(input.prompt, MAX_PROMPT)
  if (!input.schema || typeof input.schema !== 'object' || Array.isArray(input.schema) || JSON.stringify(input.schema).length > 40_000) throw invalid()
  if (input.temperature !== undefined && (typeof input.temperature !== 'number' || !Number.isFinite(input.temperature) ||
      input.temperature < 0 || input.temperature > 2)) throw invalid()
  let validate
  try { validate = compileSchema(input.schema) } catch (error) {
    throw invalid({ stage: 'input_schema_invalid', validation: validationPaths(error.validation) })
  }
  return { name, system, prompt, schema: input.schema, temperature: input.temperature, refs: references(input.refs), validate }
}

export function validateDraw(input) {
  object(input, ['prompt', 'aspect', 'refs'])
  const prompt = text(input.prompt, MAX_PROMPT)
  if (!openaiSizes.has(input.aspect)) throw invalid()
  return { prompt, aspect: input.aspect, refs: references(input.refs) }
}

async function responseJSON(response) {
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw upstreamFailure('upstream_http', response.status)
  }
  if (!response.body) throw upstreamFailure('upstream_empty_body', response.status)
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    await response.body.cancel()
    throw upstreamFailure('upstream_response_too_large', response.status)
  }
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > MAX_RESPONSE_BYTES) throw upstreamFailure('upstream_response_too_large', response.status)
      chunks.push(Buffer.from(part.value))
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
    catch { throw upstreamFailure('upstream_json_invalid', response.status) }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

async function upstream(baseUrl, path, key, body, signal, timeout, method = 'POST') {
  const deadline = AbortSignal.timeout(timeout)
  let upstreamStatus
  try {
    const response = await fetch(new URL(path, baseUrl), {
      method, redirect: 'manual', signal: AbortSignal.any([signal, deadline]),
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify(body),
    })
    upstreamStatus = response.status
    return { body: await responseJSON(response), status: response.status }
  } catch (error) {
    if (error instanceof RequestFailure) throw error
    if (deadline.aborted) throw new RequestFailure(504, '生成等待超时，请稍后重试。', { stage: 'upstream_timeout', upstreamStatus })
    throw upstreamFailure(signal.aborted ? 'request_aborted' : 'upstream_transport', upstreamStatus)
  }
}

export async function composeDesign(config, input, signal) {
  const official = config.textProvider === 'openai'
  const key = official ? config.openaiKey : config.textKey
  if (!key) throw new RequestFailure(503, '现场生成功能尚未启用，请先浏览示例方案。')
  const content = input.refs.length ? [
    { type: 'text', text: input.prompt },
    ...input.refs.map(ref => ({ type: 'image_url', image_url: { url: `data:${ref.mimeType};base64,${ref.data}` } })),
  ] : input.prompt
  const isLayout = input.name === 'architectural_refinement'
  // The relay returns JSON. Local validation enforces the full geometry schema.
  const system = isLayout
    ? input.system + '\nReturn one JSON object conforming to this schema:\n' + JSON.stringify(input.schema)
    : input.system
  const { body: result, status } = await upstream(official ? OPENAI_ORIGIN : config.baseUrl, '/v1/chat/completions', key, {
    model: official ? 'gpt-5.6-sol' : config.textModel, stream: false, max_completion_tokens: isLayout ? 4096 : 8192,
    messages: [{ role: 'system', content: system }, { role: 'user', content }],
    response_format: isLayout
      ? { type: 'json_object' }
      : { type: 'json_schema', json_schema: { name: input.name, strict: true, schema: input.schema } },
    ...(isLayout ? { reasoning_effort: 'low' } : {}),
    ...(official || input.temperature === undefined ? {} : { temperature: input.temperature }),
  }, signal, 120_000)
  const output = result?.choices?.[0]?.message?.content
  if (typeof output !== 'string' || !output.trim()) throw upstreamFailure('output_empty', status)
  let value
  try { value = JSON.parse(output.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '')) } catch { throw upstreamFailure('output_json_invalid', status) }
  if (!input.validate(value)) throw upstreamFailure('output_schema_invalid', status, validationPaths(input.validate.errors))
  return { value }
}

async function drawWithOpenAI(config, input, signal) {
  const key = config.openaiImageKey || config.openaiKey
  if (!key) throw new RequestFailure(503, '图像生成功能尚未启用，请先浏览示例方案。')
  if (input.prompt.length > 32_000) throw new RequestFailure(400, '绘图提示词过长，请精简设计内容。')
  const path = input.refs.length ? '/v1/images/edits' : '/v1/images/generations'
  const { body: result, status } = await upstream(OPENAI_ORIGIN, path, key, {
    model: 'gpt-image-2.6-flare', prompt: input.prompt, size: openaiSizes.get(input.aspect),
    quality: 'medium', output_format: 'png', n: 1,
    ...(input.refs.length ? {
      images: input.refs.map(ref => ({ image_url: `data:${ref.mimeType};base64,${ref.data}` })),
    } : {}),
  }, signal, 300_000)
  const data = result?.data?.[0]?.b64_json
  if (!data) throw upstreamFailure('output_image_empty', status)
  try { return image({ mimeType: 'image/png', data }, 24 * 1024 * 1024) }
  catch { throw upstreamFailure('output_image_invalid', status) }
}

async function drawWithMagpie(config, input, signal, drawingId) {
  const { magpieDrawOrigin: origin, magpieDrawToken: key } = config
  if (!origin || key.length < 32) throw new RequestFailure(503, 'Magpie 绘图服务尚未启用。')
  const payload = typeof drawingId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(drawingId) ? { ...input, drawingId } : input
  const job = await upstream(origin, '/studio/draw', key, payload, signal, 20_000)
  const id = job.body?.id
  if (job.status !== 202 || typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) {
    throw upstreamFailure('magpie_job_invalid', job.status)
  }
  const deadline = Date.now() + 270_000
  while (Date.now() < deadline) {
    const result = await upstream(origin, '/studio/draw/' + id, key, undefined, signal, 20_000, 'GET')
    if (result.status !== 202) {
      try { return image(result.body, 24 * 1024 * 1024) }
      catch { throw upstreamFailure('magpie_image_invalid', result.status) }
    }
    await new Promise(resolve => setTimeout(resolve, 7_000))
    signal.throwIfAborted()
  }
  throw new RequestFailure(504, 'Magpie 绘图等待超时，请稍后重试。', { stage: 'magpie_job_timeout' })
}

export async function drawDesign(config, input, signal, drawingId) {
  if (config.imageProvider === 'magpie') return drawWithMagpie(config, input, signal, drawingId)
  if (config.imageProvider === 'openai') return drawWithOpenAI(config, input, signal)
  if (!config.imageKey || config.imageModel === 'gemini-3.5-flash') {
    throw new RequestFailure(503, '图像生成功能尚未启用，请先浏览示例方案。')
  }
  const { body: result, status } = await upstream(config.baseUrl, `/v1beta/models/${encodeURIComponent(config.imageModel)}:generateContent`, config.imageKey, {
    contents: [{ role: 'user', parts: [...input.refs.map(ref => ({ inlineData: ref })), { text: input.prompt }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: input.aspect, imageSize: '2K' } },
  }, signal, 300_000)
  const output = result?.candidates?.[0]?.content?.parts?.find(part => part.inlineData?.data)?.inlineData
  if (!output) throw upstreamFailure('output_image_empty', status)
  try { return image(output, 24 * 1024 * 1024) } catch { throw upstreamFailure('output_image_invalid', status) }
}
