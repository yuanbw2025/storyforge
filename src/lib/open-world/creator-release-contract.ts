import type {
  ProductBuildArtifactRecordV1,
  ProductReleaseManifestV1,
  ProductRuntimePackageV1,
  TextOpenWorldCreatorBriefV1,
  TextOpenWorldCreatorProductionSourcePlanV1,
  TextOpenWorldCreatorProductionStartV1,
  TextOpenWorldCreatorReleaseArtifactReceiptV1,
  TextOpenWorldCreatorReleaseAuthorizationV1,
  TextOpenWorldCreatorReleaseLineageV1,
  TextOpenWorldCreatorReleaseSourceContractsV1,
  TextOpenWorldIntegrationReportV1,
  TextOpenWorldSourceManifestV1,
  TextOpenWorldSourcePinV1,
} from '../types'
import {
  canonicalProductProductionJsonV2,
  hashProductProductionValueV2,
  isSha256Hash,
} from '../product-production/hash'
import { verifyTextOpenWorldCreatorBriefV1 } from './creator-brief-persistence'
import {
  parseTextOpenWorldCreatorProductionSourcePlanV1,
  parseTextOpenWorldCreatorProductionStartV1,
} from './creator-production-start'
import {
  TEXT_OPEN_WORLD_CREATOR_RELEASE_QUALITY_GATE_ID_V1,
  parseTextOpenWorldCreatorReleaseQualityEvidenceV1,
  type TextOpenWorldCreatorQualityReceiptV1,
  type TextOpenWorldCreatorReleaseQualityEvidenceV1,
} from './creator-quality-contract'
import { validateTextOpenWorldIntegrationReportV1 } from './runtime-package-production'
import { validateTextOpenWorldSourcePinV1 } from './source-pin'

const STABLE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const RELEASE_QUALITY_POLICY_ID = 'storyforge.text-open-world-creator-release-quality.v1'
const MAX_ARTIFACT_RECEIPTS = 65_536

function fail(message: string): never {
  throw new Error(`[text-open-world-creator-release-contract] ${message}`)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} 字段不精确:${actual.join(',')}`)
  }
}

function stableKey(value: unknown, label: string): string {
  if (typeof value !== 'string' || !STABLE_KEY.test(value)) fail(`${label} 不是稳定key`)
  return value
}

function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isSha256Hash(value)) fail(`${label} 不是SHA-256`)
  return value
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) fail(`${label} 必须是正整数`)
  return Number(value)
}

function timestamp(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) fail(`${label} 不是合法时间`)
  return Number(value)
}

function normalizedText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') fail(`${label} 必须是文本`)
  const result = value.trim().normalize('NFC')
  if (!result || result.length > maximum) fail(`${label} 为空或过长`)
  return result
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort()
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalProductProductionJsonV2(left) === canonicalProductProductionJsonV2(right)
}

function sortedArtifactReceipts(
  values: readonly TextOpenWorldCreatorReleaseArtifactReceiptV1[],
): TextOpenWorldCreatorReleaseArtifactReceiptV1[] {
  return [...values].sort((left, right) => left.artifactKey.localeCompare(right.artifactKey)
    || left.version - right.version)
}

function parseArtifactReceipts(value: unknown): TextOpenWorldCreatorReleaseArtifactReceiptV1[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ARTIFACT_RECEIPTS) {
    fail('artifactReceipts 数量无效')
  }
  const receipts = value.map((item, index) => {
    const row = record(item, `artifactReceipts[${index}]`)
    exactKeys(row, ['artifactKey', 'version', 'contentHash', 'producerReceiptHash'], `artifactReceipts[${index}]`)
    return {
      artifactKey: stableKey(row.artifactKey, `artifactReceipts[${index}].artifactKey`),
      version: positiveInteger(row.version, `artifactReceipts[${index}].version`),
      contentHash: hash(row.contentHash, `artifactReceipts[${index}].contentHash`),
      producerReceiptHash: row.producerReceiptHash == null
        ? null : hash(row.producerReceiptHash, `artifactReceipts[${index}].producerReceiptHash`),
    }
  })
  const sorted = sortedArtifactReceipts(receipts)
  if (!sameJson(receipts, sorted)
    || new Set(receipts.map(item => item.artifactKey)).size !== receipts.length) {
    fail('artifactReceipts 必须按key/version唯一排序')
  }
  return receipts
}

function receiptByKey(
  receipts: readonly TextOpenWorldCreatorReleaseArtifactReceiptV1[],
  artifactKey: string,
): TextOpenWorldCreatorReleaseArtifactReceiptV1 {
  return receipts.find(item => item.artifactKey === artifactKey)
    ?? fail(`发布Artifact集合缺少:${artifactKey}`)
}

export async function validateTextOpenWorldSourceManifestForReleaseV1(
  pin: TextOpenWorldSourcePinV1,
  value: TextOpenWorldSourceManifestV1,
): Promise<TextOpenWorldSourceManifestV1> {
  const manifest = structuredClone(value)
  if (manifest.schema !== 'storyforge.text-open-world-source-manifest' || manifest.version !== 1
    || manifest.productType !== 'text-open-world'
    || manifest.productInstanceKey !== pin.productInstanceKey
    || manifest.sourceKind !== pin.sourceKind || manifest.sourcePinHash !== pin.pinHash
    || manifest.sourceBoundaryHash !== pin.sourceBoundaryHash
    || !Array.isArray(manifest.units) || manifest.units.length !== pin.units.length
    || manifest.readUnitCount + manifest.unreadUnitCount !== manifest.units.length
    || !isSha256Hash(manifest.readSetHash) || !isSha256Hash(manifest.manifestHash)) {
    fail('SourceManifest身份、数量或来源绑定无效')
  }
  const pinByUnit = new Map(pin.units.map(item => [item.unitKey, item]))
  const readRows: Array<{
    unitKey: string
    sourceContentHash: string
    curationDepth: 'full'
    deliveredContentHash: string
    deliveryEvidenceHash: string
    modelBatchKey: string
  }> = []
  const seen = new Set<string>()
  for (const [index, unit] of manifest.units.entries()) {
    const source = pinByUnit.get(unit.unitKey)
    if (!source || seen.has(unit.unitKey) || unit.order !== index
      || unit.artifactKey !== source.artifactKey || unit.kind !== source.kind
      || unit.label !== source.label || unit.sourceResourceKey !== source.sourceResourceKey
      || unit.sourceContentHash !== source.sourceContentHash || unit.frozenDepth !== source.readDepth) {
      fail(`SourceManifest单元与SourcePin不闭合:${unit.unitKey}`)
    }
    seen.add(unit.unitKey)
    if (unit.curationStatus === 'read') {
      if (unit.curationDepth !== 'full' || unit.deliveredContentHash !== source.sourceContentHash
        || !unit.deliveryEvidenceHash || !isSha256Hash(unit.deliveryEvidenceHash)
        || !unit.modelBatchKey || !STABLE_KEY.test(unit.modelBatchKey)) {
        fail(`SourceManifest实读证据无效:${unit.unitKey}`)
      }
      readRows.push({
        unitKey: unit.unitKey, sourceContentHash: unit.sourceContentHash,
        curationDepth: 'full', deliveredContentHash: unit.deliveredContentHash,
        deliveryEvidenceHash: unit.deliveryEvidenceHash, modelBatchKey: unit.modelBatchKey,
      })
    } else if (unit.curationStatus === 'unread') {
      if (unit.curationDepth !== null || unit.deliveredContentHash !== null
        || unit.deliveryEvidenceHash !== null || unit.modelBatchKey !== null) {
        fail(`SourceManifest未读单元携带读取证据:${unit.unitKey}`)
      }
    } else fail(`SourceManifest读取状态无效:${unit.unitKey}`)
  }
  if (manifest.readUnitCount !== readRows.length
    || manifest.unreadUnitCount !== manifest.units.length - readRows.length
    || await hashProductProductionValueV2(readRows) !== manifest.readSetHash) {
    fail('SourceManifest readSetHash不闭合')
  }
  const { manifestHash, ...body } = manifest
  if (await hashProductProductionValueV2(body) !== manifestHash) fail('SourceManifest自身Hash不匹配')
  return manifest
}

export function isTextOpenWorldCreatorReleaseSourceContractsV1(
  value: unknown,
): value is TextOpenWorldCreatorReleaseSourceContractsV1 {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && (value as { schema?: unknown }).schema === 'storyforge.text-open-world-creator-release-source-contracts'
}

export async function createTextOpenWorldCreatorReleaseAuthorizationV1(input: {
  productInstanceKey: string
  buildNumber: number
  adoptionIntentHash: string
  buildManifestHash: string
  runtimePackageHash: string
  releaseQualityReceiptHash: string
  releaseLabel: string
  acknowledgement: TextOpenWorldCreatorReleaseAuthorizationV1['acknowledgement']
  authorizationNonce: string
  authorizedAt?: number
}): Promise<TextOpenWorldCreatorReleaseAuthorizationV1> {
  const nonce = stableKey(input.authorizationNonce, 'authorizationNonce')
  if (Object.values(input.acknowledgement).some(value => value !== true)) {
    fail('发布前四项作者确认必须全部完成')
  }
  const authorizedAt = input.authorizedAt ?? Date.now()
  const body: Omit<TextOpenWorldCreatorReleaseAuthorizationV1, 'authorizationHash'> = {
    schema: 'storyforge.text-open-world-creator-release-authorization', version: 1,
    productInstanceKey: stableKey(input.productInstanceKey, 'productInstanceKey'),
    buildNumber: positiveInteger(input.buildNumber, 'buildNumber'),
    adoptionIntentHash: hash(input.adoptionIntentHash, 'adoptionIntentHash'),
    buildManifestHash: hash(input.buildManifestHash, 'buildManifestHash'),
    runtimePackageHash: hash(input.runtimePackageHash, 'runtimePackageHash'),
    releaseQualityReceiptHash: hash(input.releaseQualityReceiptHash, 'releaseQualityReceiptHash'),
    releaseLabel: normalizedText(input.releaseLabel, 'releaseLabel', 500),
    acknowledgement: { ...input.acknowledgement },
    authorizationNonceHash: await hashProductProductionValueV2({
      nonce, productInstanceKey: input.productInstanceKey, buildNumber: input.buildNumber,
      adoptionIntentHash: input.adoptionIntentHash, authorizedAt,
    }),
    authorizedAt: timestamp(authorizedAt, 'authorizedAt'),
  }
  return { ...body, authorizationHash: await hashProductProductionValueV2(body) }
}

export async function validateTextOpenWorldCreatorReleaseAuthorizationV1(
  value: TextOpenWorldCreatorReleaseAuthorizationV1,
): Promise<TextOpenWorldCreatorReleaseAuthorizationV1> {
  const row = record(value, 'releaseAuthorization')
  exactKeys(row, [
    'schema', 'version', 'productInstanceKey', 'buildNumber', 'adoptionIntentHash',
    'buildManifestHash', 'runtimePackageHash', 'releaseQualityReceiptHash', 'releaseLabel',
    'acknowledgement', 'authorizationNonceHash', 'authorizedAt', 'authorizationHash',
  ], 'releaseAuthorization')
  const acknowledgement = record(row.acknowledgement, 'releaseAuthorization.acknowledgement')
  exactKeys(acknowledgement, [
    'sourceAndRightsReviewed', 'buildAndQualityReviewed', 'immutableReleaseReviewed', 'publishNow',
  ], 'releaseAuthorization.acknowledgement')
  if (row.schema !== 'storyforge.text-open-world-creator-release-authorization' || row.version !== 1
    || Object.values(acknowledgement).some(item => item !== true)) fail('发布授权身份或确认无效')
  const parsed: TextOpenWorldCreatorReleaseAuthorizationV1 = {
    schema: 'storyforge.text-open-world-creator-release-authorization', version: 1,
    productInstanceKey: stableKey(row.productInstanceKey, 'productInstanceKey'),
    buildNumber: positiveInteger(row.buildNumber, 'buildNumber'),
    adoptionIntentHash: hash(row.adoptionIntentHash, 'adoptionIntentHash'),
    buildManifestHash: hash(row.buildManifestHash, 'buildManifestHash'),
    runtimePackageHash: hash(row.runtimePackageHash, 'runtimePackageHash'),
    releaseQualityReceiptHash: hash(row.releaseQualityReceiptHash, 'releaseQualityReceiptHash'),
    releaseLabel: normalizedText(row.releaseLabel, 'releaseLabel', 500),
    acknowledgement: {
      sourceAndRightsReviewed: true, buildAndQualityReviewed: true,
      immutableReleaseReviewed: true, publishNow: true,
    },
    authorizationNonceHash: hash(row.authorizationNonceHash, 'authorizationNonceHash'),
    authorizedAt: timestamp(row.authorizedAt, 'authorizedAt'),
    authorizationHash: hash(row.authorizationHash, 'authorizationHash'),
  }
  const { authorizationHash, ...body } = parsed
  if (await hashProductProductionValueV2(body) !== authorizationHash) fail('发布授权Hash不匹配')
  return parsed
}

async function validatePortableReleaseQuality(
  value: TextOpenWorldCreatorReleaseSourceContractsV1['releaseQuality'],
): Promise<TextOpenWorldCreatorReleaseSourceContractsV1['releaseQuality']> {
  const row = record(value, 'releaseQuality')
  exactKeys(row, ['gateId', 'status', 'receiptHash', 'evidence', 'createdAt'], 'releaseQuality')
  if (row.gateId !== TEXT_OPEN_WORLD_CREATOR_RELEASE_QUALITY_GATE_ID_V1 || row.status !== 'passed') {
    fail('Creator发布质量回执身份或状态无效')
  }
  const evidence = parseTextOpenWorldCreatorReleaseQualityEvidenceV1(row.evidence)
  if (timestamp(row.createdAt, 'releaseQuality.createdAt') !== evidence.completedAt) {
    fail('Creator发布质量回执与Build不闭合')
  }
  const body = {
    schema: 'storyforge.product-quality-gate-receipt' as const, version: 1 as const,
    gateId: TEXT_OPEN_WORLD_CREATOR_RELEASE_QUALITY_GATE_ID_V1, gateVersion: '1',
    verifierId: 'storyforge.creator-release-quality-join', verifierVersion: '1',
    verifierKind: 'deterministic' as const,
    inputHashes: [
      evidence.build.packageHash, evidence.build.previewHash, evidence.hardGateReceiptHash,
      evidence.semanticDecisionReceiptHash, evidence.grayboxReceiptHash, evidence.issueSetHash,
    ],
    environmentHash: null,
    measuredJson: canonicalProductProductionJsonV2(evidence), status: 'passed' as const,
    thresholdProfileId: RELEASE_QUALITY_POLICY_ID, thresholdProfileVersion: '1',
    evidenceRefs: [
      evidence.hardGateReceiptHash, evidence.semanticDecisionReceiptHash,
      evidence.grayboxReceiptHash, ...evidence.issueReceiptHashes,
      ...evidence.issueWaiverReceiptHashes,
    ],
    createdAt: evidence.completedAt,
  }
  const receiptHash = hash(row.receiptHash, 'releaseQuality.receiptHash')
  if (await hashProductProductionValueV2(body) !== receiptHash) fail('Creator发布质量回执Hash不匹配')
  return { gateId: TEXT_OPEN_WORLD_CREATOR_RELEASE_QUALITY_GATE_ID_V1, status: 'passed', receiptHash, evidence, createdAt: evidence.completedAt }
}

export async function createTextOpenWorldCreatorReleaseSourceContractsV1(input: {
  creatorBrief: TextOpenWorldCreatorBriefV1
  sourcePlan: TextOpenWorldCreatorProductionSourcePlanV1
  creatorStart: TextOpenWorldCreatorProductionStartV1
  sourcePin: TextOpenWorldSourcePinV1
  sourceManifest: TextOpenWorldSourceManifestV1
  artifactReceipts: TextOpenWorldCreatorReleaseArtifactReceiptV1[]
  integrationReport: TextOpenWorldIntegrationReportV1
  governanceSnapshotHash: string
  releaseQuality: TextOpenWorldCreatorQualityReceiptV1<TextOpenWorldCreatorReleaseQualityEvidenceV1>
  releaseAuthorization: TextOpenWorldCreatorReleaseAuthorizationV1
  runtimePackage: ProductRuntimePackageV1
}): Promise<TextOpenWorldCreatorReleaseSourceContractsV1> {
  const artifactReceipts = sortedArtifactReceipts(input.artifactReceipts)
  const body: Omit<TextOpenWorldCreatorReleaseSourceContractsV1, 'contractHash'> = {
    schema: 'storyforge.text-open-world-creator-release-source-contracts', version: 1,
    productType: 'text-open-world', creatorBrief: structuredClone(input.creatorBrief),
    sourcePlan: structuredClone(input.sourcePlan), creatorStart: structuredClone(input.creatorStart),
    sourcePin: structuredClone(input.sourcePin), sourceManifest: structuredClone(input.sourceManifest),
    artifactReceipts, artifactSetHash: await hashProductProductionValueV2(artifactReceipts),
    integrationReport: structuredClone(input.integrationReport),
    governanceSnapshotHash: hash(input.governanceSnapshotHash, 'governanceSnapshotHash'),
    releaseQuality: {
      gateId: TEXT_OPEN_WORLD_CREATOR_RELEASE_QUALITY_GATE_ID_V1,
      status: 'passed', receiptHash: input.releaseQuality.receiptHash,
      evidence: structuredClone(input.releaseQuality.evidence), createdAt: input.releaseQuality.createdAt,
    },
    releaseAuthorization: structuredClone(input.releaseAuthorization),
  }
  const candidate = { ...body, contractHash: await hashProductProductionValueV2(body) }
  return validateTextOpenWorldCreatorReleaseSourceContractsV1(candidate, input.runtimePackage)
}

export async function validateTextOpenWorldCreatorReleaseSourceContractsV1(
  value: TextOpenWorldCreatorReleaseSourceContractsV1,
  runtimePackage: ProductRuntimePackageV1,
): Promise<TextOpenWorldCreatorReleaseSourceContractsV1> {
  const row = record(value, 'creatorSourceContracts')
  exactKeys(row, [
    'schema', 'version', 'productType', 'creatorBrief', 'sourcePlan', 'creatorStart',
    'sourcePin', 'sourceManifest', 'artifactReceipts', 'artifactSetHash', 'integrationReport',
    'governanceSnapshotHash', 'releaseQuality', 'releaseAuthorization', 'contractHash',
  ], 'creatorSourceContracts')
  if (row.schema !== 'storyforge.text-open-world-creator-release-source-contracts'
    || row.version !== 1 || row.productType !== 'text-open-world'
    || runtimePackage.productType !== 'text-open-world' || !runtimePackage.textOpenWorldVNext) {
    fail('Creator Release来源合同身份无效')
  }
  const creatorBrief = await verifyTextOpenWorldCreatorBriefV1(row.creatorBrief as TextOpenWorldCreatorBriefV1)
  const sourcePlan = await parseTextOpenWorldCreatorProductionSourcePlanV1(row.sourcePlan, creatorBrief)
  const creatorStart = await parseTextOpenWorldCreatorProductionStartV1({
    value: row.creatorStart, brief: creatorBrief, sourcePlan,
  })
  const sourcePin = await validateTextOpenWorldSourcePinV1(row.sourcePin)
  const sourceManifest = await validateTextOpenWorldSourceManifestForReleaseV1(
    sourcePin,
    row.sourceManifest as TextOpenWorldSourceManifestV1,
  )
  const artifactReceipts = parseArtifactReceipts(row.artifactReceipts)
  const artifactSetHash = hash(row.artifactSetHash, 'artifactSetHash')
  if (await hashProductProductionValueV2(artifactReceipts) !== artifactSetHash) {
    fail('Artifact receipt集合Hash不匹配')
  }
  const integrationReport = await validateTextOpenWorldIntegrationReportV1({
    runtimePackage,
    report: structuredClone(row.integrationReport) as TextOpenWorldIntegrationReportV1,
  })
  const governanceSnapshotHash = hash(row.governanceSnapshotHash, 'governanceSnapshotHash')
  const releaseQuality = await validatePortableReleaseQuality(
    row.releaseQuality as TextOpenWorldCreatorReleaseSourceContractsV1['releaseQuality'],
  )
  const releaseAuthorization = await validateTextOpenWorldCreatorReleaseAuthorizationV1(
    row.releaseAuthorization as TextOpenWorldCreatorReleaseAuthorizationV1,
  )
  if (creatorBrief.productInstanceKey !== sourcePlan.productInstanceKey
    || creatorStart.productInstanceKey !== sourcePlan.productInstanceKey
    || sourcePin.productInstanceKey !== sourcePlan.productInstanceKey
    || sourceManifest.productInstanceKey !== sourcePlan.productInstanceKey
    || integrationReport.productInstanceKey !== sourcePlan.productInstanceKey
    || runtimePackage.definition.productKey !== sourcePlan.productInstanceKey
    || sourcePlan.sourceKind !== sourcePin.sourceKind || sourcePlan.sourceKind !== sourceManifest.sourceKind
    || sourcePlan.sourceVersionHash !== sourcePin.sourceVersionHash
    || sourcePlan.expectedSourceBoundaryHash !== sourcePin.sourceBoundaryHash
    || sourceManifest.sourcePinHash !== sourcePin.pinHash
    || creatorStart.sourcePlanHash !== sourcePlan.planHash
    || creatorStart.briefHash !== creatorBrief.briefHash
    || sourcePin.authorization.briefHash !== creatorBrief.briefHash
    || sourcePin.authorization.briefRevision !== creatorBrief.revision
    || sourcePin.authorization.authorStartRevision !== creatorStart.authorStartRevision
    || sourcePin.authorization.rightsBasis !== creatorStart.rightsBasis
    || sourcePin.authorization.rightsNote !== creatorStart.rightsNote) {
    fail('Creator Brief/Start/SourcePlan/SourcePin/SourceManifest owner或Hash链不闭合')
  }
  const expectedP0NonceHash = await hashProductProductionValueV2({
    nonce: creatorStart.authorizationNonceHash,
    productInstanceKey: sourcePlan.productInstanceKey,
    sourceKind: sourcePin.sourceKind,
    sourceVersionHash: sourcePin.sourceVersionHash,
    sourceBoundaryHash: sourcePin.sourceBoundaryHash,
    briefRevision: creatorBrief.revision,
    authorStartRevision: creatorStart.authorStartRevision,
  })
  if (sourcePin.authorization.authorizationNonceHash !== expectedP0NonceHash) {
    fail('SourcePin没有绑定Creator Start的一次性授权见证')
  }
  const innerSource = runtimePackage.textOpenWorldVNext.sourceManifest
  const expectedInnerKind = sourcePin.sourceKind === 'world-release' ? 'world-release' : 'novel-source-pin'
  const expectedResourceHashes = sourcePin.units.map(unit => ({
    resourceId: unit.sourceResourceKey ?? unit.unitKey,
    contentHash: unit.sourceContentHash,
  }))
  if (runtimePackage.sourceWorld.contentHash !== sourcePlan.sourceVersionHash
    || runtimePackage.sourceWorld.selection.worldReferenceHash !== sourcePlan.sourceBindingHash
    || innerSource.kind !== expectedInnerKind || innerSource.contentHash !== sourcePin.sourceVersionHash
    || innerSource.selectionHash !== sourcePin.sourceBoundaryHash
    || !sameJson(innerSource.resourceHashes, expectedResourceHashes)
    || integrationReport.sourcePinHash !== sourcePin.pinHash) {
    fail('RuntimePackage没有消费精确双来源与SourcePin单元集合')
  }
  const artifactMatches = (artifactKey: string, contentHash: string) => (
    receiptByKey(artifactReceipts, artifactKey).contentHash === contentHash
  )
  if (!artifactMatches('text-open-world.source-pin', sourcePin.pinHash)
    || !artifactMatches('text-open-world.source-manifest', sourceManifest.manifestHash)
    || !artifactMatches('text-open-world.integration-report', integrationReport.integrationReportHash)
    || !artifactMatches('text-open-world.runtime-package', releaseQuality.evidence.build.packageHash)
    || !artifactMatches('text-open-world.quality-report', releaseQuality.evidence.build.qualityReportHash)
    || sourcePin.units.some(unit => !artifactMatches(unit.artifactKey, unit.artifactContentHash))) {
    fail('正式消费槽、来源单元或终态Artifact receipt集合不闭合')
  }
  if (releaseQuality.evidence.build.productionKey !== sourcePlan.productInstanceKey
    || releaseQuality.evidence.build.packageHash !== integrationReport.runtimePackageHash
    || releaseAuthorization.productInstanceKey !== sourcePlan.productInstanceKey
    || releaseAuthorization.buildNumber !== releaseQuality.evidence.build.buildNumber
    || releaseAuthorization.buildManifestHash !== releaseQuality.evidence.build.manifestHash
    || releaseAuthorization.runtimePackageHash !== releaseQuality.evidence.build.packageHash
    || releaseAuthorization.releaseQualityReceiptHash !== releaseQuality.receiptHash) {
    fail('发布授权、G5-09质量回执和Build装配证据不闭合')
  }
  const contractHash = hash(row.contractHash, 'contractHash')
  const parsed: TextOpenWorldCreatorReleaseSourceContractsV1 = {
    schema: 'storyforge.text-open-world-creator-release-source-contracts', version: 1,
    productType: 'text-open-world', creatorBrief, sourcePlan, creatorStart, sourcePin,
    sourceManifest, artifactReceipts, artifactSetHash, integrationReport,
    governanceSnapshotHash, releaseQuality, releaseAuthorization, contractHash,
  }
  const { contractHash: _contractHash, ...body } = parsed
  if (await hashProductProductionValueV2(body) !== contractHash) fail('Creator Release来源合同Hash不匹配')
  return parsed
}

export async function createTextOpenWorldCreatorReleaseLineageV1(input: {
  sourceContracts: TextOpenWorldCreatorReleaseSourceContractsV1
  releaseUid: string
  releaseVersion: number
  releaseHash: string
  parentRelease: TextOpenWorldCreatorReleaseLineageV1['parentRelease']
  build: TextOpenWorldCreatorReleaseLineageV1['build']
  qualityReceiptHashes: string[]
  compatibility: TextOpenWorldCreatorReleaseLineageV1['compatibility']
  createdAt: number
}): Promise<TextOpenWorldCreatorReleaseLineageV1> {
  const source = input.sourceContracts
  const body: Omit<TextOpenWorldCreatorReleaseLineageV1, 'lineageHash'> = {
    schema: 'storyforge.text-open-world-creator-release-lineage', version: 1,
    productType: 'text-open-world', productInstanceKey: source.sourcePlan.productInstanceKey,
    releaseUid: normalizedText(input.releaseUid, 'releaseUid', 1_000),
    releaseVersion: positiveInteger(input.releaseVersion, 'releaseVersion'),
    releaseHash: hash(input.releaseHash, 'releaseHash'), parentRelease: input.parentRelease,
    sourceKind: source.sourcePlan.sourceKind, sourceBindingHash: source.sourcePlan.sourceBindingHash,
    sourcePlanHash: source.sourcePlan.planHash, sourcePinHash: source.sourcePin.pinHash,
    sourceManifestHash: source.sourceManifest.manifestHash,
    creatorBriefHash: source.creatorBrief.briefHash, creatorStartHash: source.creatorStart.startHash,
    build: { ...input.build }, quality: { passed: true, receiptHashes: uniqueSorted(input.qualityReceiptHashes) },
    governanceSnapshotHash: source.governanceSnapshotHash,
    releaseAuthorizationHash: source.releaseAuthorization.authorizationHash,
    compatibility: {
      ...input.compatibility,
      evidenceHashes: uniqueSorted(input.compatibility.evidenceHashes),
    },
    createdAt: timestamp(input.createdAt, 'createdAt'),
  }
  return validateTextOpenWorldCreatorReleaseLineageV1({
    ...body, lineageHash: await hashProductProductionValueV2(body),
  })
}

export async function validateTextOpenWorldCreatorReleaseLineageV1(
  value: TextOpenWorldCreatorReleaseLineageV1,
): Promise<TextOpenWorldCreatorReleaseLineageV1> {
  const row = record(value, 'creatorLineage')
  exactKeys(row, [
    'schema', 'version', 'productType', 'productInstanceKey', 'releaseUid', 'releaseVersion',
    'releaseHash', 'parentRelease', 'sourceKind', 'sourceBindingHash', 'sourcePlanHash',
    'sourcePinHash', 'sourceManifestHash', 'creatorBriefHash', 'creatorStartHash', 'build',
    'quality', 'governanceSnapshotHash', 'releaseAuthorizationHash', 'compatibility',
    'createdAt', 'lineageHash',
  ], 'creatorLineage')
  if (row.schema !== 'storyforge.text-open-world-creator-release-lineage' || row.version !== 1
    || row.productType !== 'text-open-world' || !['world-release', 'novel'].includes(String(row.sourceKind))) {
    fail('Creator lineage身份无效')
  }
  const lineage = structuredClone(value)
  stableKey(lineage.productInstanceKey, 'lineage.productInstanceKey')
  normalizedText(lineage.releaseUid, 'lineage.releaseUid', 1_000)
  positiveInteger(lineage.releaseVersion, 'lineage.releaseVersion')
  for (const item of [
    lineage.releaseHash, lineage.sourceBindingHash, lineage.sourcePlanHash, lineage.sourcePinHash,
    lineage.sourceManifestHash, lineage.creatorBriefHash, lineage.creatorStartHash,
    lineage.build.buildHash, lineage.governanceSnapshotHash, lineage.releaseAuthorizationHash,
    lineage.lineageHash, ...lineage.quality.receiptHashes, ...lineage.compatibility.evidenceHashes,
  ]) hash(item, 'lineage hash')
  if (!lineage.quality.passed || !lineage.quality.receiptHashes.length
    || !Number.isSafeInteger(lineage.compatibility.protocolVersion)
    || lineage.compatibility.protocolVersion < 1
    || (lineage.releaseVersion === 1) !== (lineage.parentRelease == null)
    || lineage.parentRelease == null && lineage.compatibility.status !== 'initial'
    || lineage.parentRelease != null && lineage.compatibility.status === 'initial') {
    fail('Creator lineage父版本、质量或兼容结论无效')
  }
  if (lineage.parentRelease) hash(lineage.parentRelease.releaseHash, 'parentRelease.releaseHash')
  const { lineageHash, ...body } = lineage
  if (await hashProductProductionValueV2(body) !== lineageHash) fail('Creator lineageHash不匹配')
  return lineage
}

export async function verifyTextOpenWorldCreatorReleaseManifestBindingsV1(
  manifest: ProductReleaseManifestV1,
): Promise<TextOpenWorldCreatorReleaseSourceContractsV1> {
  if (!isTextOpenWorldCreatorReleaseSourceContractsV1(manifest.sourceContracts)) {
    fail('Release不是Creator双来源合同')
  }
  const source = await validateTextOpenWorldCreatorReleaseSourceContractsV1(
    manifest.sourceContracts,
    manifest.runtimePackage,
  )
  if (manifest.lineage.schema !== 'storyforge.text-open-world-creator-release-lineage') {
    fail('Creator Release缺少Creator lineage')
  }
  const lineage = await validateTextOpenWorldCreatorReleaseLineageV1(manifest.lineage)
  if (manifest.productType !== 'text-open-world'
    || manifest.sourceWorldRelease.contentHash !== source.sourcePlan.sourceVersionHash
    || manifest.packageHash !== source.releaseQuality.evidence.build.packageHash
    || manifest.productionProvenance.productionKey !== source.sourcePlan.productInstanceKey
    || manifest.productionProvenance.buildNumber !== source.releaseQuality.evidence.build.buildNumber
    || manifest.productionProvenance.buildManifestHash !== source.releaseQuality.evidence.build.manifestHash
    || manifest.productionProvenance.rootTerminalReceiptHash
      !== source.releaseQuality.evidence.build.rootTerminalReceiptHash
    || lineage.releaseHash !== manifest.releaseIdentityHash
    || lineage.productInstanceKey !== source.sourcePlan.productInstanceKey
    || lineage.sourceKind !== source.sourcePlan.sourceKind
    || lineage.sourceBindingHash !== source.sourcePlan.sourceBindingHash
    || lineage.sourcePlanHash !== source.sourcePlan.planHash
    || lineage.sourcePinHash !== source.sourcePin.pinHash
    || lineage.sourceManifestHash !== source.sourceManifest.manifestHash
    || lineage.creatorBriefHash !== source.creatorBrief.briefHash
    || lineage.creatorStartHash !== source.creatorStart.startHash
    || lineage.build.buildHash !== manifest.productionProvenance.buildManifestHash
    || lineage.governanceSnapshotHash !== source.governanceSnapshotHash
    || lineage.releaseAuthorizationHash !== source.releaseAuthorization.authorizationHash
    || !lineage.quality.receiptHashes.includes(source.releaseQuality.receiptHash)) {
    fail('Creator Release根、来源、Build、质量和lineage不闭合')
  }
  return source
}

export function creatorReleaseArtifactReceiptsFromRowsV1(
  artifacts: readonly ProductBuildArtifactRecordV1[],
): TextOpenWorldCreatorReleaseArtifactReceiptV1[] {
  return sortedArtifactReceipts(artifacts.map(row => ({
    artifactKey: row.artifactKey, version: row.version, contentHash: row.contentHash,
    producerReceiptHash: row.producerReceiptHash,
  })))
}
