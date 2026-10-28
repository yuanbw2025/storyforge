import { db } from '../db/schema'
import type { ProductBuildArtifactRecordV1 } from '../types'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { readAvgChosenSoundSourceV1, readAvgRawSoundSourceV1, type AvgSoundChoiceValidationV1 } from './sound-choice-validation'
import { parseAvgAuthorSoundChoice } from './audio-choice-dispatch'
import { parseAvgAuthorSoundChoiceV2 } from './processed-audio-choice-contract'
import { readAvgCurrentProcessedAudioSourceV1 } from './processed-audio-consumption'
import { readAvgFrozenProcessedSoundSourceV1 } from './processed-sound-frozen-source'

type Ref = { artifactKey: string; version: number; contentHash: string }
export interface AvgSoundChoiceValidationV2 extends Omit<AvgSoundChoiceValidationV1, 'version' | 'reviewReceiptHash'> {
  version: 2; processed: Ref; processedProducerReceiptHash: string; processingReceiptHash: string
  sourceRightsHash: string; recipeHash: string; sourceContextHash: string
}
const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)
const ref = (r: ProductBuildArtifactRecordV1): Ref => ({ artifactKey: r.artifactKey, version: r.version, contentHash: r.contentHash })

/** Explicit current choice dispatch. A frozen processing requirement cannot
 * be satisfied by an original-only choice, even when zero gain yields the
 * same physical hash. The independent producer and review remain mandatory. */
export async function readAvgChosenSoundSource(input: Omit<Parameters<typeof readAvgChosenSoundSourceV1>[0], 'choice'> & { choice: unknown }) {
  const captured = structuredClone(input), choice = parseAvgAuthorSoundChoice(captured.choice)
  const build = await db.productBuilds.get(captured.buildId)
  const stored = build ? await db.productProductionBriefs.where('[productionId+revision]').equals([build.productionId, build.briefRevision]).first() : null
  if (!stored) throw new Error('[avg-sound] 选择缺少准确冻结声音Brief')
  const brief = parseProductProductionBriefV3(stored.briefJson)
  const needsProcessing = brief.avgAudioProcessing?.entries.some(e => e.domain === 'sound' && e.requirementKey === choice.requirementKey) ?? false
  if (needsProcessing !== (choice.version === 2)) throw new Error('[avg-audio-process] 声音选择必须绑定本批加工版本，不能回退原音频')
  if (choice.version === 1) return { ...await readAvgChosenSoundSourceV1({ ...captured, choice }), processed: undefined }
  const original = await readAvgRawSoundSourceV1({ ...captured, raw: choice.raw })
  const selected = await readAvgCurrentProcessedAudioSourceV1({ scope: captured.scope, buildId: captured.buildId,
    domain: 'sound', requirementKey: choice.requirementKey, raw: choice.raw, processed: choice.processed })
  if (!same(original.raw, selected.original.row)) throw new Error('[avg-audio-process] 加工声音原件在读取期间已变化')
  return bindProcessedChoice(choice, original, selected)
}

export async function readAvgFrozenChosenSoundSourceV2(input: Omit<Parameters<typeof readAvgFrozenProcessedSoundSourceV1>[0], 'raw' | 'processed'> & { choice: unknown }) {
  const captured = structuredClone(input), choice = parseAvgAuthorSoundChoiceV2(captured.choice)
  const selected = await readAvgFrozenProcessedSoundSourceV1({ ...captured, raw: choice.raw, processed: choice.processed })
  return { ...await bindProcessedChoice(choice, selected.original, selected), processingProof: selected.processingProof }
}

async function bindProcessedChoice(choice: ReturnType<typeof parseAvgAuthorSoundChoiceV2>, original: Awaited<ReturnType<typeof readAvgRawSoundSourceV1>>,
  selected: Pick<Awaited<ReturnType<typeof readAvgCurrentProcessedAudioSourceV1>>, 'payload' | 'asset' | 'row' | 'rights' | 'sourceContextHash'>) {
  if (choice.requirementKey !== original.payload.requirement.template.requirementKey || choice.requestIdentityHash !== original.payload.requirement.identityHash
    || choice.processed.recipeHash !== selected.payload.receipt.recipeHash || choice.processed.receiptHash !== selected.payload.receipt.receiptHash
    || !same(choice.asset, selected.asset) || selected.row.blobObjectId === null) throw new Error('[avg-audio-process] 加工声音选择与原需求、配方、处理回执或衍生字节不一致')
  const validation: AvgSoundChoiceValidationV2 = { ...original.validation, schema: 'storyforge.avg.sound-choice-validation', version: 2,
    choiceHash: await hashProductProductionValueV2(choice), contentHash: selected.asset.contentHash,
    processed: ref(selected.row), processedProducerReceiptHash: selected.row.producerReceiptHash!,
    recipeHash: selected.payload.receipt.recipeHash, processingReceiptHash: selected.payload.receipt.receiptHash,
    sourceRightsHash: selected.rights.sourceRightsHash, sourceContextHash: selected.sourceContextHash }
  return { ...original, asset: selected.asset, blobObjectId: selected.row.blobObjectId, validation, processed: selected.row }
}
