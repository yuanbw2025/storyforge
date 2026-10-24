import {db} from '../db/schema'
import {resolveScope, assertRecordInScope} from '../workspace/scope'
import {assertProductReleaseUnchanged, parseInteractionProductReleaseManifest} from '../product/releases'
import {exportProductDistributionBundleV2, importLocalProductBundleV1, verifyProductDistributionBundleV2, type ProductDistributionBundleV2} from '../product-platform/distribution-bundle'
import type {CharacterInteractionProductRuntimePackageV1, WorkspaceScope} from '../types'
import {chatReleasePreviewV1} from './release-preview'

export const CHAT_EXPERIENCE_FILE_LIMIT = 384 * 1024 * 1024
type Summary = ReturnType<typeof describe>
export interface ChatExperiencePackagePreviewV1 {
  title: string
  description: string
  bundleHash: string
  releaseHash: string
  releaseVersion: number
  summary: Summary
  existing: Array<{releaseId: number; localVersion: number; releaseHash: string; sameContent: boolean; summary: Summary | null; error: string | null}>
}
const previews = new WeakMap<ChatExperiencePackagePreviewV1, {scope: WorkspaceScope; bundle: ProductDistributionBundleV2; fingerprint: string}>()

function describe(pkg: CharacterInteractionProductRuntimePackageV1) {
  const narrative = pkg.interaction.chatNarrative, permissions = narrative?.permissions
  return {
    opening: chatReleasePreviewV1(pkg),
    experienceInfo: pkg.interaction.chatExperienceInfo ?? null,
    kind: narrative ? permissions!.mode === 'story' ? '剧情互动' : '轻松伴聊' : '普通互动',
    actors: pkg.interaction.profiles.map(profile => ({key: profile.characterKey, name: profile.name})),
    media: (pkg.presentation?.assets ?? []).map(asset => ({name: asset.name, kind: asset.kind, license: asset.license, bytes: asset.byteSize})),
    credits: pkg.interaction.chatCardCredits?.characters.map(credit => ({
      name: pkg.interaction.profiles.find(profile => profile.participantKey === credit.participantKey)!.name,
      creator: credit.creator, version: credit.characterVersion,
    })) ?? [],
    triggers: permissions?.triggers ?? [],
    maxActions: permissions?.maxActionsPerTrigger ?? 0,
    newSituations: permissions?.allowActorSituationExpansion === true,
  }
}

async function chatScope(input: WorkspaceScope) {
  const scope = await resolveScope({scope: {...input}})
  if ((await db.works.get(scope.workId))?.kind !== 'character-interaction') throw new Error('请选择角色聊天作品来安装体验包')
  return scope
}

/** Verify every byte locally, then expose only a player-safe description.
 * The hidden immutable package is retained only while this preview is alive. */
export async function previewChatExperiencePackageV1(input: {scope: WorkspaceScope; bytes: ArrayBuffer}): Promise<ChatExperiencePackagePreviewV1> {
  if (!input.bytes.byteLength || input.bytes.byteLength > CHAT_EXPERIENCE_FILE_LIMIT) throw new Error('体验包为空或超过 384 MiB')
  let value: unknown
  try {value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(input.bytes))}
  catch {throw new Error('体验包不是有效的 UTF-8 JSON 文件')}
  const scope = await chatScope(input.scope)
  const bundle = await verifyProductDistributionBundleV2(value)
  const manifest = bundle.productRelease.manifest
  const pkg = parseInteractionProductReleaseManifest(JSON.stringify(manifest))
  const releases = (await db.productReleases.where('workId').equals(scope.workId).toArray())
    .filter(row => row.productType === 'character-interaction' && row.productionKey === manifest.productionProvenance.productionKey)
    .sort((a, b) => b.version - a.version)
  const existing: ChatExperiencePackagePreviewV1['existing'] = []
  for (const row of releases) {
    if (!await assertRecordInScope(scope, 'productReleases', row, {owner: 'work'})) throw new Error('本地版本越过当前作品')
    let summary: Summary | null = null, error: string | null = null
    try {
      const verified = await assertProductReleaseUnchanged(row.id!)
      const manifest = JSON.parse(verified.manifestJson)
      if (verified.version !== manifest.lineage.releaseVersion || verified.productionKey !== manifest.productionProvenance.productionKey) {
        throw new Error('本机发行身份与冻结清单不一致')
      }
      summary = describe(parseInteractionProductReleaseManifest(verified.manifestJson))
    }
    catch {error = '这个本地版本未通过完整性检查；安装不会覆盖它或它的存档'}
    existing.push({releaseId: row.id!, localVersion: row.version, releaseHash: row.contentHash, sameContent: row.contentHash === bundle.productRelease.contentHash, summary, error})
  }
  const preview = {title: pkg.definition.title, description: pkg.definition.description, bundleHash: bundle.bundleHash,
    releaseHash: bundle.productRelease.contentHash, releaseVersion: manifest.lineage.releaseVersion, summary: describe(pkg), existing}
  previews.set(preview, {scope, bundle, fingerprint: JSON.stringify(preview)})
  return preview
}

export async function installChatExperiencePackageV1(preview: ChatExperiencePackagePreviewV1) {
  const saved = previews.get(preview)
  if (!saved || saved.fingerprint !== JSON.stringify(preview)) throw new Error('安装预览已变化，请重新选择原体验包')
  const scope = await chatScope(saved.scope)
  return importLocalProductBundleV1({scope, bundle: saved.bundle, productType: 'character-interaction'})
}

export async function exportChatExperiencePackageV1(input: {scope: WorkspaceScope; productReleaseId: number}) {
  const releaseId = input.productReleaseId, scope = await chatScope(input.scope)
  const release = await assertProductReleaseUnchanged(releaseId)
  if (!await assertRecordInScope(scope, 'productReleases', release, {owner: 'work'}) || release.productType !== 'character-interaction') {
    throw new Error('所选版本不属于当前角色聊天作品')
  }
  return exportProductDistributionBundleV2({scope, productReleaseId: releaseId})
}
