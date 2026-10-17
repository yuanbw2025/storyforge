import { hashProductProductionValueV2 } from '../product-production/hash'
import { detectProductImageDimensionsV1, detectProductMediaMimeTypeV1 } from '../product-production/media-adapters'
import type { ProductMediaRequestV1 } from '../product-production/media-adapters'
import { sha256MediaData } from '../product-production/media-blob-store'
import { avgBoolean, avgEnum, avgHash, avgKey, avgKeys, avgList, avgNumber, avgRecord, avgText, avgUnique } from './protocol-validation'
import { parseAvgGeneratedReferenceSourceV1, type AvgGeneratedReferenceSourceV1 } from './media-generated-reference-contract'

/** AVG-only extension. V1 callers and the other products' request bytes stay unchanged. */
export const AVG_IMAGE_REFERENCE_CAPABILITY_V1 = {
  schema: 'storyforge.avg.image-reference-capability', version: 1,
  adapterId: 'agnes.image-2.1-flash.v1', model: 'agnes-image-2.1-flash',
  endpoint: '/v1/images/generations', responseMode: 'synchronous',
  referenceEncoding: 'data-uri', maximumReferences: 4, maximumReferenceBytes: 8 * 1024 * 1024,
  maximumTotalReferenceBytes: 24 * 1024 * 1024,
  purposes: ['identity', 'pose', 'composition', 'style', 'detail'],
  mimeTypes: ['image/png', 'image/jpeg', 'image/webp'], tiers: ['1K', '2K'],
  nativeCrop: false, nativeMask: false, guaranteedAlpha: false, operationLookup: false,
  source: 'https://agnes-ai.com/en/docs/agnes-image-21-flash',
} as const

export interface AvgMediaReferenceV1 {
  assetKey: string
  assetVersion: number
  contentHash: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  byteSize: number
  purpose: typeof AVG_IMAGE_REFERENCE_CAPABILITY_V1.purposes[number]
  allowedChange: string
  dataClass: string
  license: string
  providerInputAllowed: true
  derivativeUseAllowed: true
  /** Unsupported operations must be explicit; never silently discard a mask/crop. */
  crop: null
  mask: null
  generatedSource?: AvgGeneratedReferenceSourceV1
}

export interface AvgImageRequestV1 {
  schema: 'storyforge.avg.image-request'
  version: 1
  request: ProductMediaRequestV1
  resolutionTier: '1K' | '2K'
  references: AvgMediaReferenceV1[]
  capabilityHash: string
  inputHash: string
}

export function parseAvgMediaReferencesV1(value: unknown): AvgMediaReferenceV1[] {
  const capability = AVG_IMAGE_REFERENCE_CAPABILITY_V1
  const references = avgUnique(avgList(value, 'references', value => {
    const hasGeneratedSource = !!value && Object.prototype.hasOwnProperty.call(value, 'generatedSource')
    const r = avgRecord(value, ['assetKey', 'assetVersion', 'contentHash', 'mimeType', 'byteSize', 'purpose',
      'allowedChange', 'dataClass', 'license', 'providerInputAllowed', 'derivativeUseAllowed', 'crop', 'mask',
      ...(hasGeneratedSource ? ['generatedSource'] : [])], 'reference')
    if (!avgBoolean(r.providerInputAllowed, 'providerInputAllowed') || !avgBoolean(r.derivativeUseAllowed, 'derivativeUseAllowed')) {
      throw new Error('[avg-media] 参考缺少向 provider 发送及衍生使用的授权')
    }
    if (r.crop !== null || r.mask !== null) throw new Error('[avg-media] 当前能力不支持原生 crop/mask；请先生成有 lineage 的加工候选')
    const generatedSource = hasGeneratedSource ? parseAvgGeneratedReferenceSourceV1(r.generatedSource) : null
    if (generatedSource && generatedSource.raw.contentHash !== r.contentHash) throw new Error('[avg-media] 生成参考必须使用原图准确字节')
    return {
      assetKey: avgKey(r.assetKey, 'reference.assetKey'), assetVersion: avgNumber(r.assetVersion, 'reference.assetVersion', 1, 1_000_000),
      contentHash: avgHash(r.contentHash, 'reference.contentHash'), mimeType: avgEnum(r.mimeType, capability.mimeTypes, 'reference.mimeType'),
      byteSize: avgNumber(r.byteSize, 'reference.byteSize', 24, capability.maximumReferenceBytes),
      purpose: avgEnum(r.purpose, capability.purposes, 'reference.purpose'), allowedChange: avgText(r.allowedChange, 'reference.allowedChange', 2000),
      dataClass: avgKey(r.dataClass, 'reference.dataClass'), license: avgText(r.license, 'reference.license', 2000),
      providerInputAllowed: true as const, derivativeUseAllowed: true as const, crop: null, mask: null,
      ...(generatedSource ? { generatedSource } : {}),
    }
  }, capability.maximumReferences), r => r.assetKey, 'references')
  if (references.reduce((sum, r) => sum + r.byteSize, 0) > capability.maximumTotalReferenceBytes) throw new Error('[avg-media] 参考总字节超过本批上限')
  return references
}

/** Freeze everything sent, including ordered references, rights, tier and capabilities. */
export async function freezeAvgImageRequestV1(input: {
  request: ProductMediaRequestV1; resolutionTier: '1K' | '2K'; references: AvgMediaReferenceV1[]
}): Promise<AvgImageRequestV1> {
  const request = structuredClone(input.request), references = parseAvgMediaReferencesV1(input.references)
  avgRecord(request, ['schema', 'version', 'requestId', 'adapterId', 'mediaClass', 'mediaKind', 'requirementKey', 'artifactKey',
    'prompt', 'negativePrompt', 'count', 'width', 'height', 'durationMs', 'inputHash', 'qualityProfile', 'environment',
    'allowedDataClasses', 'rightsPolicyVersion'], 'image request')
  if (request.adapterId !== AVG_IMAGE_REFERENCE_CAPABILITY_V1.adapterId || request.mediaClass !== 'image'
    || request.count !== 1 || request.schema !== 'storyforge.product-media-request' || request.version !== 1) {
    throw new Error('[avg-media] 图片请求不在冻结 AVG 单图能力中')
  }
  for (const name of ['requestId', 'requirementKey', 'artifactKey', 'rightsPolicyVersion'] as const) avgKey(request[name], name)
  avgEnum(request.mediaKind, ['background', 'character-pose', 'character-expression', 'cg', 'ui'] as const, 'mediaKind')
  avgText(request.prompt, 'prompt', 20_000); avgText(request.negativePrompt, 'negativePrompt', 8000, true)
  avgHash(request.inputHash, 'request.inputHash')
  avgEnum(request.qualityProfile, ['prototype', 'internal', 'commercial-candidate'] as const, 'qualityProfile')
  avgEnum(request.environment, ['test', 'development', 'production'] as const, 'environment')
  avgKeys(request.allowedDataClasses, 'allowedDataClasses')
  if (request.durationMs !== null) throw new Error('[avg-media] 图片请求不能声明音频时长')
  avgNumber(request.width, 'width', 1, 32_768); avgNumber(request.height, 'height', 1, 32_768)
  const resolutionTier = avgEnum(input.resolutionTier, AVG_IMAGE_REFERENCE_CAPABILITY_V1.tiers, 'resolutionTier')
  if (references.some(r => !request.allowedDataClasses.includes(r.dataClass))) throw new Error('[avg-media] 参考数据类别未在请求中授权')
  const capabilityHash = await hashProductProductionValueV2(AVG_IMAGE_REFERENCE_CAPABILITY_V1)
  const body = { schema: 'storyforge.avg.image-request' as const, version: 1 as const, request, references, resolutionTier, capabilityHash }
  return { ...body, inputHash: await hashProductProductionValueV2(body) }
}

export async function assertAvgImageRequestV1(value: AvgImageRequestV1): Promise<AvgImageRequestV1> {
  const r = avgRecord(value, ['schema', 'version', 'request', 'references', 'resolutionTier', 'capabilityHash', 'inputHash'], 'AVG image request')
  const frozen = await freezeAvgImageRequestV1(value)
  if (r.schema !== frozen.schema || r.version !== frozen.version || r.capabilityHash !== frozen.capabilityHash || r.inputHash !== frozen.inputHash) {
    throw new Error('[avg-media] 请求、参考或 capability 已 stale')
  }
  return frozen
}

/** The owner-scoped resolver supplies bytes; this layer verifies the exact frozen delivery. */
export async function verifyAvgReferenceBytesV1(reference: AvgMediaReferenceV1, data: ArrayBuffer): Promise<ArrayBuffer> {
  const copy = data.slice(0)
  if (copy.byteLength !== reference.byteSize || await sha256MediaData(copy) !== reference.contentHash
    || detectProductMediaMimeTypeV1(copy) !== reference.mimeType || !detectProductImageDimensionsV1(copy)) {
    throw new Error('[avg-media] 参考字节、hash、MIME 或尺寸与冻结输入不一致')
  }
  return copy
}
