import { importProjectJSON } from '../export/json-export'
import { PROJECT_TABLES } from '../registry/project-tables'
import { db } from '../db/schema'
import Dexie from 'dexie'
import type { CommunityWorldLicense, WorldRelease, WorldReleaseManifestV3 } from '../types'
import type { WorldPackageManifest, WorldPackageUse, WorldSourceDeclarationV1 } from '../types/world-sharing'
import { encodeWorldSourceDeclarationV1 } from './source-declaration'
import { WORLD_SOURCE_WIRE_MAX_BYTES } from './source-receipt-contract'
import { inspectWorldPackageMetadata } from './world-package-metadata'
export { WORLD_PACKAGE_USES } from '../types/world-sharing'
export type { WorldPackageManifest, WorldPackageUse } from '../types/world-sharing'
export { inspectWorldPackageMetadata } from './world-package-metadata'
import type { WorldReleaseManifestV4 } from '../types/narrative-release'
import type { NarrativeIndexV1 } from '../types/narrative-index'
import { canonicalNarrativeJsonV1 } from './narrative-json'
import { generateWorldCode } from '../workspace/identity'
import { stableJson, worldReleaseUidV1 } from './releases'
import { readWorldNarrativeIndexV1 } from './narrative-index-cache'
import { resolveWorkspaceScope } from '../workspace/ownership'
import { verifyWorldReleaseManifestV1, type VerifiedWorldReleaseV1 } from './release-codec'
import { assertWorldSemanticSnapshotV1, materializeWorldReleaseBackupV1 } from './semantic-snapshot'
import { createNarrativeLineageV1 } from './narrative-lineage'
import { packNarrativeJsonV1, unpackNarrativeJsonV1, type PackedNarrativeJsonV1 } from './narrative-package-packing'
import { compressNarrativePackV1, decompressNarrativePackV1, type CompressedNarrativePackV1 } from './narrative-package-compression'

export const WORLD_PACKAGE_FORMAT = 'storyforge.world-package'
export const WORLD_PACKAGE_VERSION = 5

interface WorldPackageEnvelope {
  format: typeof WORLD_PACKAGE_FORMAT
  manifest: WorldPackageManifest
  integrity: { algorithm: 'SHA-256'; digest: string }
}
interface WorldPackageRelease<M> {
  label: string
  version: number
  contentHash: string
  manifest: M
}
export type WorldPackageV3 = WorldPackageEnvelope & {
  packageVersion: 3
  release: WorldPackageRelease<WorldReleaseManifestV3>
}
export type WorldPackageV4 = WorldPackageEnvelope & {
  packageVersion: 4
  release: WorldPackageRelease<WorldReleaseManifestV4> & { index: NarrativeIndexV1 }
}
export type WorldPackageV5 = WorldPackageEnvelope & {
  packageVersion: 5
  release: Omit<WorldPackageRelease<WorldReleaseManifestV4>, 'manifest'> & { packed: PackedNarrativeJsonV1 | CompressedNarrativePackV1 }
}
export type WorldPackage = WorldPackageV3 | WorldPackageV4 | WorldPackageV5
type WorldPackagePayload = Omit<WorldPackageV3, 'integrity'> | Omit<WorldPackageV4, 'integrity'> | Omit<WorldPackageV5, 'integrity'>
type WorldPackageDigestPayload = { format: unknown; packageVersion: unknown; manifest: unknown; release: unknown }

export interface WorldPackageTrustReport {
  valid: boolean
  importable: boolean
  manifest: WorldPackageManifest | null
  errors: string[]
  warnings: string[]
}

const WORLD_PACKAGE_MAX_BYTES = WORLD_SOURCE_WIRE_MAX_BYTES
const WORLD_PACKAGE_KEYS = new Set(['format', 'packageVersion', 'manifest', 'release', 'integrity'])
const WORLD_PACKAGE_RELEASE_KEYS_V3 = new Set(['label', 'version', 'contentHash', 'manifest'])
const WORLD_PACKAGE_RELEASE_KEYS_V4 = new Set([...WORLD_PACKAGE_RELEASE_KEYS_V3, 'index'])
const WORLD_PACKAGE_RELEASE_KEYS_V5 = new Set(['label', 'version', 'contentHash', 'packed'])
const WORLD_PACKAGE_INTEGRITY_KEYS = new Set(['algorithm', 'digest'])


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]))
}

function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

async function sha256(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('当前环境不支持分享包完整性校验。')
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function payloadForIntegrity(pkg: WorldPackageDigestPayload) {
  return {
    format: pkg.format,
    packageVersion: pkg.packageVersion,
    manifest: pkg.manifest,
    release: pkg.release,
  }
}

function packageBytes(payload: WorldPackageDigestPayload): string {
  return payload.packageVersion === 3 ? canonicalStringify(payloadForIntegrity(payload)) : canonicalNarrativeJsonV1(payloadForIntegrity(payload))
}
function detachPackage(input: unknown): unknown {
  const bytes = JSON.stringify(input)
  if (typeof bytes !== 'string' || new TextEncoder().encode(bytes).byteLength > WORLD_PACKAGE_MAX_BYTES) {
    throw new Error(`世界分享包超过 ${WORLD_PACKAGE_MAX_BYTES / 1024 / 1024} MiB 纯语义包预算或不是 JSON。`)
  }
  return JSON.parse(bytes)
}
async function expandedPackageRelease(pkg: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  if (!isRecord(pkg.release)) return null
  if (pkg.packageVersion !== 5) return pkg.release
  const packed = pkg.release.packed
  const components = unpackNarrativeJsonV1(isRecord(packed) && packed.schema === 'storyforge.narrative-pack-gzip'
    ? await decompressNarrativePackV1(packed) : packed)
  if (!isRecord(components) || Object.keys(components).length !== 2 || !('manifest' in components) || !('index' in components)) {
    throw Error('打包内容必须精确包含完整 manifest 和 index。')
  }
  return { label: pkg.release.label, version: pkg.release.version, contentHash: pkg.release.contentHash, ...components }
}

export async function createWorldPackage(
  releaseId: number,
  options: {
    authorName: string
    attribution?: string
    license: CommunityWorldLicense
    allowedUses: Record<WorldPackageUse, boolean>
    contentWarnings?: string[]
    /** Explicit test/interop choice; large v4 packages automatically use the
     * versioned lossless transport. Legacy v3 never changes its representation. */
    transport?: 'dictionary-v1'
  },
): Promise<WorldPackage> {
  options = cloneJson(options)
  const release = await db.worldReleases.get(releaseId)
  if (!release) throw new Error('发布版本不存在。')
  const verified = JSON.parse(release.manifestJson).version === 4
    ? (await readWorldNarrativeIndexV1({ projectId: release.projectId, worldId: release.worldId, releaseId })).verified
    : await verifyWorldReleaseManifestV1({ manifest: release.manifestJson, expectedContentHash: release.contentHash, expectedWorldCode: release.sourceWorldCode })
  const current = await db.worldReleases.get(releaseId)
  if (!current || canonicalStringify(current) !== canonicalStringify(release)) throw new Error('生成分享包期间发布记录已变化。')
  const { guardWorldPackageCreationV1 } = await import('./source-receipt')
  const assertSourceUnchanged = await guardWorldPackageCreationV1(release, verified)
  const releaseManifest = verified.manifest
  if (verified.version === 4 && !verified.index) throw new Error('v4 分享包必须携带已核对的完整索引。')
  if (typeof options.authorName !== 'string' || !options.authorName.trim()) throw new Error('请填写作者署名。')
  const manifest: WorldPackageManifest = {
    packageId: `${release.sourceWorldCode}@v${release.version}`,
    sourceWorldCode: release.sourceWorldCode,
    sourceWorldVersion: release.version,
    name: releaseManifest.worldName,
    description: release.label,
    authorName: options.authorName.trim(),
    attribution: options.attribution ?? `${options.authorName.trim()} · ${releaseManifest.worldName}`,
    license: options.license,
    allowedUses: { ...options.allowedUses },
    contentWarnings: options.contentWarnings ?? [],
    publishedAt: release.createdAt,
    releaseHash: release.contentHash,
  }
  const metadata = inspectWorldPackageMetadata(manifest, verified.version)
  if (metadata.errors.length) throw new Error(metadata.errors.join('；'))
  const shared = { format: WORLD_PACKAGE_FORMAT, manifest } as const
  const released = { label: release.label, version: release.version, contentHash: release.contentHash }
  let withoutIntegrity: WorldPackagePayload = verified.version === 3
    ? { ...shared, packageVersion: 3, release: { ...released, manifest: cloneJson(verified.manifest) } }
    : { ...shared, packageVersion: 4, release: { ...released, manifest: verified.manifest, index: verified.index! } }
  if (options.transport && verified.version !== 4) throw Error('字典传输只承接完整 v4 世界内容。')
  if (verified.version === 4 && (options.transport === 'dictionary-v1'
    || new TextEncoder().encode(packageBytes(withoutIntegrity)).length + 128 > WORLD_PACKAGE_MAX_BYTES)) {
    withoutIntegrity = { ...shared, packageVersion: 5, release: { ...released,
      packed: packNarrativeJsonV1({ manifest: verified.manifest, index: verified.index! }) } }
    if (new TextEncoder().encode(packageBytes(withoutIntegrity)).length + 128 > WORLD_PACKAGE_MAX_BYTES) {
      withoutIntegrity.release.packed = await compressNarrativePackV1(withoutIntegrity.release.packed as PackedNarrativeJsonV1)
    }
  }
  const pkg: WorldPackage = {
    ...withoutIntegrity,
    integrity: { algorithm: 'SHA-256', digest: await sha256(packageBytes(withoutIntegrity)) },
  }
  if (new TextEncoder().encode(canonicalStringify(pkg)).byteLength > WORLD_PACKAGE_MAX_BYTES) {
    throw new Error(`世界分享包超过 ${WORLD_PACKAGE_MAX_BYTES / 1024 / 1024} MiB 纯语义包预算。`)
  }
  await assertSourceUnchanged()
  return pkg
}

/** Read-only transport dispatch. v5 unfolds exact v4 content, then passes the
 * same complete source/projection/index checks; packing grants no trust. */
export async function inspectWorldPackage(input: unknown): Promise<WorldPackageTrustReport> {
  const errors: string[] = []
  const warnings: string[] = []
  try { input = detachPackage(input) }
  catch (error) { return { valid: false, importable: false, manifest: null, errors: [error instanceof Error ? error.message : '分享包不是完整 JSON。'], warnings } }
  if (!isRecord(input)) {
    return { valid: false, importable: false, manifest: null, errors: ['分享包必须是 JSON 对象。'], warnings }
  }
  const unknownPackageKeys = Object.keys(input).filter(key => !WORLD_PACKAGE_KEYS.has(key))
  if (unknownPackageKeys.length > 0) errors.push(`世界分享包包含未知顶层字段：${unknownPackageKeys.join('、')}。`)
  if (input.format !== WORLD_PACKAGE_FORMAT) errors.push('这不是 StoryForge 世界分享包。')
  if (![3, 4, WORLD_PACKAGE_VERSION].includes(input.packageVersion as number)) {
    errors.push(`不支持的世界分享包版本：${String(input.packageVersion)}。`)
  }

  const metadata = inspectWorldPackageMetadata(input.manifest, input.packageVersion)
  errors.push(...metadata.errors)
  const manifest = errors.length === 0 ? metadata.manifest : null

  const wireRelease = isRecord(input.release) ? input.release : null
  let release: Record<string, unknown> | null = null
  try { release = await expandedPackageRelease(input) }
  catch (error) { errors.push(error instanceof Error ? error.message : '打包内容无效。') }
  let releaseManifest: VerifiedWorldReleaseV1['manifest'] | null = null
  if (!release || typeof release.contentHash !== 'string' || typeof release.version !== 'number') {
    errors.push('世界分享包缺少冻结发布。')
  } else {
    const releaseKeys = input.packageVersion === 5 ? WORLD_PACKAGE_RELEASE_KEYS_V5
      : input.packageVersion === 4 ? WORLD_PACKAGE_RELEASE_KEYS_V4 : WORLD_PACKAGE_RELEASE_KEYS_V3
    const unknownReleaseKeys = Object.keys(wireRelease!).filter(key => !releaseKeys.has(key))
    if (Object.keys(wireRelease!).length !== releaseKeys.size || [...releaseKeys].some(key => !(key in wireRelease!))) errors.push('冻结发布字段不完整。')
    if (unknownReleaseKeys.length > 0) errors.push(`冻结发布包含未知字段：${unknownReleaseKeys.join('、')}。`)
    if (typeof release.label !== 'string' || !release.label.trim() || !Number.isInteger(release.version) || release.version < 1 || !/^[a-f0-9]{64}$/.test(release.contentHash)) {
      errors.push('冻结发布身份无效。')
    }
    try {
      const verified = await verifyWorldReleaseManifestV1({
        manifest: release.manifest,
        ...(input.packageVersion === 4 || input.packageVersion === 5 ? { index: release.index } : {}),
        expectedContentHash: release.contentHash,
        expectedWorldCode: manifest?.sourceWorldCode,
      })
      if (verified.version !== (input.packageVersion === 5 ? 4 : input.packageVersion)) throw new Error('包版本与冻结内容版本不一致。')
      releaseManifest = verified.manifest
    } catch (error) {
      errors.push(error instanceof Error ? error.message : '冻结世界发布无效。')
    }
  }

  if (manifest && release && releaseManifest) {
    if (manifest.releaseHash !== release.contentHash
      || manifest.sourceWorldVersion !== release.version
      || manifest.name !== releaseManifest.worldName) {
      errors.push('世界分享包的发布身份不一致。')
    }
    try { assertWorldSemanticSnapshotV1(releaseManifest.semanticSnapshot) }
    catch (error) { errors.push(error instanceof Error ? error.message : '世界语义快照无效。') }
  }

  const integrity = input.integrity
  if (!isRecord(integrity) || integrity.algorithm !== 'SHA-256' || typeof integrity.digest !== 'string') {
    errors.push('分享包缺少完整性校验。')
  } else if (manifest && release) {
    const unknownIntegrityKeys = Object.keys(integrity).filter(key => !WORLD_PACKAGE_INTEGRITY_KEYS.has(key))
    if (unknownIntegrityKeys.length > 0) errors.push(`完整性声明包含未知字段：${unknownIntegrityKeys.join('、')}。`)
    if (!/^[a-f0-9]{64}$/.test(integrity.digest)) errors.push('分享包完整性摘要格式无效。')
    const payload = {
      format: WORLD_PACKAGE_FORMAT,
      packageVersion: input.packageVersion,
      manifest,
      release: wireRelease,
    }
    if (await sha256(packageBytes(payload)) !== integrity.digest) {
      errors.push('分享包完整性校验失败，文件可能已被修改。')
    }
  }

  const valid = errors.length === 0
  return { valid, importable: valid, manifest, errors, warnings }
}

export interface CapturedWorldSourceWireV1 {
  readonly wireJson: string
  readonly declaration: WorldSourceDeclarationV1
  readonly verified: VerifiedWorldReleaseV1
  readonly frozenRelease: Omit<WorldRelease, 'id' | 'projectId' | 'worldId' | 'revisionId'>
}
const capturedWires = new WeakSet<CapturedWorldSourceWireV1>()
/** An in-memory preflight marker, never a portable authorization receipt. */
export function assertCapturedWorldSourceWireV1(value: CapturedWorldSourceWireV1): void {
  if (!capturedWires.has(value)) throw Error('[world-source-receipt] 必须使用真实 wire 预检结果')
}

/** Capture the actual submitted representation before unpacking. String input
 * keeps its decoded JSON text; object callers submit its JSON serialization.
 * Neither promises physical-file BOM/formatting bytes under integrity.digest. */
export async function captureWorldSourceWireV1(input: unknown): Promise<CapturedWorldSourceWireV1> {
  const wireJson = typeof input === 'string' ? input : JSON.stringify(input)
  if (typeof wireJson !== 'string' || !wireJson.length
    || new TextEncoder().encode(wireJson).byteLength > WORLD_SOURCE_WIRE_MAX_BYTES) throw Error('原 wire 缺失或超出包预算')
  const packet: unknown = JSON.parse(wireJson)
  const report = await inspectWorldPackage(packet)
  // Decoder importability is separate from editing/product permission.
  if (!report.valid || !report.importable || !report.manifest || !isRecord(packet) || !isRecord(packet.integrity)) {
    throw Error(`世界分享包预检失败：${report.errors.join('；')}`)
  }
  const release = (await expandedPackageRelease(packet))!
  const verified = await verifyWorldReleaseManifestV1({ manifest: release.manifest,
    expectedContentHash: String(release.contentHash), expectedWorldCode: report.manifest.sourceWorldCode,
    ...(packet.packageVersion === 4 || packet.packageVersion === 5 ? { index: release.index } : {}) })
  const declaration = encodeWorldSourceDeclarationV1({ manifest: report.manifest,
    packageVersion: packet.packageVersion as 3 | 4 | 5, packageDigest: String(packet.integrity.digest) })
  Object.freeze(declaration.allowedUses); Object.freeze(declaration.contentWarnings); Object.freeze(declaration)
  const frozenRelease = Object.freeze({
    releaseUid: worldReleaseUidV1({ worldCode: declaration.sourceWorldCode,
      version: Number(release.version), contentHash: String(release.contentHash) }),
    version: Number(release.version), label: String(release.label), contentHash: String(release.contentHash),
    manifestJson: verified.version === 3 ? stableJson(verified.manifest) : canonicalNarrativeJsonV1(verified.manifest),
    sourceWorldCode: declaration.sourceWorldCode, createdAt: declaration.publishedAt,
  })
  const captured = Object.freeze({ wireJson, declaration, verified, frozenRelease })
  capturedWires.add(captured)
  return captured
}

export async function importWorldPackage(input: unknown): Promise<number> {
  const captured = await captureWorldSourceWireV1(input)
  const { assertWorldPackageEditingSourceV1, installCapturedWorldSourceInTransactionV1 } = await import('./source-receipt')
  assertWorldPackageEditingSourceV1(captured)
  const verified = captured.verified, release = captured.frozenRelease, packageManifest = captured.declaration
  const releaseManifest = verified.manifest
  const sourceProject = releaseManifest.semanticSnapshot.project
  const semanticProjectKeys = [
    'workspaceUid', 'workspacePurpose', 'name', 'enableMultiWorld', 'productPlatformOptIns',
    '_activeWorldExportId', '_activeWorkExportId', 'createdAt', 'updatedAt',
  ] as const
  const project = Object.fromEntries(semanticProjectKeys
    .filter(key => Object.prototype.hasOwnProperty.call(sourceProject, key))
    .map(key => [key, sourceProject[key]])) as Record<string, unknown>
  project.workspacePurpose = 'world-engine'
  const localWorldCode = generateWorldCode()
  const lineage = verified.version === 4 ? await createNarrativeLineageV1({ source: verified.manifest.narrative,
    targetOwner: { kind: 'world', worldCode: localWorldCode, sourceWorkCode: String(verified.manifest.semanticSnapshot.works[0].code) },
    sourceWorkspaceUid: verified.manifest.sourceManifest.sourceWorkspaceUid, sourceContentHash: release.contentHash,
    sourceReleaseUid: release.releaseUid }) : null
  // The existing import transaction owns domain materialization, original R,
  // exact D receipt/binding and the immutable origin snapshot together.
  return importProjectJSON(materializeWorldReleaseBackupV1(releaseManifest, project), { finalizeInTransaction: async projectId => {
    const importedProject = await db.projects.get(projectId)
    if (!importedProject?.activeWorldId) throw Error('世界包导入后缺少当前 World 指针。')
    if (await db.worlds.where('code').equals(localWorldCode).count()) throw Error('新世界编号冲突，请重新导入。')
    await db.worlds.update(importedProject.activeWorldId, { identityKind: 'world-draft', code: localWorldCode,
      currentVersion: packageManifest.sourceWorldVersion, updatedAt: Date.now() })
    const scope = await Dexie.Promise.resolve(resolveWorkspaceScope(projectId))
    const installed = await installCapturedWorldSourceInTransactionV1(scope, captured)
    const receipt = await db.worldSourceReceipts.get(installed.receiptId)
    if (!receipt) throw Error('编辑起源回执未写入')
    await db.worlds.update(scope.worldId, { communityOrigin: { ...structuredClone(captured.declaration), importedAt: receipt.importedAt } })
    await db.worldDerivations.add({ projectId, worldId: scope.worldId,
      sourceWorkspaceUid: releaseManifest.sourceManifest.sourceWorkspaceUid,
      sourceWorkCode: String(releaseManifest.semanticSnapshot.works[0].code), sourceWorkRevision: 0,
      sourceKind: 'world-release-copy', sourceReceiptBinding: { version: 1, declarationHash: captured.declaration.declarationHash },
      sourceRevisionVectorJson: lineage
        ? canonicalNarrativeJsonV1({ version: 1, revisionVectorHash: lineage.sourceRevisionVectorHash })
        : canonicalNarrativeJsonV1(releaseManifest.sourceManifest),
      sourceRangeJson: canonicalNarrativeJsonV1({ kind: 'frozen-world-release', releaseUid: release.releaseUid }),
      selectedResourceIdsJson: canonicalNarrativeJsonV1(verified.version === 4
        ? verified.manifest.narrative.coverage.eligibleSelected : verified.manifest.sourceManifest.selectedResourceIds),
      sourceContentHash: release.contentHash, ...(lineage ? { narrativeLineageJson: canonicalNarrativeJsonV1(lineage) } : {}),
      targetRevisionId: null, targetReleaseId: null, createdAt: receipt.importedAt })
  } })
}

export function downloadWorldPackage(pkg: WorldPackage, filename: string) {
  const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export const WORLD_PACKAGE_SHAREABLE_TABLES = [
  'worlds',
  'works',
  ...PROJECT_TABLES.filter(spec => spec.worldSemantic).map(spec => spec.name),
]
