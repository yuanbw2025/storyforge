import { hashCanonicalValue } from '../agent/run/hash'
import { db } from '../db/schema'
import type { WorkspaceScope, WorldReferenceCatalogEntryV1, WorldReferenceV1, WorldRelease } from '../types'
import type { FrozenResourceScopeV1 } from '../registry/types'
import { verifyPureWorldReleaseRecordV3 } from './release-codec'
import { assertReleaseUnchanged, listWorldReleases, worldReleaseUidV1 } from './releases'

const HASH = /^[a-f0-9]{64}$/

export class WorldReferenceErrorV1 extends Error {
  constructor(readonly code: string, message: string) {
    super(`[world-reference:${code}] ${message}`)
    this.name = 'WorldReferenceErrorV1'
  }
}

function fail(code: string, message: string): never {
  throw new WorldReferenceErrorV1(code, message)
}

function referenceBody(reference: Omit<WorldReferenceV1, 'referenceHash'>): unknown {
  const { localReleaseRecordId: _localLocator, ...portable } = reference
  return portable
}

export async function ensureWorldReleaseUidV1(release: WorldRelease & { id: number }): Promise<string> {
  if (!HASH.test(release.contentHash)) fail('release-hash', 'WorldRelease contentHash 非法')
  const expected = worldReleaseUidV1({
    worldCode: release.sourceWorldCode,
    version: release.version,
    contentHash: release.contentHash,
  })
  if (release.releaseUid && release.releaseUid !== expected) {
    fail('release-uid', 'WorldRelease releaseUid 与 code/version/contentHash 不一致')
  }
  return expected
}

/**
 * Validate only the portable identity of a WorldReference. This deliberately
 * does not dereference `localReleaseRecordId`: published upper-product
 * manifests must remain verifiable after export/import and local ID remapping.
 */
export async function validatePortableWorldReferenceV1(value: WorldReferenceV1): Promise<WorldReferenceV1> {
  if (value.schema !== 'storyforge.world-reference' || value.version !== 1 || !HASH.test(value.referenceHash)) {
    fail('contract', 'WorldReference 合同身份或 hash 非法')
  }
  if (!value.worldCode.trim() || !Number.isSafeInteger(value.releaseVersion) || value.releaseVersion < 1
    || !HASH.test(value.releaseHash) || !HASH.test(value.manifestIdentity.schemaHash)
    || !HASH.test(value.capabilityIdentity.catalogHash) || !HASH.test(value.capabilityIdentity.profileHash)
    || !Number.isSafeInteger(value.localReleaseRecordId) || value.localReleaseRecordId < 0) {
    fail('portable-fields', 'WorldReference portable identity 字段非法')
  }
  if (value.manifestIdentity.schema !== 'storyforge.world-release'
    || value.manifestIdentity.version !== 3 || value.manifestIdentity.semanticContract !== 3) {
    fail('manifest-identity', 'WorldReference manifest identity 非法')
  }
  const expectedUid = worldReleaseUidV1({
    worldCode: value.worldCode,
    version: value.releaseVersion,
    contentHash: value.releaseHash,
  })
  if (value.releaseUid !== expectedUid) fail('release-uid', 'WorldReference releaseUid 与 portable identity 不一致')
  const { referenceHash, ...body } = value
  if (await hashCanonicalValue(referenceBody(body)) !== referenceHash) {
    fail('reference-hash', 'WorldReference portable hash 不匹配')
  }
  return structuredClone(value)
}

/** Remove the host-local locator before serializing a product release. */
export async function portableWorldReferenceV1(value: WorldReferenceV1): Promise<WorldReferenceV1> {
  const reference = await validatePortableWorldReferenceV1(value)
  return { ...reference, localReleaseRecordId: 0 }
}

export async function createWorldReferenceV1(localReleaseRecordId: number): Promise<WorldReferenceV1> {
  if (!Number.isSafeInteger(localReleaseRecordId) || localReleaseRecordId < 1) {
    fail('release-id', 'localReleaseRecordId 必须是正整数')
  }
  const release = await db.worldReleases.get(localReleaseRecordId)
  if (!release?.id) fail('release-missing', 'WorldRelease 不存在')
  await assertReleaseUnchanged(release.id)
  const manifest = await verifyPureWorldReleaseRecordV3(release as WorldRelease & { id: number })
  const releaseUid = await ensureWorldReleaseUidV1(release as WorldRelease & { id: number })
  const base: Omit<WorldReferenceV1, 'referenceHash'> = {
    schema: 'storyforge.world-reference',
    version: 1,
    worldCode: release.sourceWorldCode,
    releaseUid,
    releaseVersion: release.version,
    releaseHash: release.contentHash,
    localReleaseRecordId: release.id,
    manifestIdentity: {
      schema: 'storyforge.world-release',
      version: 3,
      semanticContract: 3,
      schemaHash: await hashCanonicalValue({
        schema: manifest.schema,
        version: manifest.version,
        semanticContract: manifest.semanticContract,
      }),
    },
    capabilityIdentity: {
      catalogHash: await hashCanonicalValue(manifest.resourceCatalog),
      profileHash: await hashCanonicalValue(manifest.capabilityProfile),
    },
  }
  return { ...base, referenceHash: await hashCanonicalValue(referenceBody(base)) }
}

/** The only catalog projection upper products may use to choose a world. */
export async function listWorldReferenceCatalogV1(
  scope: WorkspaceScope,
): Promise<WorldReferenceCatalogEntryV1[]> {
  const releases = await listWorldReleases(scope)
  return Promise.all(releases.map(async release => {
    if (!release.id) fail('release-id', 'WorldRelease catalog 存在无 ID 记录')
    return {
      reference: await createWorldReferenceV1(release.id),
      label: release.label,
      createdAt: release.createdAt,
    }
  }))
}

export async function validateWorldReferenceV1(value: WorldReferenceV1): Promise<WorldReferenceV1> {
  await validatePortableWorldReferenceV1(value)
  if (value.localReleaseRecordId < 1) fail('release-id', '本地执行需要已绑定的 WorldRelease locator')
  const current = await createWorldReferenceV1(value.localReleaseRecordId)
  if (current.releaseUid !== value.releaseUid
    || current.releaseHash !== value.releaseHash
    || current.worldCode !== value.worldCode
    || current.releaseVersion !== value.releaseVersion
    || current.manifestIdentity.schemaHash !== value.manifestIdentity.schemaHash
    || current.capabilityIdentity.catalogHash !== value.capabilityIdentity.catalogHash
    || current.capabilityIdentity.profileHash !== value.capabilityIdentity.profileHash
    || current.referenceHash !== value.referenceHash) {
    fail('stale-or-rebound', 'WorldReference 的 release ID/hash/schema/capability 身份不再同时匹配')
  }
  return structuredClone(value)
}

/** Resolve the host-local frozen Gateway scope behind a verified reference.
 * This physical lookup remains world-owned; upper-product contracts receive
 * only the resulting neutral resource scope. */
export async function resolveWorldReferenceResourceScopeV1(
  referenceInput: WorldReferenceV1,
): Promise<FrozenResourceScopeV1> {
  const reference = await validateWorldReferenceV1(referenceInput)
  const release = await db.worldReleases.get(reference.localReleaseRecordId)
  if (!release?.id) fail('release-missing', 'WorldReference 指向的本地 release 不存在')
  return {
    projectId: release.projectId,
    worldId: release.worldId,
    worldReleaseId: release.id,
    worldReleaseHash: release.contentHash,
  }
}

/** Rebinds only the local locator after import, preserving the portable hash. */
export async function rebindWorldReferenceV1(input: {
  reference: WorldReferenceV1
  localReleaseRecordId: number
}): Promise<WorldReferenceV1> {
  const rebound = { ...input.reference, localReleaseRecordId: input.localReleaseRecordId }
  return validateWorldReferenceV1(rebound)
}
