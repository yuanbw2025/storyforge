import type { AnyProductBuildPreviewManifest, ProductBuildPreviewManifestV1, ProductBuildPreviewManifestV2, ProductBuildRecordV1 } from '../types'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2, isSha256Hash } from './hash'
import { parseProductRuntimePackageV1, parseProductRuntimePackageV2, productProtocolVersion, type ProductTtrpgProtocol2ReaderV1 } from './runtime-package'
import { avgExecutableModule } from '../avg/executable-module'
import {
  createTtrpgVerifiedContentViewV1,
  verifyTtrpgFrozenContentHashesV1,
  type ProductRuntimePackageWithTtrpgV2,
} from '../ttrpg/content-version'

export type ProductBuildPreviewManifestWithTtrpgV2 =
  Omit<ProductBuildPreviewManifestV1, 'runtimePackage'> & {
    runtimePackage: ProductRuntimePackageWithTtrpgV2
  }

function fail(message: string): never {
  throw new Error(`[product-build-preview] ${message}`)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  const expected = [...keys].sort()
  const actual = Object.keys(value).sort()
  if (expected.length !== actual.length || expected.some((key, index) => key !== actual[index])) {
    fail(`${label} 字段不符合合同:${actual.join(',')}`)
  }
}

function text(value: unknown, label: string, maximum = 2_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail(`${label} 无效`)
  return value.trim().normalize('NFC')
}

function integer(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) fail(`${label} 必须是正整数`)
  return Number(value)
}

function hash(value: unknown, label: string): string {
  if (!isSha256Hash(value)) fail(`${label} 不是 SHA-256`)
  return value
}

function parseFallbackSummary(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 2_000) {
    fail('fallbackSummary 必须是有界数组')
  }
  const fallbackSummary = value.map((value, index) => text(value, `fallbackSummary[${index}]`))
  if (new Set(fallbackSummary).size !== fallbackSummary.length
    || [...fallbackSummary].sort().join('\u0000') !== fallbackSummary.join('\u0000')) {
    fail('fallbackSummary 必须唯一且排序')
  }
  return fallbackSummary
}

function previewHashBody(manifest: Omit<ProductBuildPreviewManifestWithTtrpgV2, 'previewHash'>) {
  return {
    buildManifestHash: manifest.buildManifestHash,
    packageHash: manifest.packageHash,
    mediaBindings: manifest.mediaBindings,
    fallbackSummary: manifest.fallbackSummary,
  }
}

export function parseProductBuildPreviewManifestV1(value: string | unknown): ProductBuildPreviewManifestV1
export function parseProductBuildPreviewManifestV1(
  value: string | unknown, reader: ProductTtrpgProtocol2ReaderV1,
): ProductBuildPreviewManifestWithTtrpgV2
export function parseProductBuildPreviewManifestV1(
  value: string | unknown, reader?: ProductTtrpgProtocol2ReaderV1,
): ProductBuildPreviewManifestWithTtrpgV2 {
  let raw: unknown = value
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) } catch { fail('不是合法 JSON') }
  }
  const manifest = record(raw, 'manifest')
  exactKeys(manifest, [
    'schema', 'version', 'productionKey', 'buildNumber', 'buildManifestHash', 'runtimePackage',
    'packageHash', 'mediaBindings', 'fallbackSummary', 'previewHash',
  ], 'manifest')
  if (manifest.schema !== 'storyforge.product-build-preview' || manifest.version !== 1) fail('schema/version 无效')
  if (!Array.isArray(manifest.mediaBindings) || manifest.mediaBindings.length > 10_000) {
    fail('mediaBindings 必须是有界数组')
  }
  const mediaBindings = manifest.mediaBindings.map((value, index) => {
    const binding = record(value, `mediaBindings[${index}]`)
    exactKeys(binding, ['assetKey', 'artifactKey', 'blobContentHash'], `mediaBindings[${index}]`)
    return {
      assetKey: text(binding.assetKey, `mediaBindings[${index}].assetKey`, 500),
      artifactKey: text(binding.artifactKey, `mediaBindings[${index}].artifactKey`, 500),
      blobContentHash: hash(binding.blobContentHash, `mediaBindings[${index}].blobContentHash`),
    }
  })
  const bindingKeys = mediaBindings.map(binding => `${binding.assetKey}\u0000${binding.artifactKey}`)
  if (new Set(bindingKeys).size !== bindingKeys.length
    || new Set(mediaBindings.map(binding => binding.assetKey)).size !== mediaBindings.length) {
    fail('每个 assetKey 必须且只能绑定一次')
  }
  const sortedBindings = [...mediaBindings].sort((left, right) => (
    left.assetKey.localeCompare(right.assetKey) || left.artifactKey.localeCompare(right.artifactKey)
  ))
  if (canonicalProductProductionJsonV2(sortedBindings) !== canonicalProductProductionJsonV2(mediaBindings)) {
    fail('mediaBindings 必须按 assetKey/artifactKey 排序')
  }
  const fallbackSummary = parseFallbackSummary(manifest.fallbackSummary)
  const runtimePackage = reader
    ? parseProductRuntimePackageV1(manifest.runtimePackage, reader)
    : parseProductRuntimePackageV1(manifest.runtimePackage)
  const knownAssets = new Map((runtimePackage.presentation?.assets ?? []).map(asset => [asset.assetKey, asset]))
  for (const binding of mediaBindings) {
    const asset = knownAssets.get(binding.assetKey)
    if (!asset || asset.blobContentHash !== binding.blobContentHash) {
      fail(`媒资绑定不属于 RuntimePackage 或 hash 不一致:${binding.assetKey}`)
    }
  }
  if (!runtimePackage.presentation && mediaBindings.length) fail('非演出产品不能声明媒资绑定')
  return {
    schema: 'storyforge.product-build-preview',
    version: 1,
    productionKey: text(manifest.productionKey, 'productionKey', 500),
    buildNumber: integer(manifest.buildNumber, 'buildNumber'),
    buildManifestHash: hash(manifest.buildManifestHash, 'buildManifestHash'),
    runtimePackage,
    packageHash: hash(manifest.packageHash, 'packageHash'),
    mediaBindings,
    fallbackSummary,
    previewHash: hash(manifest.previewHash, 'previewHash'),
  }
}

interface ProductBuildPreviewInputV1 {
  productionKey: string
  buildNumber: number
  buildManifestHash: string
  runtimePackage: ProductBuildPreviewManifestV1['runtimePackage']
  mediaBindings?: ProductBuildPreviewManifestV1['mediaBindings']
  fallbackSummary?: string[]
}
type ProductBuildPreviewInputWithTtrpgV2 =
  Omit<ProductBuildPreviewInputV1, 'runtimePackage'> & { runtimePackage: ProductRuntimePackageWithTtrpgV2 }

export function createProductBuildPreviewManifestV1(input: ProductBuildPreviewInputV1): Promise<ProductBuildPreviewManifestV1>
export function createProductBuildPreviewManifestV1(
  input: ProductBuildPreviewInputWithTtrpgV2, reader: ProductTtrpgProtocol2ReaderV1,
): Promise<ProductBuildPreviewManifestWithTtrpgV2>
export async function createProductBuildPreviewManifestV1(
  input: ProductBuildPreviewInputWithTtrpgV2, reader?: ProductTtrpgProtocol2ReaderV1,
): Promise<ProductBuildPreviewManifestWithTtrpgV2> {
  const runtimePackage = reader
    ? parseProductRuntimePackageV1(input.runtimePackage, reader)
    : parseProductRuntimePackageV1(input.runtimePackage)
  const body: Omit<ProductBuildPreviewManifestWithTtrpgV2, 'previewHash'> = {
    schema: 'storyforge.product-build-preview',
    version: 1,
    productionKey: input.productionKey.trim().normalize('NFC'),
    buildNumber: input.buildNumber,
    buildManifestHash: input.buildManifestHash,
    runtimePackage,
    packageHash: await hashProductProductionValueV2(runtimePackage),
    mediaBindings: [...(input.mediaBindings ?? [])].sort((left, right) => (
      left.assetKey.localeCompare(right.assetKey) || left.artifactKey.localeCompare(right.artifactKey)
    )),
    fallbackSummary: [...new Set(input.fallbackSummary ?? [])].sort(),
  }
  const manifest = {
    ...body,
    previewHash: await hashProductProductionValueV2(previewHashBody(body)),
  }
  return reader
    ? verifyProductBuildPreviewManifestV1(manifest, reader)
    : parseProductBuildPreviewManifestV1(manifest)
}

export function verifyProductBuildPreviewManifestV1(value: string | unknown): Promise<ProductBuildPreviewManifestV1>
export function verifyProductBuildPreviewManifestV1(
  value: string | unknown, reader: ProductTtrpgProtocol2ReaderV1,
): Promise<ProductBuildPreviewManifestWithTtrpgV2>
export async function verifyProductBuildPreviewManifestV1(
  value: string | unknown, reader?: ProductTtrpgProtocol2ReaderV1,
): Promise<ProductBuildPreviewManifestWithTtrpgV2> {
  const manifest = reader
    ? parseProductBuildPreviewManifestV1(value, reader)
    : parseProductBuildPreviewManifestV1(value)
  if (await hashProductProductionValueV2(manifest.runtimePackage) !== manifest.packageHash) fail('packageHash 校验失败')
  if (manifest.runtimePackage.ttrpg) {
    await verifyTtrpgFrozenContentHashesV1(manifest.runtimePackage.ttrpg)
  }
  const { previewHash: _previewHash, ...body } = manifest
  if (await hashProductProductionValueV2(previewHashBody(body)) !== manifest.previewHash) fail('previewHash 校验失败')
  return manifest
}

export function parseProductBuildPreviewManifestV2(value: string | unknown): ProductBuildPreviewManifestV2 {
  productProtocolVersion(value, 'storyforge.product-build-preview')
  const manifest = record(typeof value === 'string' ? JSON.parse(value) : value, 'manifest')
  exactKeys(manifest, [
    'schema', 'version', 'productionKey', 'buildNumber', 'buildManifestHash', 'runtimePackage',
    'packageHash', 'mediaBindings', 'fallbackSummary', 'previewHash',
  ], 'manifest V2')
  if (manifest.version !== 2) fail('schema/version 无效')
  const runtimePackage = parseProductRuntimePackageV2(manifest.runtimePackage)
  const executable = avgExecutableModule(runtimePackage)
  if (!executable && (!Array.isArray(manifest.mediaBindings) || manifest.mediaBindings.length !== 0)) fail('V2 包含未登记媒资绑定')
  const assets = executable?.stage.assets ?? []
  if (!Array.isArray(manifest.mediaBindings) || manifest.mediaBindings.length !== assets.length) fail('V2 媒资绑定未闭合')
  const mediaBindings = manifest.mediaBindings.map(value => {
    const row = record(value, 'V2 media binding')
    exactKeys(row, ['assetKey','artifactKey','blobContentHash'], 'V2 media binding')
    const binding = { assetKey: text(row.assetKey, 'assetKey', 200), artifactKey: text(row.artifactKey, 'artifactKey', 200), blobContentHash: hash(row.blobContentHash, 'blobContentHash') }
    if (!assets.some(asset => asset.assetKey === binding.assetKey && asset.blobContentHash === binding.blobContentHash)) fail('V2 媒资绑定与包不一致')
    return binding
  })
  if (new Set(mediaBindings.map(binding => binding.assetKey)).size !== mediaBindings.length
    || canonicalProductProductionJsonV2([...mediaBindings].sort((a,b) => a.assetKey.localeCompare(b.assetKey) || a.artifactKey.localeCompare(b.artifactKey))) !== canonicalProductProductionJsonV2(mediaBindings)) fail('V2 媒资绑定重复或未排序')
  return {
    schema: 'storyforge.product-build-preview', version: 2,
    productionKey: text(manifest.productionKey, 'productionKey', 500),
    buildNumber: integer(manifest.buildNumber, 'buildNumber'),
    buildManifestHash: hash(manifest.buildManifestHash, 'buildManifestHash'),
    runtimePackage,
    packageHash: hash(manifest.packageHash, 'packageHash'), mediaBindings,
    fallbackSummary: parseFallbackSummary(manifest.fallbackSummary),
    previewHash: hash(manifest.previewHash, 'previewHash'),
  }
}

export function parseProductBuildPreviewManifest(value: string | unknown, reader?: ProductTtrpgProtocol2ReaderV1): AnyProductBuildPreviewManifest {
  return productProtocolVersion(value, 'storyforge.product-build-preview') === 1
    ? (reader ? parseProductBuildPreviewManifestV1(value, reader) : parseProductBuildPreviewManifestV1(value)) : parseProductBuildPreviewManifestV2(value)
}

export async function createProductBuildPreviewManifestV2(input: {
  productionKey: string
  buildNumber: number
  buildManifestHash: string
  runtimePackage: ProductBuildPreviewManifestV2['runtimePackage']
  fallbackSummary?: string[]
  mediaBindings?: ProductBuildPreviewManifestV2['mediaBindings']
}): Promise<ProductBuildPreviewManifestV2> {
  const runtimePackage = parseProductRuntimePackageV2(input.runtimePackage)
  const body: Omit<ProductBuildPreviewManifestV2, 'previewHash'> = {
    schema: 'storyforge.product-build-preview', version: 2,
    productionKey: input.productionKey.trim().normalize('NFC'), buildNumber: input.buildNumber,
    buildManifestHash: input.buildManifestHash, runtimePackage,
    packageHash: await hashProductProductionValueV2(runtimePackage), mediaBindings: [...(input.mediaBindings ?? [])].sort((a,b) => a.assetKey.localeCompare(b.assetKey) || a.artifactKey.localeCompare(b.artifactKey)),
    fallbackSummary: [...new Set(input.fallbackSummary ?? [])].sort(),
  }
  return parseProductBuildPreviewManifestV2({ ...body, previewHash: await hashProductProductionValueV2(body) })
}

export async function verifyProductBuildPreviewManifestV2(value: string | unknown): Promise<ProductBuildPreviewManifestV2> {
  const manifest = parseProductBuildPreviewManifestV2(value)
  if (await hashProductProductionValueV2(manifest.runtimePackage) !== manifest.packageHash) fail('packageHash 校验失败')
  const { previewHash: _previewHash, ...body } = manifest
  if (await hashProductProductionValueV2(body) !== manifest.previewHash) fail('previewHash 校验失败')
  return manifest
}

export async function verifyProductBuildPreviewManifest(value: string | unknown, reader?: ProductTtrpgProtocol2ReaderV1): Promise<AnyProductBuildPreviewManifest> {
  return productProtocolVersion(value, 'storyforge.product-build-preview') === 1
    ? (reader ? verifyProductBuildPreviewManifestV1(value, reader) : verifyProductBuildPreviewManifestV1(value)) : verifyProductBuildPreviewManifestV2(value)
}

/** Verify a persisted preview without changing its JSON bytes. Legacy backup
 * placeholders ({}, {version: 1}) remain opaque; neither is a runtime source.
 * Any full or newer envelope must pass strict version dispatch. */
export async function verifyStoredProductBuildPreview(build: Pick<ProductBuildRecordV1,
  'previewManifestJson' | 'previewHash' | 'packageHash' | 'manifestHash' | 'buildNumber'>, reader?: ProductTtrpgProtocol2ReaderV1,
): Promise<AnyProductBuildPreviewManifest | null> {
  let raw: unknown
  try { raw = JSON.parse(build.previewManifestJson) } catch { fail('Build Preview 不是合法 JSON') }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const keys = Object.keys(raw)
    if (keys.length === 0 || (keys.length === 1 && keys[0] === 'version'
      && (raw as Record<string, unknown>).version === 1)) return null
  }
  const preview = await verifyProductBuildPreviewManifest(raw, reader)
  if (preview.previewHash !== build.previewHash || preview.packageHash !== build.packageHash
    || preview.buildManifestHash !== build.manifestHash || preview.buildNumber !== build.buildNumber) {
    fail('Build Preview 指针或 hash 不一致')
  }
  return preview
}
export async function verifyProductBuildPreviewRuntimeViewV1(
  value: string | unknown,
  reader: ProductTtrpgProtocol2ReaderV1,
) {
  const rawManifest = await verifyProductBuildPreviewManifestV1(value, reader)
  const rawRuntimePackage = rawManifest.runtimePackage
  return {
    rawManifest,
    rawRuntimePackage,
    validatedHashes: {
      previewHash: rawManifest.previewHash,
      packageHash: rawManifest.packageHash,
      ruleContentHash: rawRuntimePackage.ttrpg?.rulePack.contentHash ?? null,
    },
    runtimeView: rawRuntimePackage.ttrpg
      ? await createTtrpgVerifiedContentViewV1(rawRuntimePackage.ttrpg)
      : null,
  }
}
