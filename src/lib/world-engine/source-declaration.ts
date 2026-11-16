import { sha256 } from '@noble/hashes/sha2.js'
import { canonicalStringify } from '../agent/run/hash'
import type { WorldPackageManifest, WorldSourceDeclarationV1 } from '../types/world-sharing'
import { inspectWorldPackageMetadata } from './world-package-metadata'

const SCHEMA = 'storyforge.world-source-declaration'
const HASH = /^[a-f0-9]{64}$/
type DeclarationBody = Omit<WorldSourceDeclarationV1, 'declarationHash'>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function fail(message: string): never { throw new Error(`[world-source-declaration] ${message}`) }
function hashBody(body: DeclarationBody): string {
  return Array.from(sha256(new TextEncoder().encode(canonicalStringify(body))),
    byte => byte.toString(16).padStart(2, '0')).join('')
}
function readBody(value: Record<string, unknown>): DeclarationBody {
  const { schema, version, packageVersion, packageDigest, ...manifest } = value
  if (schema !== SCHEMA || version !== 1) fail('来源声明 schema/version 无效或暂不支持')
  if (packageVersion !== 3 && packageVersion !== 4 && packageVersion !== 5) fail('原包版本无效')
  if (typeof packageDigest !== 'string' || !HASH.test(packageDigest)) fail('原包 wire 摘要无效')
  const report = inspectWorldPackageMetadata(manifest, packageVersion)
  if (!report.manifest || report.errors.length) fail(report.errors.join('；'))
  return { ...structuredClone(report.manifest), schema: SCHEMA, version: 1, packageVersion, packageDigest }
}

/** Pure encoding only. The future importer must separately verify the actual
 * package before storing this declaration; a supplied digest cannot do that. */
export function encodeWorldSourceDeclarationV1(input: {
  manifest: WorldPackageManifest
  packageVersion: 3 | 4 | 5
  packageDigest: string
}): WorldSourceDeclarationV1 {
  const metadata = inspectWorldPackageMetadata(input.manifest, input.packageVersion)
  if (!metadata.manifest || metadata.errors.length) fail(metadata.errors.join('；'))
  const body = readBody({ ...metadata.manifest, schema: SCHEMA, version: 1,
    packageVersion: input.packageVersion, packageDigest: input.packageDigest })
  return { ...body, declarationHash: hashBody(body) }
}

/** Verify exact shape and self-consistency, never licensing authority. Local
 * locators and import time are absent from the declaration's hashed body. */
export function parseWorldSourceDeclarationV1(value: unknown): WorldSourceDeclarationV1 {
  if (!isRecord(value)) fail('来源声明必须是对象')
  const { declarationHash, ...rest } = value
  if (typeof declarationHash !== 'string' || !HASH.test(declarationHash)) fail('声明摘要无效')
  const body = readBody(rest)
  if (hashBody(body) !== declarationHash) fail('来源声明摘要不匹配')
  return { ...body, declarationHash }
}

/** Legacy/absent origins remain opaque and unknown. Only an explicit new
 * declaration is checked. No result from this codec authorizes any use. */
export function inspectCommunityWorldOriginV1(value: unknown): {
  status: 'unknown' | 'self-consistent' | 'invalid'
  declaration: WorldSourceDeclarationV1 | null
  errors: string[]
} {
  if (!isRecord(value) || !['schema', 'version', 'packageVersion', 'packageDigest', 'declarationHash']
    .some(key => Object.prototype.hasOwnProperty.call(value, key))) {
    return { status: 'unknown', declaration: null, errors: [] }
  }
  try {
    const { importedAt, ...declaration } = value
    if (typeof importedAt !== 'number' || !Number.isFinite(importedAt) || importedAt <= 0) fail('导入时间无效')
    return { status: 'self-consistent', declaration: parseWorldSourceDeclarationV1(declaration), errors: [] }
  } catch (error) {
    return { status: 'invalid', declaration: null, errors: [error instanceof Error ? error.message : String(error)] }
  }
}
