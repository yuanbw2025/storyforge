import {
  agnesImage21FlashAdapterV1,
  type MediaProviderTransportV1, type ProductMediaProviderAdapterV1, type ProductMediaRequestV1,
} from '../product-production/media-adapters'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { ProductProductionResultUnknownErrorV1 } from '../product-production/scheduler'
import {
  assertAvgImageRequestV1, verifyAvgReferenceBytesV1,
  type AvgImageRequestV1, type AvgMediaReferenceV1,
} from './media-reference-contract'

/** No published image operation lookup exists in this capability. Retain the
 * observed ID and reservation; the shared Harness must never repeat the POST. */
export class AvgImageOperationUnknownErrorV1 extends ProductProductionResultUnknownErrorV1 {
  constructor(readonly operationId: string | null) {
    super()
    this.name = 'AvgImageOperationUnknownErrorV1'
    this.message = `[avg-media] provider-result-unknown${operationId ? `; operation:${operationId}` : ''}; 当前图片能力无查询协议，禁止自动重发`
  }
}

function dataUri(mimeType: string, data: ArrayBuffer): string {
  const bytes = new Uint8Array(data)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 16_384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384))
  return `data:${mimeType};base64,${btoa(binary)}`
}

/** Product-specific input preparation around the existing provider and transport.
 * The caller is a durable production executor, never a component or a second gateway. */
export async function createAvgReferenceImageAdapterV1(input: {
  frozen: AvgImageRequestV1
  readReference(reference: AvgMediaReferenceV1): Promise<ArrayBuffer>
}): Promise<ProductMediaProviderAdapterV1> {
  const frozen = await assertAvgImageRequestV1(input.frozen)
  const expectedRequest: ProductMediaRequestV1 = { ...frozen.request, inputHash: frozen.inputHash }
  const assertRequest = (request: ProductMediaRequestV1) => {
    if (canonicalProductProductionJsonV2(request) !== canonicalProductProductionJsonV2(expectedRequest)) {
      throw new Error('[avg-media] 执行请求与冻结的参考输入不一致')
    }
  }
  const lineage = {
    schema: 'storyforge.avg.reference-transmission', version: 1,
    inputHash: frozen.inputHash, capabilityHash: frozen.capabilityHash, resolutionTier: frozen.resolutionTier,
    references: frozen.references.map((r, index) => ({ ...r, inputIndex: index + 1 })),
    encoding: 'data-uri', nativeCrop: false, nativeMask: false, alphaGuaranteed: false,
  }
  return {
    capability: structuredClone(agnesImage21FlashAdapterV1.capability),
    async estimate(request) {
      assertRequest(request)
      const estimate = await agnesImage21FlashAdapterV1.estimate(request)
      return { ...estimate, estimatedStorageBytes: frozen.resolutionTier === '2K' ? 32 * 1024 * 1024 : 16 * 1024 * 1024 }
    },
    async generate(request, transport, signal) {
      assertRequest(request)
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      // Resolve all inputs before dispatch. One missing/changed/cross-owner
      // reference rejects the whole request, never a reduced text-only fallback.
      const images: string[] = []
      for (const reference of frozen.references) {
        const bytes = await verifyAvgReferenceBytesV1(reference, await input.readReference(structuredClone(reference)))
        images.push(dataUri(reference.mimeType, bytes))
      }
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      let dispatched = false
      const governed: MediaProviderTransportV1 = {
        executionLocation: transport.executionLocation,
        fetchExternalAsset: transport.fetchExternalAsset ? (asset, abort) => transport.fetchExternalAsset!(asset, abort) : undefined,
        async request(call, abort) {
          if (dispatched || call.adapterId !== request.adapterId || call.requestId !== request.requestId
            || call.endpoint !== '/v1/images/generations' || call.method !== 'POST') {
            throw new Error('[avg-media] 请求超出本次单次 dispatch 能力')
          }
          if (abort.aborted) throw new DOMException('Aborted', 'AbortError')
          const prompt = images.length ? `${String(call.body.prompt)}\nReference inputs in exact order:\n${JSON.stringify(frozen.references.map((r, i) => ({
            image: i + 1, purpose: r.purpose, preserveAndChange: r.allowedChange,
          })))}` : call.body.prompt
          dispatched = true
          let response
          try {
            response = await transport.request({ ...call, body: { ...call.body, prompt, size: frozen.resolutionTier,
              extra_body: { response_format: 'b64_json', ...(images.length ? { image: images } : {}) } } }, abort)
          } catch (error) {
            // No response after dispatch cannot prove that generation or billing
            // did not occur, including a client abort or network timeout.
            if (error instanceof ProductProductionResultUnknownErrorV1) throw error
            throw new AvgImageOperationUnknownErrorV1(null)
          }
          const root = response.json && typeof response.json === 'object' && !Array.isArray(response.json)
            ? response.json as Record<string, unknown> : null
          if (response.status >= 200 && response.status < 300
            && (response.status === 202 || !Array.isArray(root?.data) || root.data.length === 0)) {
            const rawId = root?.task_id ?? root?.operation_id ?? response.providerRequestId
            const id = typeof rawId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(rawId) ? rawId : null
            throw new AvgImageOperationUnknownErrorV1(id)
          }
          return response
        },
      }
      const candidates = await agnesImage21FlashAdapterV1.generate(request, governed, signal)
      return candidates.map(candidate => ({ ...candidate, metadata: { ...candidate.metadata,
        providerSize: frozen.resolutionTier, avgReferenceTransmission: structuredClone(lineage) } }))
    },
    async parseAndVerify(value) {
      const candidate = await agnesImage21FlashAdapterV1.parseAndVerify(value)
      if (candidate.requestId !== expectedRequest.requestId || candidate.mediaKind !== expectedRequest.mediaKind
        || candidate.mediaClass !== 'image' || candidate.candidateIndex !== 0
        || candidate.rights?.adapterId !== expectedRequest.adapterId || candidate.rights.origin !== 'generated'
        || candidate.rights.rightsPolicyVersion !== expectedRequest.rightsPolicyVersion
        || candidate.rights.requiresProviderTermsReview !== true || typeof candidate.rights.commercialUse !== 'boolean'
        || expectedRequest.qualityProfile === 'commercial-candidate' && !candidate.rights.commercialUse
        || candidate.providerReceipt?.executionLocation !== 'browser-direct'
        || candidate.providerReceipt.costUsd !== null && (!Number.isFinite(candidate.providerReceipt.costUsd) || candidate.providerReceipt.costUsd < 0)
        || candidate.metadata.providerSize !== frozen.resolutionTier
        || canonicalProductProductionJsonV2(candidate.metadata.avgReferenceTransmission) !== canonicalProductProductionJsonV2(lineage)) {
        throw new Error('[avg-media] 候选与实际参考传输回执不一致')
      }
      return candidate
    },
  }
}
