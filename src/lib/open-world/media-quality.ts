import type {
  ProductBuildArtifactRecordV1,
  ProviderCapabilityRequirementV1,
  TextOpenWorldMediaRequirementsV1,
} from '../types'
import { hashProductProductionValueV2, isSha256Hash } from '../product-production/hash'

function fail(message: string): never {
  throw new Error(`[text-open-world-media-quality] ${message}`)
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}不是对象`)
  return value as Record<string, unknown>
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) fail(`${label}无效`)
  return value
}

export interface TextOpenWorldVerifiedMediaRightsV1 {
  artifactKey: string
  assetKey: string
  origin: string
  adapterId: string
  source: string
  license: string
  commercialUse: true
  commercialPolicyPassed: boolean
  capabilityRequirementKey: string
  rightsPolicyVersion: string
  rightsBasis: string | null
  rightsNote: string | null
  producerReceiptHash: string
  providerReceiptHash: string | null
  evidenceHash: string
}

/** Validate the same immutable rights fields that release adoption later
 * rechecks. QA may cite this evidence, but it may never manufacture a
 * `rights.complete` result from a Blob and MIME type alone. */
export async function verifyTextOpenWorldMediaRightsV1(input: {
  artifact: ProductBuildArtifactRecordV1
  qualityProfile: 'prototype' | 'internal' | 'commercial-candidate'
  capabilityRequirement: ProviderCapabilityRequirementV1
}): Promise<TextOpenWorldVerifiedMediaRightsV1> {
  let metadata: Record<string, unknown>
  let rights: Record<string, unknown>
  let quality: Record<string, unknown>
  try {
    metadata = object(JSON.parse(input.artifact.metadataJson), `metadata:${input.artifact.artifactKey}`)
    rights = object(JSON.parse(input.artifact.rightsJson), `rights:${input.artifact.artifactKey}`)
    quality = object(JSON.parse(input.artifact.qualityJson), `quality:${input.artifact.artifactKey}`)
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith('[text-open-world-media-quality]')) throw cause
    fail(`媒资权利JSON损坏:${input.artifact.artifactKey}`)
  }
  const origin = requiredText(rights.origin, `rights.origin:${input.artifact.artifactKey}`)
  const adapterId = requiredText(rights.adapterId, `rights.adapterId:${input.artifact.artifactKey}`)
  const license = requiredText(rights.license, `rights.license:${input.artifact.artifactKey}`)
  const metadataLicense = requiredText(metadata.license, `metadata.license:${input.artifact.artifactKey}`)
  const source = requiredText(metadata.source, `metadata.source:${input.artifact.artifactKey}`)
  const assetKey = requiredText(metadata.assetKey, `metadata.assetKey:${input.artifact.artifactKey}`)
  if (input.artifact.requirementKey !== input.capabilityRequirement.requirementKey
    || !isSha256Hash(input.artifact.producerReceiptHash)) {
    fail(`媒资没有绑定冻结Capability或生产回执:${input.artifact.artifactKey}`)
  }
  if (license !== metadataLicense || rights.commercialUse !== true) {
    fail(`媒资权利与运行元数据不一致或不可商用:${input.artifact.artifactKey}`)
  }
  const isProcedural = origin === 'procedural'
  const isImported = origin === 'imported'
  if (!isProcedural && !isImported && origin !== 'generated') {
    fail(`媒资权利来源类型无效:${input.artifact.artifactKey}`)
  }
  const proceduralSources: Record<string, string> = {
    'storyforge.procedural-svg.v1': 'storyforge-procedural-svg-v1',
    'storyforge.procedural-audio.v1': 'storyforge-procedural-audio-v1',
  }
  if (isProcedural && (proceduralSources[adapterId] !== source || license !== 'CC0-1.0')) {
    fail(`程序化媒资来源、Adapter或CC0权利不匹配:${input.artifact.artifactKey}`)
  }
  if (!isProcedural && !isImported && adapterId !== source) {
    fail(`生成媒资Adapter与运行来源不匹配:${input.artifact.artifactKey}`)
  }
  const rightsBasis = isImported
    ? requiredText(rights.rightsBasis, `rights.rightsBasis:${input.artifact.artifactKey}`)
    : null
  const rightsNote = isImported
    ? requiredText(rights.rightsNote, `rights.rightsNote:${input.artifact.artifactKey}`)
    : null
  if (isImported && (!['author-owned', 'licensed', 'public-domain'].includes(rightsBasis!)
    || adapterId !== 'storyforge.creator-media-import.v1'
    || rights.source !== source
    || !isSha256Hash(rights.importReceiptHash)
    || rights.importReceiptHash !== input.artifact.producerReceiptHash
    || quality.imported !== true || quality.mimeVerified !== true
    || quality.dimensionsVerified !== true
    || quality.importReceiptHash !== rights.importReceiptHash)) {
    fail(`导入媒资来源、权利声明或物理校验回执不闭合:${input.artifact.artifactKey}`)
  }
  const rightsPolicyVersion = isProcedural
    ? 'CC0-1.0'
    : isImported
      ? 'creator-import-v1'
      : requiredText(rights.rightsPolicyVersion, `rights.rightsPolicyVersion:${input.artifact.artifactKey}`)
  const providerReceiptHash = isProcedural || isImported ? null
    : requiredText(quality.providerReceiptHash, `quality.providerReceiptHash:${input.artifact.artifactKey}`)
  if (!isProcedural && !isImported && (!isSha256Hash(providerReceiptHash)
    || rightsPolicyVersion !== input.capabilityRequirement.rightsPolicyVersion
    || license !== `rights-policy:${rightsPolicyVersion}`
    || typeof rights.requiresProviderTermsReview !== 'boolean')) {
    fail(`媒资权利策略或Provider回执不匹配:${input.artifact.artifactKey}`)
  }
  const commercialPolicyPassed = input.qualityProfile !== 'commercial-candidate'
    || (isImported
      ? Boolean(rightsBasis && rightsNote && license)
      : (!isProcedural && !source.startsWith('storyforge-procedural-') && license.startsWith('rights-policy:')))
  if (!commercialPolicyPassed) fail(`商业候选媒资不满足正式来源策略:${input.artifact.artifactKey}`)
  const body = {
    artifactKey: input.artifact.artifactKey,
    assetKey,
    contentHash: input.artifact.contentHash,
    origin,
    adapterId,
    source,
    license,
    commercialUse: true as const,
    commercialPolicyPassed,
    capabilityRequirementKey: input.capabilityRequirement.requirementKey,
    rightsPolicyVersion,
    rightsBasis,
    rightsNote,
    producerReceiptHash: input.artifact.producerReceiptHash,
    providerReceiptHash,
  }
  return { ...body, evidenceHash: await hashProductProductionValueV2(body) }
}

export interface TextOpenWorldMediaCoverageV1 {
  requiredSlotCount: number
  requiredGeneratedSlotCount: number
  generatedRequiredBindingCount: number
  fallbackReadyCount: number
  playableCoverage: number
  generatedRequiredCoverage: number
  evaluatedCoverage: number
  minimumCoverage: number
  releaseReady: boolean
}

/**
 * Prototype/internal Builds may be formally playable through declared text or
 * procedural fallbacks. A commercial candidate must instead cover every
 * non-procedural required portrait/background slot with a real accepted asset;
 * placeholders are never counted as commercial media coverage.
 */
export function evaluateTextOpenWorldMediaCoverageV1(input: {
  requirements: TextOpenWorldMediaRequirementsV1
  generatedSlotKeys: Iterable<string>
  qualityProfile: 'prototype' | 'internal' | 'commercial-candidate'
  minimumCoverage: number
}): TextOpenWorldMediaCoverageV1 {
  if (!Number.isFinite(input.minimumCoverage) || input.minimumCoverage < 0 || input.minimumCoverage > 1) {
    fail('最低媒资覆盖率无效')
  }
  const generated = new Set(input.generatedSlotKeys)
  const required = input.requirements.slots.filter(slot => slot.required)
  // Commercial proof covers every required non-procedural visual slot plus
  // every optional slot that the frozen Brief explicitly scheduled (audio and
  // optional UI included). `fallback-only` optional decoration is excluded,
  // while required portraits/backgrounds remain commercial obligations.
  const requiredGenerated = input.requirements.slots.filter(slot => (
    slot.productionMode !== 'procedural-code'
    && (slot.required || slot.productionMode !== 'fallback-only')
  ))
  const fallbackReadyCount = required.filter(slot => (
    !generated.has(slot.key) && slot.fallback !== 'silent'
  )).length
  const playableCount = required.filter(slot => (
    generated.has(slot.key) || slot.fallback !== 'silent'
  )).length
  const generatedRequiredBindingCount = requiredGenerated.filter(slot => generated.has(slot.key)).length
  const playableCoverage = required.length === 0 ? 1 : playableCount / required.length
  const generatedRequiredCoverage = requiredGenerated.length === 0
    ? 1 : generatedRequiredBindingCount / requiredGenerated.length
  const evaluatedCoverage = input.qualityProfile === 'commercial-candidate'
    ? generatedRequiredCoverage : playableCoverage
  return {
    requiredSlotCount: required.length,
    requiredGeneratedSlotCount: requiredGenerated.length,
    generatedRequiredBindingCount,
    fallbackReadyCount,
    playableCoverage,
    generatedRequiredCoverage,
    evaluatedCoverage,
    minimumCoverage: input.minimumCoverage,
    releaseReady: evaluatedCoverage >= input.minimumCoverage,
  }
}
