import { hashCanonicalValue } from '../agent/run/hash'
import type { CreationProductKindV1, CreationReleaseV1 } from '../types'

export const CREATION_RELEASE_SCHEMAS_V1 = Object.freeze({
  'short-novel': 'storyforge.short-novel-release',
  screenplay: 'storyforge.screenplay-release',
  comic: 'storyforge.comic-release',
  'motion-drama': 'storyforge.motion-drama-release',
} as const satisfies Record<CreationProductKindV1, string>)

function positiveInteger(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) > 0
}

/** Verifies the shared append-only envelope and the product manifest header/hash. */
export async function parseAndVerifyCreationReleaseManifestV1(
  release: CreationReleaseV1,
  expectedWorkCode: string,
): Promise<Record<string, any>> {
  if (!positiveInteger(release.projectId) || !positiveInteger(release.worldId) || !positiveInteger(release.workId)
    || !positiveInteger(release.version) || !positiveInteger(release.sourceRevision)
    || !Object.prototype.hasOwnProperty.call(CREATION_RELEASE_SCHEMAS_V1, release.productKind)
    || typeof release.label !== 'string' || !release.label.trim()
    || typeof release.manifestJson !== 'string'
    || !/^[a-f0-9]{64}$/i.test(release.contentHash)
    || !positiveInteger(release.createdAt)) {
    throw new Error('[creation-release] Release envelope 非法')
  }
  if (release.id != null && !positiveInteger(release.id)) throw new Error('[creation-release] Release id 非法')
  if (release.parentReleaseId != null && !positiveInteger(release.parentReleaseId)) throw new Error('[creation-release] parentReleaseId 非法')
  let manifest: Record<string, any>
  try { manifest = JSON.parse(release.manifestJson) as Record<string, any> }
  catch { throw new Error('[creation-release] manifest 不是 JSON') }
  if (!manifest || Array.isArray(manifest)
    || manifest.schema !== CREATION_RELEASE_SCHEMAS_V1[release.productKind]
    || manifest.version !== 1
    || manifest.productKind !== release.productKind
    || manifest.work?.code !== expectedWorkCode
    || await hashCanonicalValue(manifest) !== release.contentHash) {
    throw new Error('[creation-release] manifest 身份或 hash 校验失败')
  }
  return manifest
}

export function assertCreationReleaseParentV1(release: CreationReleaseV1, parent: CreationReleaseV1 | null): void {
  if (release.parentReleaseId == null) {
    if (parent != null) throw new Error('[creation-release] 无 parentReleaseId 时不得传入父发布')
    return
  }
  if (!parent || parent.id !== release.parentReleaseId
    || parent.projectId !== release.projectId || parent.worldId !== release.worldId || parent.workId !== release.workId
    || parent.productKind !== release.productKind || parent.version >= release.version) {
    throw new Error('[creation-release] 父发布越界、跨产品或版本倒置')
  }
}
