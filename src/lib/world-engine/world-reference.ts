import { hashCanonicalValue } from '../agent/run/hash'
import { db } from '../db/schema'
import type { WorldReferenceV1, WorldRelease } from '../types'
import { verifyPureWorldReleaseRecordV3 } from './release-codec'
import { assertReleaseUnchanged, worldReleaseUidV1 } from './releases'

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
  if (!release.releaseUid) {
    await db.worldReleases.update(release.id, { releaseUid: expected })
  }
  return expected
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
      schema: 'storyforge.world-package',
      version: 2,
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

export async function validateWorldReferenceV1(value: WorldReferenceV1): Promise<WorldReferenceV1> {
  if (value.schema !== 'storyforge.world-reference' || value.version !== 1 || !HASH.test(value.referenceHash)) {
    fail('contract', 'WorldReference 合同身份或 hash 非法')
  }
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

/** Rebinds only the local locator after import, preserving the portable hash. */
export async function rebindWorldReferenceV1(input: {
  reference: WorldReferenceV1
  localReleaseRecordId: number
}): Promise<WorldReferenceV1> {
  const rebound = { ...input.reference, localReleaseRecordId: input.localReleaseRecordId }
  return validateWorldReferenceV1(rebound)
}
