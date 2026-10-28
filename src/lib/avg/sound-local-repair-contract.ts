import type { FrozenRuntimeMediaAssetV2 } from '../types'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { avgHash, avgKey, avgNumber, avgProtocolBody, avgRecord, avgText } from './protocol-validation'
import { parseAvgGeneratedSoundSource, type AvgGeneratedSoundSource } from './stage-processed-sound-source-contract'
import { parseAvgSoundPlanningScopeV1, type AvgSoundPlanningScopeV1 } from './sound-scope-contract'
import { parseAvgSoundPlanV1, type AvgSoundPlanV1 } from './sound-plan-contract'
import { parseAvgExecutableStageV1 } from './stage-contract'
import { compileAvgSoundRequirementsV1 } from './sound-requirements'
import { parseAvgAudioProcessingRecipe, type AvgAudioProcessingRecipe } from './audio-processing-versioned-contract'

export interface AvgSoundLocalRepairParentV1 {
  productionKey: string
  buildNumber: number
  buildRevision: number
  briefHash: string
  planHash: string
  previewHash: string
  manifestHash: string
}

/** One explicitly adopted WAV in an exact parent Preview. Full original
 * scope/plan snapshots preserve the old compiled/request identity; they are
 * not this new Build's production range or copied adoption authority.
 * Recipe is relative to source.raw even when sourceAsset is an old derivative.
 * A new producer, independent review and explicit choice remain mandatory. */
export interface AvgSoundLocalRepairV1 {
  schema: 'storyforge.avg.sound-local-repair'
  version: 1
  source: AvgGeneratedSoundSource
  sourceBuildRevision: number
  sourceScope: AvgSoundPlanningScopeV1
  sourcePlan: AvgSoundPlanV1
  sourceAsset: FrozenRuntimeMediaAssetV2
  parent: AvgSoundLocalRepairParentV1
  recipe: AvgAudioProcessingRecipe
  declaration: string
}

/** Strict inert structural codec. Actual old producers, compiled bytes,
 * adoption and parent Stage membership must additionally be re-proved by the
 * governed source reader; this parser grants none of those permissions. */
export function parseAvgSoundLocalRepairV1(value: unknown): AvgSoundLocalRepairV1 {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'source', 'sourceBuildRevision', 'sourceScope',
    'sourcePlan', 'sourceAsset', 'parent', 'recipe', 'declaration'], 'local sound repair')
  if (r.schema !== 'storyforge.avg.sound-local-repair' || r.version !== 1) throw new Error('[avg-sound-repair] 局部返修合同版本无效')
  const source = parseAvgGeneratedSoundSource(r.source), sourceScope = parseAvgSoundPlanningScopeV1(r.sourceScope)
  const sourcePlan = parseAvgSoundPlanV1(r.sourcePlan), recipe = parseAvgAudioProcessingRecipe(r.recipe)
  const sourceAsset = parseAvgExecutableStageV1({ version: 1, cues: [], assets: [r.sourceAsset] }).assets[0]!
  const t = sourceScope.templates.find(t => t.requirementKey === source.requirementKey)
  const entry = sourcePlan.entries.find(e => e.requirementKey === source.requirementKey)
  if (!t || !entry || sourcePlan.entries.length !== sourceScope.templates.length
    || sourcePlan.entries.some(e => !sourceScope.templates.some(t => t.requirementKey === e.requirementKey))) {
    throw new Error('[avg-sound-repair] 须保留完整原声音范围与方案，不能裁成单项后重算请求')
  }
  const contentHash = source.version === 2 ? source.processing.contentHash : source.raw.contentHash
  if (sourceAsset.assetKey !== t.assetKey || sourceAsset.kind !== t.channel || sourceAsset.sceneTag !== t.consumer.sceneKey
    || sourceAsset.characterTag !== '' || sourceAsset.mimeType !== 'audio/wav'
    || sourceAsset.contentHash !== contentHash || sourceAsset.blobContentHash !== contentHash
    || sourceAsset.byteSize < 44 || sourceAsset.byteSize > 8 * 1024 * 1024) {
    throw new Error('[avg-sound-repair] 返修须选择准确已采用WAV声音，不能转码OGG或替换消费槽')
  }
  const durationMs = avgNumber(sourceAsset.durationMs, 'adopted sound duration', 1, 120_000, false)
  if (recipe.maximumDurationMs < durationMs) throw new Error('[avg-sound-repair] 加工时长上限短于准确已采用声音')
  if (t.source.kind === 'licensed-library') {
    const key = entry.librarySourceKey, member = sourceScope.librarySources.find(s => s.sourceKey === key)
    if (entry.prompt !== null || key === null || !t.source.allowedSourceKeys.includes(key)
      || !member || !member.memberPath.toLowerCase().endsWith('.wav') || source.raw.contentHash !== member.memberHash) {
      throw new Error('[avg-sound-repair] 所选原库成员必须是准确WAV，不能把OGG暗转为加工来源')
    }
  } else if (entry.prompt === null || entry.librarySourceKey !== null) {
    throw new Error('[avg-sound-repair] 所选原音乐必须保留准确生成说明')
  }
  const p = avgRecord(r.parent, ['productionKey', 'buildNumber', 'buildRevision', 'briefHash', 'planHash', 'previewHash', 'manifestHash'], 'sound repair parent Preview')
  const parent: AvgSoundLocalRepairParentV1 = { productionKey: avgKey(p.productionKey, 'sound repair parent production'),
    buildNumber: avgNumber(p.buildNumber, 'sound repair parent build', 1, 1e9),
    buildRevision: avgNumber(p.buildRevision, 'sound repair parent revision', 0, 1e9),
    briefHash: avgHash(p.briefHash, 'sound repair parent Brief'), planHash: avgHash(p.planHash, 'sound repair parent Plan'),
    previewHash: avgHash(p.previewHash, 'sound repair parent Preview'), manifestHash: avgHash(p.manifestHash, 'sound repair parent manifest') }
  if (parent.productionKey === source.productionKey && source.buildNumber > parent.buildNumber) {
    throw new Error('[avg-sound-repair] 原采用声音不能来自父预览之后的版本')
  }
  return { schema: r.schema, version: 1, source, sourceBuildRevision: avgNumber(r.sourceBuildRevision, 'sound repair source revision', 0, 1e9),
    sourceScope, sourcePlan, sourceAsset, parent, recipe, declaration: avgText(r.declaration, 'sound repair declaration', 2000) }
}

/** Pure identity validation, not a new compilation/adoption. Recompute only
 * the complete original payload and selected request, never a narrowed scope.
 * The caller must independently read the exact old compiled row and proof. */
export async function assertAvgSoundLocalRepairV1(value: unknown) {
  const repair = parseAvgSoundLocalRepairV1(value)
  const compiled = await compileAvgSoundRequirementsV1(repair.sourceScope, repair.sourcePlan)
  const requirement = compiled.requirements.find(r => r.template.requirementKey === repair.source.requirementKey)
  if (await hashProductProductionValueV2(compiled) !== repair.source.compiled.contentHash
    || !requirement || requirement.identityHash !== repair.source.requestIdentityHash) {
    throw new Error('[avg-sound-repair] 完整原compiled hash或所选原请求身份已变化，不能裁编或改写原请求')
  }
  return { repair, compiled, requirement }
}
