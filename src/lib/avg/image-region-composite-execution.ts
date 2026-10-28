import { db } from '../db/schema'
import type { FrozenRuntimeMediaAssetV2 } from '../types'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { putMediaBlobObject } from '../product-production/media-blob-store'
import type { executeAvgBoundedImageProcessingV1 } from './image-processing-execution-kernel'
import { readAvgRegionCompositeInputsV1 } from './image-region-composite-source'
import { runAvgRegionCompositeWorkersV1 } from './image-region-composite-worker-client'
import { parseAvgProcessedImagePayloadV3, avgRegionCompositeRightsV3 } from './image-processing-contract-v3'

/** Called only after the exact V5 task/registered context/claim is proved.
 * It re-reads both actual sources after independent background verification;
 * sealed producer admission and lease/CAS remain the shared Harness owner. */
export async function executeAvgBoundedRegionCompositionV3(input: Parameters<typeof executeAvgBoundedImageProcessingV1>[0]) {
  const { request, entry, raw, task } = input
  if (entry.recipe.version !== 3 || request.signal.aborted || request.capabilityBindings.length || request.attempt !== 1 || request.authorDraftJson) throw new Error('[avg-composite] 双输入零调用领取不成立')
  const build = await db.productBuilds.get(request.buildId)
  const stored = build && await db.productProductionBriefs.where('[productionId+revision]').equals([build.productionId, build.briefRevision]).first()
  if (!build || !stored || build.controlEpoch !== request.controlEpoch || build.id !== raw.row.buildId) throw new Error('[avg-composite] 双输入加工缺少准确 Build 边界')
  const brief = parseProductProductionBriefV3(stored.briefJson), v = brief.avgVisualPlanning
  const frozen = v?.imageProcessing?.entries.find(e => e.requirementKey === entry.requirementKey)
  if (v?.version !== 5 || canonicalProductProductionJsonV2(frozen) !== canonicalProductProductionJsonV2(entry)
    || task.kind !== 'avg-media-image-process' || task.executionMode !== 'deterministic' || task.contextProfile !== 'avg-visual-planning-v5'
    || task.budgetReservation.modelCalls !== 0 || task.budgetReservation.mediaCalls !== 0 || task.budgetReservation.maximumCostUsd !== 0) throw new Error('[avg-composite] 双输入配方未在准确 V5 方案与零调用任务中冻结')
  const sourceRead = { scope: request.scope, recipe: entry.recipe,
    raw: { buildId: request.buildId, artifactKey: raw.row.artifactKey, version: raw.row.version, contentHash: raw.row.contentHash },
    source: { mode: 'current' as const, brief } }
  const source = await readAvgRegionCompositeInputsV1(sourceRead), result = await runAvgRegionCompositeWorkersV1({ ...source.input, signal: request.signal })
  await input.recheck()
  const fresh = await readAvgRegionCompositeInputsV1(sourceRead)
  if (request.signal.aborted || canonicalProductProductionJsonV2(source.evidence) !== canonicalProductProductionJsonV2(fresh.evidence)) throw new Error('[avg-composite] 计算后两来源或运行边界改变，结果已丢弃')
  if (input.requirement.alpha === 'required' && !result.receipt.output.hasAlpha) throw new Error('[avg-composite] 底图未满足冻结透明要求')
  const payload = await parseAvgProcessedImagePayloadV3({ schema: 'storyforge.avg.processed-image', version: 3,
    requirementKey: entry.requirementKey, raw: { artifactKey: raw.row.artifactKey, version: raw.row.version, contentHash: raw.row.contentHash, producerReceiptHash: raw.row.producerReceiptHash },
    sourceAsset: raw.asset, recipe: entry.recipe, receipt: result.receipt, inputEvidence: source.evidence })
  if (request.signal.aborted) throw new Error('[avg-composite] 已停止，未接收合成字节')
  const output = await putMediaBlobObject({ scope: request.scope, data: result.data, mimeType: 'image/png', expectedContentHash: result.receipt.output.contentHash })
  const asset: FrozenRuntimeMediaAssetV2 = { ...raw.asset, version: raw.asset.version + 1, contentHash: output.contentHash, blobContentHash: output.contentHash,
    mimeType: 'image/png', byteSize: output.byteSize, width: entry.recipe.width, height: entry.recipe.height, source: result.receipt.processor }
  const artifact = { artifactKey: task.outputArtifactKeys[0], requirementKey: null, kind: 'image' as const, mediaKind: raw.asset.kind, payload, metadata: asset,
    contentHash: output.contentHash, blobObjectId: output.id!, mimeType: 'image/png', byteSize: output.byteSize,
    quality: { ...input.quality(result.receipt.receiptHash), version: 3, inputProof: result.receipt.inputProof }, rights: avgRegionCompositeRightsV3(payload) }
  return { artifacts: [artifact], passedGateIds: [...task.acceptanceGateIds], usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0, mediaCalls: 0, costUsd: 0,
    durationMs: Date.now() - input.started, storageBytes: output.byteSize + new TextEncoder().encode(canonicalProductProductionJsonV2(artifact)).byteLength } }
}
