import type { AgnesReferenceImageBindingV1, ImageGenerationBindingV1 } from './capability'
import { assertGenerationAvailable } from '../showcase/policy'

const MAX_BYTES = 25 * 1024 * 1024

function decodeBase64(value: string): ArrayBuffer {
  let binary: string
  try { binary = atob(value) } catch { throw new Error('[media] provider 返回的 base64 非法') }
  if (binary.length > MAX_BYTES) throw new Error('[media] provider 图片超过 25 MiB')
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

async function download(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) throw new Error('[media] provider 返回了不安全图片 URL')
  const response = await fetch(parsed, { signal, credentials: 'omit', redirect: 'follow' })
  const finalUrl = new URL(response.url || parsed.href)
  if (finalUrl.protocol !== 'https:' && !(finalUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(finalUrl.hostname))) throw new Error('[media] provider 图片重定向到不安全地址')
  if (!response.ok) throw new Error(`[media] 下载 provider 图片失败：HTTP ${response.status}`)
  const length = Number(response.headers.get('content-length') || 0)
  if (length > MAX_BYTES) throw new Error('[media] provider 图片超过 25 MiB')
  const data = await response.arrayBuffer()
  if (data.byteLength > MAX_BYTES) throw new Error('[media] provider 图片超过 25 MiB')
  return data
}

export async function requestOpenAICompatibleImagesV1(input: {
  binding: ImageGenerationBindingV1
  prompt: string
  count: number
  width: number
  height: number
  signal?: AbortSignal
}): Promise<{ requestId: string | null; images: ArrayBuffer[] }> {
  assertGenerationAvailable()
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 4 || !input.prompt.trim() || input.prompt.length > 16_000) throw new Error('[media] 图片请求数量或 Prompt 非法')
  const response = await fetch(`${input.binding.baseUrl}/images/generations`, {
    method: 'POST', signal: input.signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.binding.apiKey}` },
    body: JSON.stringify({ model: input.binding.model, prompt: input.prompt, n: input.count, size: `${input.width}x${input.height}`, response_format: 'b64_json' }),
  })
  if (!response.ok) throw new Error(`[media] 图片 provider 调用失败：HTTP ${response.status}`)
  const json = await response.json() as { id?: string; data?: Array<{ b64_json?: string; url?: string }> }
  if (!Array.isArray(json.data) || json.data.length !== input.count) throw new Error('[media] 图片 provider 响应数量与请求不一致')
  const images: ArrayBuffer[] = []
  for (const [index, item] of json.data.entries()) {
    if (typeof item.b64_json === 'string') images.push(decodeBase64(item.b64_json))
    else if (typeof item.url === 'string') images.push(await download(item.url, input.signal))
    else throw new Error(`[media] 图片 provider 第 ${index + 1} 个候选缺少内容`)
  }
  return { requestId: typeof json.id === 'string' ? json.id : response.headers.get('x-request-id'), images }
}

/** Reference-preserving edit route. Deliberately separate from text-to-image:
 * no unsupported reference capability or automatic fallback is implied. */
export async function requestOpenAICompatibleImageEditV1(input: {
  binding: ImageGenerationBindingV1
  prompt: string
  reference: Blob
  width: number
  height: number
  signal?: AbortSignal
}): Promise<ArrayBuffer> {
  assertGenerationAvailable()
  if (input.reference.type !== 'image/png' || !input.reference.size || input.reference.size > MAX_BYTES
    || !input.prompt.trim() || input.prompt.length > 16_000
    || ![input.width, input.height].every(n => Number.isInteger(n) && n >= 256 && n <= 4096)) {
    throw new Error('[media] 地图参考图片或编辑请求无效')
  }
  const body = new FormData()
  body.append('model', input.binding.model)
  body.append('prompt', input.prompt)
  body.append('n', '1')
  body.append('size', `${input.width}x${input.height}`)
  body.append('image', input.reference, 'map-reference.png')
  const response = await fetch(`${input.binding.baseUrl}/images/edits`, {
    method: 'POST', body, signal: input.signal,
    headers: { Authorization: `Bearer ${input.binding.apiKey}` },
  })
  return readReferenceImageResponse(response, input.signal)
}

/** Agnes uses singular `image: [dataURI]` on generations, not images/edits.
 * https://agnes-ai.com/zh-Hans/docs/agnes-image-21-flash */
export async function requestAgnesReferenceImageV1(input: {
  binding: AgnesReferenceImageBindingV1
  prompt: string
  reference: Blob
  ratio: string
  signal?: AbortSignal
}): Promise<ArrayBuffer> {
  assertGenerationAvailable()
  if (input.reference.type !== 'image/png' || !input.reference.size || input.reference.size > MAX_BYTES
    || !input.prompt.trim() || input.prompt.length > 16_000
    || !['1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '21:9'].includes(input.ratio)) {
    throw Error('[media] Agnes 地图参考图或画幅无效')
  }
  const bytes = new Uint8Array(await input.reference.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  input.signal?.throwIfAborted()
  const response = await fetch(`${input.binding.baseUrl}/images/generations`, {
    method: 'POST', signal: input.signal, credentials: 'omit',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.binding.apiKey}` },
    body: JSON.stringify({ model: input.binding.model, prompt: input.prompt, size: '2K', ratio: input.ratio,
      image: ['data:image/png;base64,' + btoa(binary)], return_base64: true, extra_body: { response_format: 'b64_json' } }),
  })
  return readReferenceImageResponse(response, input.signal)
}

async function readReferenceImageResponse(response: Response, signal?: AbortSignal): Promise<ArrayBuffer> {
  if (!response.ok) throw new Error(`[media] 绘画底图生成失败：HTTP ${response.status}。未自动重试，请核对图片模型与参考图接口。`)
  const reader = response.body?.getReader()
  if (!reader) throw new Error('[media] 图片编辑响应为空')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BYTES * 1.5) { await reader.cancel(); throw new Error('[media] 图片编辑响应超过上限') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  const json = JSON.parse(new TextDecoder().decode(bytes)) as { data?: Array<{ b64_json?: string; url?: string }> }
  if (json.data?.length !== 1) throw new Error('[media] 图片编辑必须返回一个候选')
  const item = json.data[0]
  if (typeof item.b64_json === 'string') return decodeBase64(item.b64_json)
  if (typeof item.url === 'string') return download(item.url, signal)
  throw new Error('[media] 图片编辑候选缺少内容')
}
