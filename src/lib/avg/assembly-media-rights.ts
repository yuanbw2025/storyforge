import type { FrozenRuntimeMediaAssetV2 } from '../types'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import type { verifyFrozenAvgAuthorInputsV1 } from './author-artifacts'

type AuthorSource = Awaited<ReturnType<typeof verifyFrozenAvgAuthorInputsV1>>

/** Deterministic receipt projection of already verified author inputs. This
 * never approves rights or substitutes an origin label for the real producer,
 * raw response, exact bytes, review/choice and stage proofs in that reader.
 * Integration and local prototype publication must use the same projection.
 */
export function avgAssemblyMediaRightsV1(source: AuthorSource, asset: FrozenRuntimeMediaAssetV2) {
  const stage = source.authorStage
  if (!stage || canonicalProductProductionJsonV2(stage.payload.stage.assets.find(a => a.assetKey === asset.assetKey) ?? null)
    !== canonicalProductProductionJsonV2(asset)) throw new Error('[avg] 媒资权利投影缺少准确的已采用演出')
  const choice = source.mediaChoices?.find(c => !c.payload.referenceOnly && c.payload.asset.assetKey === asset.assetKey)
  const voice = source.voiceChoices?.find(c => c.payload.asset.assetKey === asset.assetKey)
  const inherited = stage.payload.inheritedImages?.find(c => c.assetKey === asset.assetKey)
  const inheritedVoice = stage.payload.inheritedVoices?.find(c => c.assetKey === asset.assetKey)
  if ([choice, voice, inherited, inheritedVoice].filter(Boolean).length > 1) throw new Error('[avg] 媒资存在冲突的采用来源')
  return {
    origin: choice || voice ? 'author-selected-provider' : inherited || inheritedVoice ? 'author-inherited-provider' : 'author-import',
    license: asset.license, source: asset.source, authorStageReceipt: stage.authorReceiptHash,
    ...(inherited ? { inheritedStageSource: inherited } : {}),
    ...(inheritedVoice ? { inheritedStageVoiceSource: inheritedVoice } : {}),
    ...(choice ? { authorChoiceReceipt: choice.authorReceiptHash, rawArtifactKey: choice.raw.artifactKey,
      rawVersion: choice.raw.version, rawContentHash: choice.raw.contentHash, rawProducerReceiptHash: choice.raw.producerReceiptHash,
      ...(choice.processed ? { processedProducerReceiptHash: choice.processed.row.producerReceiptHash,
        processingReceiptHash: choice.processed.payload.receipt.receiptHash } : {}) } : {}),
    ...(voice ? { authorVoiceChoiceReceipt: voice.authorReceiptHash, audioReviewReceipt: voice.review.authorReceiptHash,
      rawVoice: { artifactKey: voice.raw.artifactKey, version: voice.raw.version, contentHash: voice.raw.contentHash },
      rawVoiceProducerReceiptHash: voice.raw.producerReceiptHash, requestIdentityHash: voice.payload.requestIdentityHash } : {}),
  }
}

/** Read-only publication proof; no frozen Build receives compilation or
 * adoption authority. Shared terminal verification and publish CAS remain
 * mandatory, including exact Artifact/author-command and physical Blob sets.
 */
export async function readAvgPrototypeMediaRightsV1(input: Parameters<typeof verifyFrozenAvgAuthorInputsV1>[0]) {
  const { verifyFrozenAvgAuthorInputsV1 } = await import('./author-artifacts')
  const source = await verifyFrozenAvgAuthorInputsV1(input)
  if (!source.authorStage) throw new Error('[avg] 本地原型缺少已采用演出')
  return new Map(source.authorStage.payload.stage.assets.map(asset => [asset.assetKey,
    canonicalProductProductionJsonV2(avgAssemblyMediaRightsV1(source, asset))]))
}
