import { db } from '../db/schema'
import type { ProductBuildArtifactRecordV1 } from '../types'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { readAvgChosenVoiceSourceV1, readAvgRawVoiceSourceV1, type AvgVoiceSourceValidationV1 } from './voice-choice-validation'
import { parseAvgAuthorVoiceChoice } from './audio-choice-dispatch'
import { readAvgCurrentProcessedAudioSourceV1 } from './processed-audio-consumption'

type Ref = { artifactKey: string; version: number; contentHash: string }
export interface AvgVoiceChoiceValidationV2 {
  schema: 'storyforge.avg.voice-choice-validation'; version: 2; choiceHash: string
  original: AvgVoiceSourceValidationV1
  processed: Ref; producerReceiptHash: string; recipeHash: string; processingReceiptHash: string
  sourceContextHash: string; sourceRightsHash: string; contentHash: string
  durationMs: number; channelCount: number; sourceSampleRateHz: number; sampleCount: number
}
const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)
const ref = (r: ProductBuildArtifactRecordV1): Ref => ({ artifactKey: r.artifactKey, version: r.version, contentHash: r.contentHash })

/** Current version dispatch. No original review or raw-only choice can stand
 * in for a frozen processing entry. Historical V1 readers stay independent. */
export async function readAvgChosenVoiceSource(input: Omit<Parameters<typeof readAvgChosenVoiceSourceV1>[0], 'choice'> & { choice: unknown }) {
  const frozen = structuredClone(input), choice = parseAvgAuthorVoiceChoice(frozen.choice)
  const build = await db.productBuilds.get(frozen.buildId)
  const stored = build ? await db.productProductionBriefs.where('[productionId+revision]').equals([build.productionId, build.briefRevision]).first() : null
  if (!stored) throw new Error('[avg-voice] 选择缺少准确冻结配音Brief')
  const brief = parseProductProductionBriefV3(stored.briefJson)
  const needsProcessing = brief.avgAudioProcessing?.entries.some(e => e.domain === 'voice' && e.requirementKey === choice.requirementKey) ?? false
  if (needsProcessing !== (choice.version === 2)) throw new Error('[avg-audio-process] 选择必须明确绑定本批加工版本，不能回退原音频')
  if (choice.version === 1) return { ...await readAvgChosenVoiceSourceV1({ ...frozen, choice }), processed: undefined }
  const original = await readAvgRawVoiceSourceV1({ ...frozen, raw: choice.raw })
  const selected = await readAvgCurrentProcessedAudioSourceV1({ scope: frozen.scope, buildId: frozen.buildId,
    domain: 'voice', requirementKey: choice.requirementKey, raw: choice.raw, processed: choice.processed })
  if (!same(original.raw, selected.original.row) || choice.requestIdentityHash !== original.payload.request.identityHash
    || choice.processed.recipeHash !== selected.payload.receipt.recipeHash
    || choice.processed.receiptHash !== selected.payload.receipt.receiptHash
    || !same(choice.asset, selected.asset) || !selected.row.blobObjectId) {
    throw new Error('[avg-audio-process] 加工配音选择与准确原件、配方、producer或衍生媒资不一致')
  }
  const output = selected.payload.receipt.output
  const validation: AvgVoiceChoiceValidationV2 = { schema: 'storyforge.avg.voice-choice-validation', version: 2,
    choiceHash: await hashProductProductionValueV2(choice), original: original.validation,
    processed: ref(selected.row), producerReceiptHash: selected.row.producerReceiptHash!,
    recipeHash: selected.payload.receipt.recipeHash, processingReceiptHash: selected.payload.receipt.receiptHash,
    sourceContextHash: selected.sourceContextHash, sourceRightsHash: selected.rights.sourceRightsHash,
    contentHash: selected.asset.contentHash, durationMs: output.durationMs, channelCount: output.channelCount,
    sourceSampleRateHz: output.sampleRateHz, sampleCount: output.sampleCount }
  return { ...original, asset: selected.asset, blobObjectId: selected.row.blobObjectId,
    validation, processed: selected.row }
}
