import type { FrozenRuntimeMediaAssetV2 } from '../types'
import type { AvgSceneScriptV1 } from './artifact-contract'
import type { AvgReadingPlanV1 } from './reading-contract'
import type { AvgVoiceRequirementV1 } from './voice-production-contract'
import { canonicalStringify } from '../agent/run/hash'
import { avgHash, avgKey, avgList, avgNumber, avgRecord, avgText, avgUnique } from './protocol-validation'
import { avgRawVoiceArtifactKeyV1, avgVoiceChoiceArtifactKeyV1, avgVoiceReviewArtifactKeyV1 } from './voice-assembly-contract'
import { parseAvgRetainedVoiceProofV1, type AvgRetainedVoiceProofV1 } from './voice-recovery-contract'

type AdoptedReference = { artifactKey: string; version: number; contentHash: string; authorReceiptHash: string }

/** Portable original producer and author locators. Parsing these fields grants
 * no adoption, playback, regeneration or historical execution authority. */
export interface AvgGeneratedVoiceSourceV1 {
  schema: 'storyforge.avg.generated-voice-source'
  version: 1
  productionKey: string
  requirementKey: string
  requestIdentityHash: string
  raw: AvgRetainedVoiceProofV1
  review: AdoptedReference
  choice: AdoptedReference
}

export interface AvgInheritedStageVoiceV1 {
  assetKey: string
  source: AvgGeneratedVoiceSourceV1
  declaration: string
}

export function parseAvgGeneratedVoiceSourceV1(value: unknown): AvgGeneratedVoiceSourceV1 {
  const r = avgRecord(value, ['schema', 'version', 'productionKey', 'requirementKey', 'requestIdentityHash', 'raw', 'review', 'choice'], 'generated voice source')
  if (r.schema !== 'storyforge.avg.generated-voice-source' || r.version !== 1) throw new Error('[avg-voice] 已采用配音来源版本无效')
  const requirementKey = avgKey(r.requirementKey, 'voice source requirement'), raw = parseAvgRetainedVoiceProofV1(r.raw)
  const adopted = (value: unknown, artifactKey: string): AdoptedReference => {
    const row = avgRecord(value, ['artifactKey', 'version', 'contentHash', 'authorReceiptHash'], 'adopted voice reference')
    if (row.artifactKey !== artifactKey) throw new Error('[avg-voice] 配音来源必须绑定同一需求的准确审听和采用任务')
    return { artifactKey, version: avgNumber(row.version, 'voice source artifact version', 1, 1e9),
      contentHash: avgHash(row.contentHash, 'voice source artifact hash'), authorReceiptHash: avgHash(row.authorReceiptHash, 'voice source author receipt') }
  }
  if (raw.artifactKey !== avgRawVoiceArtifactKeyV1(requirementKey) || raw.taskKey !== `avg.voice.generate.${requirementKey}`) {
    throw new Error('[avg-voice] 配音来源的 producer 与需求不一致')
  }
  return { schema: r.schema, version: 1, productionKey: avgKey(r.productionKey, 'voice source production'), requirementKey,
    requestIdentityHash: avgHash(r.requestIdentityHash, 'voice source request identity'), raw,
    review: adopted(r.review, avgVoiceReviewArtifactKeyV1(requirementKey)), choice: adopted(r.choice, avgVoiceChoiceArtifactKeyV1(requirementKey)) }
}

/** Optional stage extension. Absent fields preserve the old stage bytes/hash;
 * the real source reader must still prove every supplied receipt and Blob. */
export function parseAvgInheritedStageVoicesV1(value: unknown, assets: FrozenRuntimeMediaAssetV2[]): AvgInheritedStageVoiceV1[] {
  return avgUnique(avgList(value, 'inheritedVoices', value => {
    const row = avgRecord(value, ['assetKey', 'source', 'declaration'], 'inherited stage voice')
    const assetKey = avgKey(row.assetKey, 'inherited voice asset'), source = parseAvgGeneratedVoiceSourceV1(row.source)
    const asset = assets.find(asset => asset.assetKey === assetKey)
    if (asset?.kind !== 'voice' || asset.mimeType !== 'audio/wav' || asset.contentHash !== source.raw.contentHash
      || asset.blobContentHash !== source.raw.contentHash) throw new Error('[avg-voice] 配音沿用须绑定目录中准确的原音频字节')
    return { assetKey, source, declaration: avgText(row.declaration, 'inherited voice declaration', 2000) }
  }, 128), row => row.assetKey, 'inherited stage voices')
}

/** Pure target check after historical authority has been proved. Unchanged
 * lines may survive unrelated script edits; words, speaker, scene, locale and
 * the one exact reading consumer cannot be silently retargeted. */
export function assertAvgInheritedVoiceBindingV1(input: {
  asset: FrozenRuntimeMediaAssetV2
  requirement: AvgVoiceRequirementV1
  scripts: AvgSceneScriptV1[]
  reading: AvgReadingPlanV1 | undefined
}) {
  const { asset, requirement: r, reading } = input
  const script = input.scripts.find(script => script.sceneKey === r.sceneKey)
  const matches = script?.lines.filter(line => line.lineKey === r.lineKey) ?? []
  const expected = { lineKey: r.lineKey, assetKey: r.assetKey, text: r.text, textRevision: r.textRevision, speakerKey: r.speakerKey, locale: r.locale }
  const bindings = reading?.voices.filter(voice => voice.lineKey === r.lineKey || voice.assetKey === asset.assetKey) ?? []
  if (asset.assetKey !== r.assetKey || asset.kind !== 'voice' || asset.mimeType !== 'audio/wav'
    || asset.characterTag !== (r.speakerKey ?? '') || asset.sceneTag !== r.sceneKey
    || matches.length !== 1 || matches[0].text !== r.text || matches[0].speakerKey !== r.speakerKey
    || !reading || asset.durationMs === null || asset.durationMs >= reading.maximumVoiceWaitMs
    || bindings.length !== 1 || canonicalStringify(bindings[0]) !== canonicalStringify(expected)) {
    throw new Error('[avg-voice] 旧配音的原句、说话人、场景或逐句阅读绑定已变化，请明确重配或移除旧绑定')
  }
}
