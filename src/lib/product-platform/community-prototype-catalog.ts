import type { ProductionProductKindV1 } from '../types'

export interface CommunityPrototypeCatalogEntryV1 {
  prototypeId: string
  productType: ProductionProductKindV1
  title: string
  summary: string
  version: string
  language: string
  maturity: 'community-prototype'
  releasePath: string
  heroPath: string
  galleryPaths: string[]
  featureHighlights: string[]
  contentWarnings: string[]
}

export interface CommunityPrototypeCatalogV1 {
  schema: 'storyforge.community-prototype-catalog'
  version: 1
  prototypes: CommunityPrototypeCatalogEntryV1[]
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const PRODUCT_TYPES = new Set<ProductionProductKindV1>([
  'ttrpg', 'character-interaction', 'ai-town', 'text-adventure', 'avg', 'text-open-world',
])

const DEFAULT_FETCHER: typeof fetch = (input, init) => globalThis.fetch(input, init)

export function resolveCommunityPrototypePublicPathV1(
  canonicalPath: string,
  basePath = import.meta.env.BASE_URL?.trim() || '/',
): string {
  if (!canonicalPath.startsWith('/prototypes/')) fail('原型公共路径必须位于 /prototypes/ 下')
  if (basePath === '/' || canonicalPath.startsWith(`${basePath.replace(/\/$/, '')}/`)) return canonicalPath
  if (!basePath.startsWith('/') || !basePath.endsWith('/') || basePath.includes('..')) fail('应用 BASE_URL 无效')
  return `${basePath.replace(/\/$/, '')}${canonicalPath}`
}

function fail(message: string): never {
  throw new Error(`[community-prototype-catalog] ${message}`)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}

function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} 字段不符合严格合同`)
  }
}

function strings(value: unknown, label: string, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum
    || value.some(item => typeof item !== 'string' || !item.trim() || item.length > 500)) {
    fail(`${label} 无效`)
  }
  const result = value.map(item => String(item).trim().normalize('NFC'))
  if (new Set(result).size !== result.length) fail(`${label} 不能重复`)
  return result
}

function sameOriginPath(value: unknown, label: string, extension: '.json' | '.png', pageOrigin: string): string {
  if (typeof value !== 'string' || value.length > 500) fail(`${label} 无效`)
  let base: URL
  let url: URL
  try {
    base = new URL(pageOrigin)
    url = new URL(value, base)
  } catch { fail(`${label} URL 无效`) }
  if (url.origin !== base.origin || url.username || url.password || url.search || url.hash
    || !url.pathname.startsWith('/prototypes/') || !url.pathname.endsWith(extension)
    || url.pathname.includes('/../')) fail(`${label} 必须是 /prototypes/ 下的同源 ${extension} 文件`)
  return url.pathname
}

export function parseCommunityPrototypeCatalogV1(
  value: unknown,
  pageOrigin = globalThis.location?.origin || 'http://localhost',
): CommunityPrototypeCatalogV1 {
  const root = record(value, '原型目录')
  exact(root, ['schema', 'version', 'prototypes'], '原型目录')
  if (root.schema !== 'storyforge.community-prototype-catalog' || root.version !== 1
    || !Array.isArray(root.prototypes) || root.prototypes.length > 100) fail('原型目录无效')
  const prototypes = root.prototypes.map((raw, index) => {
    const item = record(raw, `prototypes[${index}]`)
    exact(item, [
      'prototypeId', 'productType', 'title', 'summary', 'version', 'language', 'maturity',
      'releasePath', 'heroPath', 'galleryPaths', 'featureHighlights', 'contentWarnings',
    ], `prototypes[${index}]`)
    if (!SAFE_ID.test(String(item.prototypeId ?? ''))
      || !PRODUCT_TYPES.has(item.productType as ProductionProductKindV1)
      || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 200
      || typeof item.summary !== 'string' || !item.summary.trim() || item.summary.length > 2_000
      || typeof item.version !== 'string' || !SAFE_ID.test(item.version)
      || typeof item.language !== 'string' || !/^[a-z]{2}(?:-[A-Z]{2})?$/.test(item.language)
      || item.maturity !== 'community-prototype') fail(`prototypes[${index}] 元数据无效`)
    return {
      prototypeId: String(item.prototypeId),
      productType: item.productType as ProductionProductKindV1,
      title: item.title.trim().normalize('NFC'),
      summary: item.summary.trim().normalize('NFC'),
      version: item.version,
      language: item.language,
      maturity: 'community-prototype' as const,
      releasePath: sameOriginPath(item.releasePath, `prototypes[${index}].releasePath`, '.json', pageOrigin),
      heroPath: sameOriginPath(item.heroPath, `prototypes[${index}].heroPath`, '.png', pageOrigin),
      galleryPaths: strings(item.galleryPaths, `prototypes[${index}].galleryPaths`, 12)
        .map((path, imageIndex) => sameOriginPath(path, `prototypes[${index}].galleryPaths[${imageIndex}]`, '.png', pageOrigin)),
      featureHighlights: strings(item.featureHighlights, `prototypes[${index}].featureHighlights`, 12),
      contentWarnings: strings(item.contentWarnings, `prototypes[${index}].contentWarnings`, 20),
    }
  })
  if (new Set(prototypes.map(item => item.prototypeId)).size !== prototypes.length) fail('prototypeId 重复')
  return { schema: 'storyforge.community-prototype-catalog', version: 1, prototypes }
}

async function boundedJson(response: Response, maximumBytes: number, label: string): Promise<unknown> {
  if (!response.ok) fail(`${label} 读取失败:${response.status}`)
  const declared = response.headers.get('content-length')
  if (declared != null && (!Number.isInteger(Number(declared)) || Number(declared) > maximumBytes)) {
    fail(`${label} 大小声明无效`)
  }
  const text = await response.text()
  if (new TextEncoder().encode(text).byteLength > maximumBytes) fail(`${label} 超过大小上限`)
  try { return JSON.parse(text) } catch { fail(`${label} 不是合法 JSON`) }
}

export async function loadCommunityPrototypeCatalogV1(input: {
  catalogPath?: string
  fetcher?: typeof fetch
  pageOrigin?: string
  basePath?: string
  signal?: AbortSignal
} = {}): Promise<CommunityPrototypeCatalogV1> {
  const pageOrigin = input.pageOrigin ?? globalThis.location?.origin ?? 'http://localhost'
  const catalogPath = sameOriginPath(input.catalogPath ?? '/prototypes/catalog.json', '原型目录路径', '.json', pageOrigin)
  const publicPath = resolveCommunityPrototypePublicPathV1(catalogPath, input.basePath)
  const value = await boundedJson(await (input.fetcher ?? DEFAULT_FETCHER)(new URL(publicPath, pageOrigin), {
    method: 'GET', credentials: 'omit', mode: 'same-origin', redirect: 'error', cache: 'no-store',
    referrerPolicy: 'no-referrer', signal: input.signal,
  }), 512 * 1024, '原型目录')
  return parseCommunityPrototypeCatalogV1(value, pageOrigin)
}

export async function loadCommunityPrototypeReleaseBundleV1(input: {
  entry: CommunityPrototypeCatalogEntryV1
  fetcher?: typeof fetch
  pageOrigin?: string
  basePath?: string
  signal?: AbortSignal
}): Promise<unknown> {
  const pageOrigin = input.pageOrigin ?? globalThis.location?.origin ?? 'http://localhost'
  const path = sameOriginPath(input.entry.releasePath, '原型发行包路径', '.json', pageOrigin)
  const publicPath = resolveCommunityPrototypePublicPathV1(path, input.basePath)
  return boundedJson(await (input.fetcher ?? DEFAULT_FETCHER)(new URL(publicPath, pageOrigin), {
    method: 'GET', credentials: 'omit', mode: 'same-origin', redirect: 'error', cache: 'no-store',
    referrerPolicy: 'no-referrer', signal: input.signal,
  }), 256 * 1024 * 1024, '原型发行包')
}
