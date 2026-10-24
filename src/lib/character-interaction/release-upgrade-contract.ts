import {verifyProductReleaseManifestV1} from '../product-production/runtime-package'
import {canonicalProductProductionJsonV2, hashProductProductionValueV2} from '../product-production/hash'
import type {ProductReleaseLineageV1, ProductRuntimePackageV1} from '../types'
import type {ChatExperienceInfoV1} from './experience-info'

export type ChatUpgradeBlockerV1 = 'different-product' | 'unrelated-release' | 'author-incompatible'
  | 'world-source' | 'runtime-rules' | 'narrative-rules' | 'character-knowledge' | 'scene-rules' | 'story-contract' | 'runtime-extension'
export const CHAT_UPGRADE_BLOCKER_LABELS_V1: Record<ChatUpgradeBlockerV1, string> = {
  'different-product': '两个版本必须都属于角色聊天',
  'unrelated-release': '目标版本没有直接承接原版本的发行谱系',
  'author-incompatible': '目标版本明确声明不兼容旧存档',
  'world-source': '冻结的世界来源或读取范围有变化',
  'runtime-rules': '作品身份、运行能力、初始变量或规则版本有变化',
  'narrative-rules': '冻结的剧情节点、选择或叙事规则有变化',
  'character-knowledge': '人物身份、角色资料或知识边界有变化',
  'scene-rules': '场景、参与者或互动规则有变化',
  'story-contract': '初始情境、剧情线、玩家身份或角色主动权限有变化',
  'runtime-extension': '运行合同包含其他尚未支持迁移的变化',
}
export interface ChatReleaseUpgradeCompatibilityV1 {
  schema: 'storyforge.chat-release-upgrade-compatibility'
  version: 1
  sourceReleaseHash: string
  targetReleaseHash: string
  sourcePackageHash: string
  targetPackageHash: string
  disposition: 'copy-preserving-story' | 'same-version' | 'new-session-required'
  blockers: ChatUpgradeBlockerV1[]
  changes: Array<'title' | 'description' | 'pictures' | 'release-metadata'>
  compatibilityHash: string
  /** Present only for releases carrying this optional public metadata.
   * Omission preserves historical compatibility hashes and upgrade receipts. */
  sourceExperienceInfo?: ChatExperienceInfoV1 | null
  targetExperienceInfo?: ChatExperienceInfoV1 | null
}
const same = (left: unknown, right: unknown) => canonicalProductProductionJsonV2(left ?? null) === canonicalProductProductionJsonV2(right ?? null)

function runtimeParts(pkg: ProductRuntimePackageV1) {
  const {definition, interaction, presentation, narrative, sourceWorld, ...extension} = pkg
  const {title, description, enabledCapabilities, ...definitionRules} = definition
  const {chatMedia, chatNarrative, sceneTemplates, chatExperienceInfo: _chatExperienceInfo, ...characters} = interaction!
  return {title, description, pictures: {presentation: presentation ?? null, chatMedia: chatMedia ?? null}, narrative, sourceWorld, extension,
    definitionRules: {...definitionRules, enabledCapabilities: enabledCapabilities.filter(capability => capability !== 'presentation').sort()},
    characters, sceneTemplates, chatNarrative}
}

/** Read-only compatibility evidence, never permission to change a save.
 * Both complete Releases are verified; lineage declarations alone cannot
 * authorize reinterpreting old facts or migrating unresolved model work. */
export async function compareChatReleaseUpgradeV1(sourceValue: unknown, targetValue: unknown): Promise<ChatReleaseUpgradeCompatibilityV1> {
  // Freeze both inputs before the first asynchronous hash check.
  const sourceInput = structuredClone(sourceValue), targetInput = structuredClone(targetValue)
  const source = await verifyProductReleaseManifestV1(sourceInput), target = await verifyProductReleaseManifestV1(targetInput)
  const sourceReleaseHash = await hashProductProductionValueV2(source), targetReleaseHash = await hashProductProductionValueV2(target)
  const blockers: ChatUpgradeBlockerV1[] = [], changes: ChatReleaseUpgradeCompatibilityV1['changes'] = []
  const sourceInfo = source.runtimePackage.interaction?.chatExperienceInfo
  const targetInfo = target.runtimePackage.interaction?.chatExperienceInfo
  if (source.productType !== 'character-interaction' || target.productType !== 'character-interaction') blockers.push('different-product')
  else if (sourceReleaseHash !== targetReleaseHash) {
    const from = source.lineage as ProductReleaseLineageV1, to = target.lineage as ProductReleaseLineageV1
    if (to.productInstanceKey !== from.productInstanceKey || to.releaseVersion <= from.releaseVersion
      || to.parentRelease?.releaseUid !== from.releaseUid || to.parentRelease.releaseHash !== from.releaseHash
      || source.productionProvenance.productionKey !== target.productionProvenance.productionKey) blockers.push('unrelated-release')
    if (to.compatibility.status === 'incompatible') blockers.push('author-incompatible')
    const before = runtimeParts(source.runtimePackage), after = runtimeParts(target.runtimePackage)
    if (!same(before.sourceWorld, after.sourceWorld) || from.worldReferenceHash !== to.worldReferenceHash) blockers.push('world-source')
    if (!same(before.definitionRules, after.definitionRules)) blockers.push('runtime-rules')
    if (!same(before.narrative, after.narrative)) blockers.push('narrative-rules')
    if (!same(before.characters, after.characters)) blockers.push('character-knowledge')
    if (!same(before.sceneTemplates, after.sceneTemplates)) blockers.push('scene-rules')
    if (!same(before.chatNarrative, after.chatNarrative)) blockers.push('story-contract')
    if (!same(before.extension, after.extension)) blockers.push('runtime-extension')
    if (before.title !== after.title) changes.push('title')
    if (before.description !== after.description) changes.push('description')
    if (!same(before.pictures, after.pictures)) changes.push('pictures')
    changes.push('release-metadata')
  }
  const evidence: Omit<ChatReleaseUpgradeCompatibilityV1, 'compatibilityHash'> = {
    schema: 'storyforge.chat-release-upgrade-compatibility', version: 1, sourceReleaseHash, targetReleaseHash,
    sourcePackageHash: source.packageHash, targetPackageHash: target.packageHash,
    disposition: blockers.length ? 'new-session-required' : sourceReleaseHash === targetReleaseHash ? 'same-version' : 'copy-preserving-story',
    blockers, changes,
    ...(sourceInfo || targetInfo ? {sourceExperienceInfo: sourceInfo ?? null, targetExperienceInfo: targetInfo ?? null} : {}),
  }
  return {...evidence, compatibilityHash: await hashProductProductionValueV2(evidence)}
}
