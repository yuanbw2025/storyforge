export const TTRPG_COMPLETION_REQUIRED_EVIDENCE_V2 = [
  'golden-turn',
  'golden-a',
  'golden-b',
  'golden-c',
  'requirements-u01-u21',
  'non-fixture-browser-path',
  'human-gm-full-session',
  'ai-gm-real-model-eval',
  'commercial-media-set',
  'external-identity-multidevice-recovery',
  'unassisted-new-users',
] as const

export type TtrpgCompletionEvidenceKeyV2 = typeof TTRPG_COMPLETION_REQUIRED_EVIDENCE_V2[number]

interface GoldenTurnDetailsV2 {
  actionReceiptCount: number
  replayReceiptHash: string
  viewerProjectionReceiptHash: string
}

interface GoldenScenarioDetailsV2 {
  browserJourneyReceiptHash: string
  productReleaseHash: string
  participantReceiptHashes: string[]
  providerReceiptHashes: string[]
}

interface RequirementsDetailsV2 {
  checklistReceiptHash: string
  passedRequirementCount: number
}

interface NonFixtureBrowserDetailsV2 {
  browserJourneyReceiptHash: string
  fixtureScanReceiptHash: string
}

interface HumanGmSessionDetailsV2 {
  branchRestoreCount: number
  durationMinutes: number
  humanParticipantReceiptHashes: string[]
  itemTransferCount: number
  privateClueCount: number
  rewardPenaltyCount: number
  ruleEncounterCount: number
  sceneCount: number
  usageExhaustionRecoveryCount: number
}

interface AiGmEvalDetailsV2 {
  adversarialSampleCount: number
  providerReceiptHashes: string[]
  sampleCount: number
  scenarioFamilyCount: number
}

interface CommercialMediaDetailsV2 {
  assetReceiptHash: string
  characterCount: number
  expressionCount: number
  handoutCount: number
  itemOrClueCount: number
  mapCount: number
  providerReceiptHashes: string[]
  runtimeGeneratedCount: number
  sceneCount: number
}

interface ExternalIdentityDetailsV2 {
  conformanceReceiptHash: string
  deviceReceiptHashes: string[]
  identitySubjectHashes: string[]
  networkIsolationReceiptHash: string
  restartRecoveryReceiptHash: string
}

interface UnassistedUsersDetailsV2 {
  assistanceIncidentCount: number
  completedParticipantReceiptHashes: string[]
  studyProtocolReceiptHash: string
}

export interface TtrpgCompletionEvidenceDetailsByKeyV2 {
  'golden-turn': GoldenTurnDetailsV2
  'golden-a': GoldenScenarioDetailsV2
  'golden-b': GoldenScenarioDetailsV2
  'golden-c': GoldenScenarioDetailsV2
  'requirements-u01-u21': RequirementsDetailsV2
  'non-fixture-browser-path': NonFixtureBrowserDetailsV2
  'human-gm-full-session': HumanGmSessionDetailsV2
  'ai-gm-real-model-eval': AiGmEvalDetailsV2
  'commercial-media-set': CommercialMediaDetailsV2
  'external-identity-multidevice-recovery': ExternalIdentityDetailsV2
  'unassisted-new-users': UnassistedUsersDetailsV2
}

export interface TtrpgCompletionEvidenceReportV2<K extends TtrpgCompletionEvidenceKeyV2> {
  status: 'passed'
  reportHash: string
  reviewerReceiptHash: string
  sealedAt: string
  environment: 'staging' | 'production'
  realBrowser: true
  fixtureFree: true
  details: TtrpgCompletionEvidenceDetailsByKeyV2[K]
}

export interface TtrpgCompletionEvidenceAttestationV2 {
  policyVersion: 'ttrpg-completion-gate-v2'
  evidence: {
    [K in TtrpgCompletionEvidenceKeyV2]: TtrpgCompletionEvidenceReportV2<K>
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(',') === [...keys].sort().join(',')
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

function isHashArray(value: unknown, minimum: number): value is string[] {
  return Array.isArray(value)
    && value.length >= minimum
    && value.every(isHash)
    && new Set(value).size === value.length
}

function isIntegerAtLeast(value: unknown, minimum: number): value is number {
  return Number.isInteger(value) && Number(value) >= minimum
}

function isFiniteAtLeast(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function validateGoldenTurnDetails(value: Record<string, unknown>): boolean {
  return hasExactKeys(value, ['actionReceiptCount', 'replayReceiptHash', 'viewerProjectionReceiptHash'])
    && isIntegerAtLeast(value.actionReceiptCount, 1)
    && isHash(value.replayReceiptHash)
    && isHash(value.viewerProjectionReceiptHash)
}

function validateGoldenScenarioDetails(value: Record<string, unknown>): boolean {
  return hasExactKeys(value, [
    'browserJourneyReceiptHash', 'productReleaseHash', 'participantReceiptHashes', 'providerReceiptHashes',
  ])
    && isHash(value.browserJourneyReceiptHash)
    && isHash(value.productReleaseHash)
    && isHashArray(value.participantReceiptHashes, 3)
    && isHashArray(value.providerReceiptHashes, 1)
}

function validateHumanGmSessionDetails(value: Record<string, unknown>): boolean {
  return hasExactKeys(value, [
    'branchRestoreCount', 'durationMinutes', 'humanParticipantReceiptHashes', 'itemTransferCount',
    'privateClueCount', 'rewardPenaltyCount', 'ruleEncounterCount', 'sceneCount',
    'usageExhaustionRecoveryCount',
  ])
    && isFiniteAtLeast(value.durationMinutes, 90)
    && isHashArray(value.humanParticipantReceiptHashes, 3)
    && isIntegerAtLeast(value.sceneCount, 3)
    && isIntegerAtLeast(value.ruleEncounterCount, 1)
    && isIntegerAtLeast(value.privateClueCount, 1)
    && isIntegerAtLeast(value.itemTransferCount, 1)
    && isIntegerAtLeast(value.usageExhaustionRecoveryCount, 1)
    && isIntegerAtLeast(value.rewardPenaltyCount, 1)
    && isIntegerAtLeast(value.branchRestoreCount, 1)
}

function validateAiGmEvalDetails(value: Record<string, unknown>): boolean {
  return hasExactKeys(value, [
    'adversarialSampleCount', 'providerReceiptHashes', 'sampleCount', 'scenarioFamilyCount',
  ])
    && isIntegerAtLeast(value.sampleCount, 30)
    && isIntegerAtLeast(value.scenarioFamilyCount, 5)
    && isIntegerAtLeast(value.adversarialSampleCount, 10)
    && isHashArray(value.providerReceiptHashes, 1)
}

function validateCommercialMediaDetails(value: Record<string, unknown>): boolean {
  return hasExactKeys(value, [
    'assetReceiptHash', 'characterCount', 'expressionCount', 'handoutCount', 'itemOrClueCount',
    'mapCount', 'providerReceiptHashes', 'runtimeGeneratedCount', 'sceneCount',
  ])
    && isHash(value.assetReceiptHash)
    && isHashArray(value.providerReceiptHashes, 2)
    && isIntegerAtLeast(value.sceneCount, 3)
    && isIntegerAtLeast(value.characterCount, 3)
    && isIntegerAtLeast(value.expressionCount, 12)
    && isIntegerAtLeast(value.itemOrClueCount, 6)
    && isIntegerAtLeast(value.mapCount, 1)
    && isIntegerAtLeast(value.handoutCount, 3)
    && isIntegerAtLeast(value.runtimeGeneratedCount, 1)
}

function validateExternalIdentityDetails(value: Record<string, unknown>): boolean {
  return hasExactKeys(value, [
    'conformanceReceiptHash', 'deviceReceiptHashes', 'identitySubjectHashes',
    'networkIsolationReceiptHash', 'restartRecoveryReceiptHash',
  ])
    && isHash(value.conformanceReceiptHash)
    && isHash(value.networkIsolationReceiptHash)
    && isHash(value.restartRecoveryReceiptHash)
    && isHashArray(value.identitySubjectHashes, 3)
    && isHashArray(value.deviceReceiptHashes, 3)
}

function validateDetails(key: TtrpgCompletionEvidenceKeyV2, value: unknown): boolean {
  if (!isRecord(value)) return false
  if (key === 'golden-turn') return validateGoldenTurnDetails(value)
  if (key === 'golden-a' || key === 'golden-b' || key === 'golden-c') {
    return validateGoldenScenarioDetails(value)
  }
  if (key === 'requirements-u01-u21') {
    return hasExactKeys(value, ['checklistReceiptHash', 'passedRequirementCount'])
      && isHash(value.checklistReceiptHash)
      && value.passedRequirementCount === 21
  }
  if (key === 'non-fixture-browser-path') {
    return hasExactKeys(value, ['browserJourneyReceiptHash', 'fixtureScanReceiptHash'])
      && isHash(value.browserJourneyReceiptHash)
      && isHash(value.fixtureScanReceiptHash)
  }
  if (key === 'human-gm-full-session') return validateHumanGmSessionDetails(value)
  if (key === 'ai-gm-real-model-eval') return validateAiGmEvalDetails(value)
  if (key === 'commercial-media-set') return validateCommercialMediaDetails(value)
  if (key === 'external-identity-multidevice-recovery') return validateExternalIdentityDetails(value)
  return hasExactKeys(value, [
    'assistanceIncidentCount', 'completedParticipantReceiptHashes', 'studyProtocolReceiptHash',
  ])
    && value.assistanceIncidentCount === 0
    && isHashArray(value.completedParticipantReceiptHashes, 5)
    && isHash(value.studyProtocolReceiptHash)
}

/**
 * Commercial promotion requires sealed reports for every real-world exit gate.
 * Hash-only or boolean-only attestations from completion-gate-v1 are rejected.
 */
export function validateTtrpgCompletionEvidenceV2(input: unknown): input is TtrpgCompletionEvidenceAttestationV2 {
  if (!isRecord(input)
    || !hasExactKeys(input, ['evidence', 'policyVersion'])
    || input.policyVersion !== 'ttrpg-completion-gate-v2'
    || !isRecord(input.evidence)) return false
  const evidence = input.evidence
  if (!hasExactKeys(evidence, TTRPG_COMPLETION_REQUIRED_EVIDENCE_V2)) return false
  return TTRPG_COMPLETION_REQUIRED_EVIDENCE_V2.every(key => {
    const row = evidence[key]
    if (!isRecord(row) || !hasExactKeys(row, [
      'details', 'environment', 'fixtureFree', 'realBrowser', 'reportHash',
      'reviewerReceiptHash', 'sealedAt', 'status',
    ])) return false
    return row.status === 'passed'
      && row.realBrowser === true
      && row.fixtureFree === true
      && (row.environment === 'staging' || row.environment === 'production')
      && isHash(row.reportHash)
      && isHash(row.reviewerReceiptHash)
      && isIsoTimestamp(row.sealedAt)
      && validateDetails(key, row.details)
  })
}
