import type { ProductBuildArtifactKindV1 } from '../types/product-production'
import { prepareAvgProfessionalArtifactV1 } from './artifact-contract'

export function isAvgProfessionalArtifactV1(input: { artifactKey: string; payload: unknown; metadata: unknown }): boolean {
  const hasAvgSchema = (value: unknown) => value !== null && typeof value === 'object' && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).schema === 'string'
    && String((value as Record<string, unknown>).schema).startsWith('storyforge.avg.')
  // V1 author-edited media uses these numbered keys. New schemas still cannot
  // hide behind one of them, but ordinary V1 media keeps its existing writer.
  const legacyMediaKey = /^avg\.media\.(0|[1-9][0-9]*)$/.test(input.artifactKey)
  return input.artifactKey.startsWith('avg.') && !legacyMediaKey || hasAvgSchema(input.payload) || hasAvgSchema(input.metadata)
}
/** New AVG schemas cannot borrow the legacy generic writer while their Skills/adoption are unready. */
export function assertAvgProfessionalArtifactAdmissionV1(input: {
  productType: string; artifactKey: string; kind: ProductBuildArtifactKindV1; payload: unknown; metadata: unknown
}): void {
  if (!isAvgProfessionalArtifactV1(input)) return
  if (input.productType !== 'avg') throw new Error('[avg] 专业工件不得跨产品写入')
  prepareAvgProfessionalArtifactV1({ ...input, allowedOutputKeys: [input.artifactKey] })
  // The future role package must replace this gate with registered frozen write-domain,
  // source/receipt/author verification. A self-reported schema or producer is insufficient.
  throw new Error('[avg] 专业工件采用尚未就绪；需要登记的 Skill/候选/作者采用合同')
}
