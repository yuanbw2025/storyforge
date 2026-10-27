import type { FrozenRuntimeMediaAssetV2, ProductProductionBriefV3, ProductBuildArtifactRecordV1 } from '../types'
import type { ProductMediaRequestV1, ProductMediaCandidateV1 } from '../product-production/media-adapters'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { assertAvgImageRequestV1, freezeAvgImageRequestV1, type AvgImageRequestV1 } from './media-reference-contract'
import { avgRawMediaArtifactKeyV1, parseAvgVisualProductionRequirementV1, type AvgVisualProductionRequirementV1 } from './media-production-contract'
import { parseAvgExecutableStageV1 } from './stage-contract'
import { avgHash, avgKey, avgNumber, avgProtocolBody, avgRecord } from './protocol-validation'
import { assertAvgImageProductionDefinitionV3 } from './media-production-definition'
import { AVG_IMAGE_CAPABILITY_REQUIREMENT_KEY_V1 } from './assembly-plan'
import { AVG_IMAGE_REFERENCE_CAPABILITY_V1 } from './media-reference-contract'

export interface AvgRawImagePayloadV1 {
  schema: 'storyforge.avg.raw-image'
  version: 1
  batchKey: string
  batchRevision: number
  sourceInputHash: string
  requirement: AvgVisualProductionRequirementV1
  request: AvgImageRequestV1
  provider: ProductMediaCandidateV1['providerReceipt']
  rights: ProductMediaCandidateV1['rights']
  capabilityBindingHash: string
}

export function avgVisualRequestTextV1(r: AvgVisualProductionRequirementV1) {
  return { prompt: [r.prompt, ...r.invariants.map(text => `必须保持：${text}`)].join('\n'),
    negativePrompt: [r.negativePrompt, ...r.forbiddenDepictions].filter(Boolean).join('\n') }
}

export async function prepareAvgRawImageRequestV1(input: { brief: ProductProductionBriefV3; requirementKey: string; idempotencyKey: string }) {
  const { assembly, capability } = await assertAvgImageProductionDefinitionV3(input.brief)
  const batch = assembly.mediaBatch, r = batch.requirements.find(r => r.requirementKey === input.requirementKey)
  if (!r) throw new Error('[avg-media] 请求不在冻结图片批次中')
  const request: ProductMediaRequestV1 = { schema: 'storyforge.product-media-request', version: 1,
    requestId: `avg.media.${input.idempotencyKey.slice(0, 64)}`, adapterId: 'agnes.image-2.1-flash.v1', mediaClass: 'image', mediaKind: r.mediaKind,
    requirementKey: AVG_IMAGE_CAPABILITY_REQUIREMENT_KEY_V1, artifactKey: avgRawMediaArtifactKeyV1(r.requirementKey),
    ...avgVisualRequestTextV1(r), count: 1, width: r.width, height: r.height, durationMs: null,
    inputHash: await hashProductProductionValueV2({ idempotencyKey: input.idempotencyKey, batchKey: batch.batchKey,
      batchRevision: batch.revision, sourceInputHash: batch.sourceInputHash, requirement: r }),
    qualityProfile: input.brief.qualityProfile, environment: import.meta.env.MODE === 'test' ? 'test' : import.meta.env.PROD ? 'production' : 'development',
    allowedDataClasses: [...capability.allowedDataClasses], rightsPolicyVersion: capability.rightsPolicyVersion }
  return freezeAvgImageRequestV1({ request, resolutionTier: r.resolutionTier, references: r.references })
}

/** Only portable metadata lives in payload. The exact original bytes are owned
 * by the Blob row; raw HTTP evidence is retained by the Run raw-response store. */
export async function parseAvgRawImagePayloadV1(value: unknown): Promise<AvgRawImagePayloadV1> {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'batchKey', 'batchRevision', 'sourceInputHash',
    'requirement', 'request', 'provider', 'rights', 'capabilityBindingHash'], 'raw image')
  if (r.schema !== 'storyforge.avg.raw-image' || r.version !== 1) throw new Error('[avg-media] 原始图片版本无效')
  const requirement = parseAvgVisualProductionRequirementV1(r.requirement), request = await assertAvgImageRequestV1(r.request as AvgImageRequestV1)
  const provider = avgRecord(r.provider, ['providerRequestId', 'executionLocation', 'usage', 'costUsd'], 'provider receipt')
  const rights = avgRecord(r.rights, ['origin', 'adapterId', 'rightsPolicyVersion', 'commercialUse', 'requiresProviderTermsReview'], 'image rights')
  if (provider.providerRequestId !== null && typeof provider.providerRequestId !== 'string'
    || provider.executionLocation !== 'browser-direct' || provider.costUsd !== null && (typeof provider.costUsd !== 'number' || !Number.isFinite(provider.costUsd) || provider.costUsd < 0)
    || rights.origin !== 'generated' || rights.adapterId !== request.request.adapterId || rights.rightsPolicyVersion !== request.request.rightsPolicyVersion
    || typeof rights.commercialUse !== 'boolean' || rights.requiresProviderTermsReview !== true) throw new Error('[avg-media] 原图缺少准确的 provider/权利回执')
  return { schema: r.schema, version: 1, batchKey: avgKey(r.batchKey, 'batchKey'), batchRevision: avgNumber(r.batchRevision, 'batchRevision', 1, 1_000_000),
    sourceInputHash: avgHash(r.sourceInputHash, 'sourceInputHash'), requirement, request,
    provider: provider as unknown as AvgRawImagePayloadV1['provider'], rights: rights as unknown as AvgRawImagePayloadV1['rights'],
    capabilityBindingHash: avgHash(r.capabilityBindingHash, 'capabilityBindingHash') }
}

export async function assertAvgRawImageArtifactV1(brief: ProductProductionBriefV3, row: Pick<ProductBuildArtifactRecordV1,
  'artifactKey' | 'kind' | 'mediaKind' | 'payloadJson' | 'metadataJson' | 'rightsJson' | 'contentHash' | 'mimeType' | 'byteSize'>): Promise<{ payload: AvgRawImagePayloadV1; asset: FrozenRuntimeMediaAssetV2 }> {
  const { assembly, capability } = await assertAvgImageProductionDefinitionV3(brief)
  const payload = await parseAvgRawImagePayloadV1(row.payloadJson), batch = assembly.mediaBatch
  const r = batch.requirements.find(r => row.artifactKey === avgRawMediaArtifactKeyV1(r.requirementKey))
  const request = payload.request.request, text = r && avgVisualRequestTextV1(r)
  if (capability.capabilityHash !== await hashProductProductionValueV2(AVG_IMAGE_REFERENCE_CAPABILITY_V1)) throw new Error('[avg-media] 原图能力快照与当前登记的图片输入协议不一致')
  const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)
  if (!r || !same(payload.requirement, r) || payload.batchKey !== batch.batchKey || payload.batchRevision !== batch.revision || payload.sourceInputHash !== batch.sourceInputHash
    || payload.capabilityBindingHash !== assembly.imageBinding.bindingHash
    || row.kind !== 'image' || row.mediaKind !== r.mediaKind || request.artifactKey !== row.artifactKey || request.requirementKey !== capability.requirementKey
    || request.mediaKind !== r.mediaKind || request.prompt !== text!.prompt || request.negativePrompt !== text!.negativePrompt
    || request.width !== r.width || request.height !== r.height || request.qualityProfile !== brief.qualityProfile
    || request.rightsPolicyVersion !== capability.rightsPolicyVersion || !same([...request.allowedDataClasses].sort(), [...capability.allowedDataClasses].sort())
    || payload.request.resolutionTier !== r.resolutionTier || !same(payload.request.references, r.references)) throw new Error('[avg-media] 原图与准确冻结需求不一致')
  const asset = parseAvgExecutableStageV1({ version: 1, cues: [], assets: [JSON.parse(row.metadataJson)] }).assets[0]!
  if (asset.assetKey !== r.assetKey || asset.version !== 1 || asset.kind !== r.mediaKind || asset.name !== r.name || asset.altText !== r.altText
    || asset.contentHash !== row.contentHash || asset.mimeType !== row.mimeType || asset.byteSize !== row.byteSize || asset.source !== request.adapterId
    || asset.license !== `rights-policy:${capability.rightsPolicyVersion}` || asset.characterTag !== (r.mediaKind.startsWith('character-') ? r.family.subjectKey : '')
    || asset.sceneTag !== (r.consumer.sceneKey ?? '') || asset.durationMs !== null || !asset.width || !asset.height
    || !same(JSON.parse(row.rightsJson), payload.rights)) throw new Error('[avg-media] 原图元数据或权利与真实候选不一致')
  return { payload, asset }
}
