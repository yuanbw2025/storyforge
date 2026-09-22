import {
  canonicalProductProductionJsonV2,
  hashProductProductionValueV2,
  isSha256Hash,
} from '../product-production/hash'
import {
  hashProductProductionCarriedCandidateV1,
  hashProductProductionCarriedReceiptV1,
} from '../product-production/task-evidence'
import type { ProductBuildArtifactKindV1 } from '../types'
import { isProductBuildArtifactKindV1 } from '../types'

const STABLE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const JSON_POINTER = /^(?:\/(?:[^~/]|~[01])*)+$/
const PROTECTED_FIELD = /^(?:schema|version|id|.*Ids?|identity|.*Identit(?:y|ies)|slug|key|.*Keys?|number|.*Numbers?|hash|.*Hashes?|owner|status|createdAt|updatedAt|producer.*|receipt.*|sourceClaims?|sourceEvidence)$/i
const TERMINAL_CRITERIA = [
  'candidate-integrity',
  'domain-validation',
  'author-confirmation',
  'base-unchanged',
  'impact-plan-handoff',
] as const

export const TEXT_OPEN_WORLD_CREATOR_EDITABLE_ARTIFACT_KINDS_V1 = [
  'text-open-world.game-brief',
  'text-open-world.experience-contract',
  'text-open-world.protagonist-asset',
  'text-open-world.gameplay-ruleset-skeleton',
  'text-open-world.presentation-profile',
  'text-open-world.story-arc',
  'text-open-world.ending-contracts',
  'text-open-world.narrative-promises',
  'text-open-world.region-skeleton',
  'text-open-world.player-build',
  'text-open-world.mainline-thread',
  'text-open-world.significant-threads',
  'text-open-world.region-narrative-packs',
  'text-open-world.quest-skeletons',
  'text-open-world.content-requirement-manifest',
  'text-open-world.progression-catalogs',
  'text-open-world.enemy-encounter-catalog',
  'text-open-world.item-reward-catalog',
  'text-open-world.crafting-economy-catalog',
  'text-open-world.npc-runtime-catalog',
  'text-open-world.map-interaction-catalog',
  'text-open-world.quest-design-documents',
  'text-open-world.director-decks',
  'text-open-world.scene-scripts',
  'text-open-world.choice-contracts',
  'text-open-world.action-bindings',
  'text-open-world.system-configs',
  'text-open-world.media-requirements',
  'text-open-world.content-budget',
] as const satisfies readonly ProductBuildArtifactKindV1[]

export type TextOpenWorldCreatorEditableArtifactKindV1 =
  (typeof TEXT_OPEN_WORLD_CREATOR_EDITABLE_ARTIFACT_KINDS_V1)[number]

export const TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_LIMITS_V1 = Object.freeze({
  maximumEditableFields: 512,
  maximumPatchOperations: 64,
  maximumSiblingArtifacts: 8,
  maximumValidationIssues: 512,
  maximumReferenceChanges: 4_096,
  maximumValueUtf8Bytes: 1024 * 1024,
  maximumArtifactPayloadUtf8Bytes: 16 * 1024 * 1024,
  // Leave deterministic headroom for the checkpoint envelope, intent and
  // verification receipts under the global 32 MiB resume-payload ceiling.
  maximumCandidateUtf8Bytes: 24 * 1024 * 1024,
})

export type TextOpenWorldCreatorEditValueKindV1 =
  | 'string'
  | 'number'
  | 'boolean'
  | 'string-array'

export interface TextOpenWorldCreatorEditTargetV1 {
  schema: 'storyforge.text-open-world-creator-edit-target'
  version: 1
  artifactKey: TextOpenWorldCreatorEditableArtifactKindV1
  artifactVersion: number
  artifactKind: TextOpenWorldCreatorEditableArtifactKindV1
  artifactContentHash: string
  entityIdentity: string | null
  ownerTaskKey: string
}

export interface TextOpenWorldCreatorEditFieldV1 {
  schema: 'storyforge.text-open-world-creator-edit-field'
  version: 1
  fieldId: string
  artifactKey: TextOpenWorldCreatorEditableArtifactKindV1
  entityIdentity: string | null
  jsonPointer: string
  label: string
  valueKind: TextOpenWorldCreatorEditValueKindV1
  baseValueHash: string
  maximumUtf8Bytes: number
  mutationPolicy: 'replace-only'
  stableIdPolicy: 'preserve'
  entitySetPolicy: 'preserve'
  entityOrderPolicy: 'preserve'
}

export interface TextOpenWorldCreatorEditPatchOperationV1 {
  op: 'replace'
  fieldId: string
  baseValueHash: string
  value: unknown
}

export interface TextOpenWorldCreatorEditPatchV1 {
  schema: 'storyforge.text-open-world-creator-edit-patch'
  version: 1
  baseDraftHash: string
  operations: TextOpenWorldCreatorEditPatchOperationV1[]
  patchHash: string
}

export type TextOpenWorldCreatorEditValidationStatusV1 =
  | 'ready'
  | 'usable-with-warnings'
  | 'manual-repair'
  | 'blocked'

export interface TextOpenWorldCreatorEditValidationIssueV1 {
  code: string
  severity: 'warning' | 'error'
  artifactKey: TextOpenWorldCreatorEditableArtifactKindV1
  fieldId: string | null
  message: string
}

export interface TextOpenWorldCreatorEditValidatedArtifactV1 {
  artifactKey: TextOpenWorldCreatorEditableArtifactKindV1
  contentHash: string
}

export interface TextOpenWorldCreatorEditValidationV1 {
  schema: 'storyforge.text-open-world-creator-edit-validation'
  version: 1
  validatorId: string
  validatorVersion: string
  status: TextOpenWorldCreatorEditValidationStatusV1
  requiredGateIds: string[]
  passedGateIds: string[]
  validatedArtifacts: TextOpenWorldCreatorEditValidatedArtifactV1[]
  issues: TextOpenWorldCreatorEditValidationIssueV1[]
  validationHash: string
}

export interface TextOpenWorldCreatorEditBaseSiblingV1 {
  artifactKey: TextOpenWorldCreatorEditableArtifactKindV1
  requirementKey: string | null
  kind: TextOpenWorldCreatorEditableArtifactKindV1
  version: number
  status: 'accepted' | 'carried-forward'
  inputHash: string
  contentHash: string
  producerRunId: number
  producerReceiptHash: string
  parentArtifactHash: string | null
  carriedFrom: TextOpenWorldCreatorEditCarriedFromV1 | null
}

export interface TextOpenWorldCreatorEditCarriedFromV1 {
  buildNumber: number
  artifactKey: TextOpenWorldCreatorEditableArtifactKindV1
  version: number
  contentHash: string
  proofHash: string
}

export interface TextOpenWorldCreatorEditOwnerSiblingGroupV1 {
  schema: 'storyforge.text-open-world-creator-edit-owner-sibling-group'
  version: 1
  ownerTaskKey: string
  skillId: string
  dependencyTaskKeys: string[]
  outputArtifactKeys: TextOpenWorldCreatorEditableArtifactKindV1[]
  acceptanceGateIds: string[]
  baseSiblings: TextOpenWorldCreatorEditBaseSiblingV1[]
  baseGroupHash: string
}

export interface TextOpenWorldCreatorEditProducerEvidenceV1 {
  schema: 'storyforge.text-open-world-creator-edit-producer-evidence'
  version: 1
  proofKind: 'accepted-checkpoint' | 'carried-lineage'
  taskKey: string
  runId: number
  rootRunId: number
  attempt: number
  controlEpoch: number
  inputHash: string
  candidateHash: string
  checkpointHash: string | null
  terminalReceiptHash: string
  rootTerminalReceiptHash: string
  dependencies: Array<{ taskKey: string; receiptHash: string }>
  carriedLineageHash: string | null
}

export interface TextOpenWorldCreatorEditCarriedLineageHashInputV1 {
  taskKey: string
  controlEpoch: number
  inputHash: string
  candidateHash: string
  terminalReceiptHash: string
  /** Must remain in frozen Plan outputArtifactKeys order. */
  siblings: readonly TextOpenWorldCreatorEditBaseSiblingV1[]
}

export interface TextOpenWorldCreatorEditRebuiltArtifactV1 {
  schema: 'storyforge.text-open-world-creator-edit-rebuilt-artifact'
  version: 1
  artifactKey: TextOpenWorldCreatorEditableArtifactKindV1
  requirementKey: string | null
  kind: TextOpenWorldCreatorEditableArtifactKindV1
  baseVersion: number
  nextVersion: number
  baseContentHash: string
  contentHash: string
  payload: unknown
  metadata: unknown
  quality: unknown
  rights: unknown
  byteSize: number
}

export interface TextOpenWorldCreatorEditIdentityDeltaV1 {
  schema: 'storyforge.text-open-world-creator-edit-identity-delta'
  version: 1
  beforeCount: number
  afterCount: number
  beforeSequenceHash: string
  afterSequenceHash: string
  addedIdentities: string[]
  removedIdentities: string[]
  renamedIdentities: Array<{ before: string; after: string }>
  reordered: false
  deltaHash: string
}

export interface TextOpenWorldCreatorEditReferenceEdgeV1 {
  sourceIdentity: string
  fieldId: string
  targetIdentity: string
}

export interface TextOpenWorldCreatorEditReferenceDeltaV1 {
  schema: 'storyforge.text-open-world-creator-edit-reference-delta'
  version: 1
  beforeReferenceHash: string
  afterReferenceHash: string
  added: TextOpenWorldCreatorEditReferenceEdgeV1[]
  removed: TextOpenWorldCreatorEditReferenceEdgeV1[]
  danglingTargetIdentities: string[]
  deltaHash: string
}

export interface TextOpenWorldCreatorEditModelEvidenceV1 {
  schema: 'storyforge.text-open-world-creator-edit-model-evidence'
  version: 1
  provider: string
  model: string
  promptHash: string
  contextManifestHashes: string[]
  outputHash: string
}

export interface TextOpenWorldCreatorEditModelUsageV1 {
  modelCalls: number
  inputTokens: number
  outputTokens: number
  costUsd: number | null
  durationMs: number
}

export interface TextOpenWorldCreatorEditRevisionProvenanceV1 {
  source: 'deterministic-author-revision'
  originCandidateHash: string
  originPatchHash: string
  previousCandidateHash: string
  revisionPatchHash: string
  revisedAt: number
}

export interface TextOpenWorldCreatorEditCandidateV1 {
  schema: 'storyforge.text-open-world-creator-edit-candidate'
  version: 1
  portable: false
  production: {
    productionId: number
    productionKey: string
    stateRevision: number
  }
  baseBuild: {
    buildId: number
    buildNumber: number
    stateRevision: number
    controlEpoch: number
    planHash: string
    manifestHash: string
    rootTerminalReceiptHash: string
  }
  governanceSnapshotHash: string
  target: TextOpenWorldCreatorEditTargetV1
  editableFields: TextOpenWorldCreatorEditFieldV1[]
  ownerSiblingGroup: TextOpenWorldCreatorEditOwnerSiblingGroupV1
  producerEvidence: TextOpenWorldCreatorEditProducerEvidenceV1
  /** Hash of the resolver-produced, author-editable semantic projection. It is
   * deliberately distinct from target.artifactContentHash (the full payload). */
  baseDraftHash: string
  patch: TextOpenWorldCreatorEditPatchV1
  rebuiltArtifacts: TextOpenWorldCreatorEditRebuiltArtifactV1[]
  validation: TextOpenWorldCreatorEditValidationV1
  identityDelta: TextOpenWorldCreatorEditIdentityDeltaV1
  referenceDelta: TextOpenWorldCreatorEditReferenceDeltaV1
  mode: 'direct' | 'agent'
  /** Agent evidence always describes the originating draft. A later author
   * revision is made explicit below and never masquerades as model output. */
  modelEvidence: TextOpenWorldCreatorEditModelEvidenceV1 | null
  modelUsage: TextOpenWorldCreatorEditModelUsageV1
  revisionProvenance: TextOpenWorldCreatorEditRevisionProvenanceV1 | null
  status: TextOpenWorldCreatorEditValidationStatusV1
  createdAt: number
  candidateHash: string
}

export interface TextOpenWorldCreatorEditIntentV1 {
  schema: 'storyforge.text-open-world-creator-edit-intent'
  version: 1
  portable: false
  candidate: TextOpenWorldCreatorEditCandidateV1
  candidateHash: string
  warningAcknowledgementCodes: string[]
  warningAcknowledgementHash: string
  confirmedAt: number
  intentHash: string
}

export type TextOpenWorldCreatorEditTerminalCriterionIdV1 =
  (typeof TERMINAL_CRITERIA)[number]

export interface TextOpenWorldCreatorEditTerminalReceiptV1 {
  schema: 'storyforge.text-open-world-creator-edit-terminal-receipt'
  version: 1
  portable: false
  productionKey: string
  baseBuildNumber: number
  controlEpoch: number
  candidateHash: string
  validationHash: string
  intentHash: string
  status: 'impact-plan-required'
  criteria: Array<{
    id: TextOpenWorldCreatorEditTerminalCriterionIdV1
    evidenceHash: string
  }>
  completedAt: number
  receiptHash: string
}

function fail(message: string): never {
  throw new Error(`[text-open-world-creator-edit] ${message}`)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}

function jsonInput(value: unknown, label: string): unknown {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { fail(`${label} 不是合法 JSON`) }
}

function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const expected = [...keys].sort()
  const actual = Object.keys(value).sort()
  if (actual.length !== expected.length || expected.some((key, index) => key !== actual[index])) {
    fail(`${label} 字段不精确:${actual.join(',')}`)
  }
}

function text(value: unknown, label: string, maximum = 2_000): string {
  if (typeof value !== 'string') fail(`${label} 必须是字符串`)
  const normalized = value.trim().normalize('NFC')
  if (!normalized || normalized.length > maximum) fail(`${label} 为空或过长`)
  return normalized
}

function stableKey(value: unknown, label: string): string {
  const parsed = text(value, label, 200)
  if (!STABLE_KEY.test(parsed)) fail(`${label} 不是稳定 key`)
  return parsed
}

function nullableStableKey(value: unknown, label: string): string | null {
  return value === null ? null : stableKey(value, label)
}

function identity(value: unknown, label: string): string {
  return stableKey(value, label)
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) fail(`${label} 必须是正整数`)
  return Number(value)
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail(`${label} 必须是非负整数`)
  return Number(value)
}

function timestamp(value: unknown, label: string): number {
  return positiveInteger(value, label)
}

function sha(value: unknown, label: string): string {
  if (!isSha256Hash(value)) fail(`${label} 不是 SHA-256`)
  return value
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail(`${label} 枚举无效`)
  return value as T
}

function uniqueStableKeys(value: unknown, label: string, maximum: number, allowEmpty = true): string[] {
  if (!Array.isArray(value) || value.length > maximum || (!allowEmpty && value.length === 0)) {
    fail(`${label} 必须是有界数组`)
  }
  const parsed = value.map((entry, index) => stableKey(entry, `${label}[${index}]`))
  if (new Set(parsed).size !== parsed.length) fail(`${label} 不允许重复`)
  return parsed
}

function canonicalSet(value: unknown, label: string, maximum: number, allowEmpty = true): string[] {
  return uniqueStableKeys(value, label, maximum, allowEmpty).sort((left, right) => left.localeCompare(right))
}

function editableArtifactKind(value: unknown, label: string): TextOpenWorldCreatorEditableArtifactKindV1 {
  if (!isProductBuildArtifactKindV1(value)
    || !(TEXT_OPEN_WORLD_CREATOR_EDITABLE_ARTIFACT_KINDS_V1 as readonly string[]).includes(value)) {
    fail(`${label} 不是 Creator 可编辑 Artifact`)
  }
  return value as TextOpenWorldCreatorEditableArtifactKindV1
}

function canonicalJsonValue(value: unknown, label: string, maximumBytes: number): unknown {
  let canonical: string
  try {
    canonical = canonicalProductProductionJsonV2(value)
  } catch {
    fail(`${label} 不是 JSON 值`)
  }
  if (new TextEncoder().encode(canonical).byteLength > maximumBytes) fail(`${label} 超过字节上限`)
  return JSON.parse(canonical)
}

function canonicalBytes(value: unknown): number {
  return new TextEncoder().encode(canonicalProductProductionJsonV2(value)).byteLength
}

function parseJsonPointer(value: unknown, label: string): string {
  const parsed = text(value, label, 2_000)
  if (!JSON_POINTER.test(parsed)) fail(`${label} 不是合法 JSON Pointer`)
  const segments = parsed.slice(1).split('/').map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
  if (!segments.length || segments.some(segment => segment === '-' || segment.length === 0)) {
    fail(`${label} 不允许空段或集合追加`)
  }
  const leaf = segments[segments.length - 1]
  if (/^\d+$/.test(leaf) || PROTECTED_FIELD.test(leaf)) {
    fail(`${label} 指向稳定身份、集合成员或治理字段`)
  }
  return parsed
}

function parseValueForField(value: unknown, field: TextOpenWorldCreatorEditFieldV1, label: string): unknown {
  let parsed: unknown
  if (field.valueKind === 'string') {
    if (typeof value !== 'string') fail(`${label} 必须是字符串`)
    parsed = value.normalize('NFC')
  } else if (field.valueKind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label} 必须是有限数值`)
    parsed = Object.is(value, -0) ? 0 : value
  } else if (field.valueKind === 'boolean') {
    if (typeof value !== 'boolean') fail(`${label} 必须是 boolean`)
    parsed = value
  } else {
    if (!Array.isArray(value) || value.length > 256 || value.some(entry => typeof entry !== 'string')) {
      fail(`${label} 必须是有界字符串数组`)
    }
    parsed = value.map(entry => (entry as string).normalize('NFC'))
  }
  return canonicalJsonValue(parsed, label, field.maximumUtf8Bytes)
}

function warningCodes(validation: TextOpenWorldCreatorEditValidationV1): string[] {
  return [...new Set(validation.issues
    .filter(issue => issue.severity === 'warning')
    .map(issue => issue.code))].sort((left, right) => left.localeCompare(right))
}

function candidateBody(candidate: TextOpenWorldCreatorEditCandidateV1): Omit<TextOpenWorldCreatorEditCandidateV1, 'candidateHash'> {
  const { candidateHash: _candidateHash, ...body } = candidate
  return body
}

function intentBody(intent: TextOpenWorldCreatorEditIntentV1): Omit<TextOpenWorldCreatorEditIntentV1, 'intentHash'> {
  const { intentHash: _intentHash, ...body } = intent
  return body
}

function terminalReceiptBody(
  receipt: TextOpenWorldCreatorEditTerminalReceiptV1,
): Omit<TextOpenWorldCreatorEditTerminalReceiptV1, 'receiptHash'> {
  const { receiptHash: _receiptHash, ...body } = receipt
  return body
}

export function parseTextOpenWorldCreatorEditTargetV1(value: unknown): TextOpenWorldCreatorEditTargetV1 {
  const row = record(jsonInput(value, 'edit target'), 'edit target')
  exact(row, [
    'schema', 'version', 'artifactKey', 'artifactVersion', 'artifactKind',
    'artifactContentHash', 'entityIdentity', 'ownerTaskKey',
  ], 'edit target')
  if (row.schema !== 'storyforge.text-open-world-creator-edit-target' || row.version !== 1) {
    fail('edit target schema/version 无效')
  }
  const artifactKey = editableArtifactKind(row.artifactKey, 'edit target.artifactKey')
  const artifactKind = editableArtifactKind(row.artifactKind, 'edit target.artifactKind')
  if (artifactKey !== artifactKind) fail('edit target artifactKey/kind 不一致')
  return {
    schema: 'storyforge.text-open-world-creator-edit-target',
    version: 1,
    artifactKey,
    artifactVersion: positiveInteger(row.artifactVersion, 'edit target.artifactVersion'),
    artifactKind,
    artifactContentHash: sha(row.artifactContentHash, 'edit target.artifactContentHash'),
    entityIdentity: row.entityIdentity === null ? null : identity(row.entityIdentity, 'edit target.entityIdentity'),
    ownerTaskKey: stableKey(row.ownerTaskKey, 'edit target.ownerTaskKey'),
  }
}

export function parseTextOpenWorldCreatorEditFieldV1(value: unknown): TextOpenWorldCreatorEditFieldV1 {
  const row = record(jsonInput(value, 'edit field'), 'edit field')
  exact(row, [
    'schema', 'version', 'fieldId', 'artifactKey', 'entityIdentity', 'jsonPointer',
    'label', 'valueKind', 'baseValueHash', 'maximumUtf8Bytes', 'mutationPolicy',
    'stableIdPolicy', 'entitySetPolicy', 'entityOrderPolicy',
  ], 'edit field')
  if (row.schema !== 'storyforge.text-open-world-creator-edit-field' || row.version !== 1
    || row.mutationPolicy !== 'replace-only' || row.stableIdPolicy !== 'preserve'
    || row.entitySetPolicy !== 'preserve' || row.entityOrderPolicy !== 'preserve') {
    fail('edit field schema/version/policy 无效')
  }
  const maximumUtf8Bytes = positiveInteger(row.maximumUtf8Bytes, 'edit field.maximumUtf8Bytes')
  if (maximumUtf8Bytes > TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_LIMITS_V1.maximumValueUtf8Bytes) {
    fail('edit field.maximumUtf8Bytes 超过上限')
  }
  return {
    schema: 'storyforge.text-open-world-creator-edit-field',
    version: 1,
    fieldId: stableKey(row.fieldId, 'edit field.fieldId'),
    artifactKey: editableArtifactKind(row.artifactKey, 'edit field.artifactKey'),
    entityIdentity: row.entityIdentity === null ? null : identity(row.entityIdentity, 'edit field.entityIdentity'),
    jsonPointer: parseJsonPointer(row.jsonPointer, 'edit field.jsonPointer'),
    label: text(row.label, 'edit field.label', 500),
    valueKind: enumValue(row.valueKind, ['string', 'number', 'boolean', 'string-array'], 'edit field.valueKind'),
    baseValueHash: sha(row.baseValueHash, 'edit field.baseValueHash'),
    maximumUtf8Bytes,
    mutationPolicy: 'replace-only',
    stableIdPolicy: 'preserve',
    entitySetPolicy: 'preserve',
    entityOrderPolicy: 'preserve',
  }
}

function normalizedPatchOperations(value: unknown): TextOpenWorldCreatorEditPatchOperationV1[] {
  if (!Array.isArray(value) || value.length < 1
    || value.length > TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_LIMITS_V1.maximumPatchOperations) {
    fail('patch.operations 必须是非空有界数组')
  }
  const operations = value.map((entry, index) => {
    const row = record(entry, `patch.operations[${index}]`)
    exact(row, ['op', 'fieldId', 'baseValueHash', 'value'], `patch.operations[${index}]`)
    if (row.op !== 'replace') fail(`patch.operations[${index}] 只允许 replace`)
    return {
      op: 'replace' as const,
      fieldId: stableKey(row.fieldId, `patch.operations[${index}].fieldId`),
      baseValueHash: sha(row.baseValueHash, `patch.operations[${index}].baseValueHash`),
      value: canonicalJsonValue(
        row.value,
        `patch.operations[${index}].value`,
        TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_LIMITS_V1.maximumValueUtf8Bytes,
      ),
    }
  }).sort((left, right) => left.fieldId.localeCompare(right.fieldId))
  if (new Set(operations.map(operation => operation.fieldId)).size !== operations.length) {
    fail('patch.operations fieldId 不允许重复')
  }
  return operations
}

export async function hashTextOpenWorldCreatorEditPatchV1(
  input: Omit<TextOpenWorldCreatorEditPatchV1, 'patchHash'>,
): Promise<string> {
  return hashProductProductionValueV2({
    schema: input.schema,
    version: input.version,
    baseDraftHash: input.baseDraftHash,
    operations: [...input.operations].sort((left, right) => left.fieldId.localeCompare(right.fieldId)),
  })
}

export async function createTextOpenWorldCreatorEditPatchV1(input: {
  baseDraftHash: string
  operations: readonly TextOpenWorldCreatorEditPatchOperationV1[]
}): Promise<TextOpenWorldCreatorEditPatchV1> {
  const body: Omit<TextOpenWorldCreatorEditPatchV1, 'patchHash'> = {
    schema: 'storyforge.text-open-world-creator-edit-patch',
    version: 1,
    baseDraftHash: sha(input.baseDraftHash, 'edit patch.baseDraftHash'),
    operations: normalizedPatchOperations(input.operations),
  }
  return parseTextOpenWorldCreatorEditPatchV1({
    ...body,
    patchHash: await hashTextOpenWorldCreatorEditPatchV1(body),
  })
}

export async function parseTextOpenWorldCreatorEditPatchV1(value: unknown): Promise<TextOpenWorldCreatorEditPatchV1> {
  const row = record(jsonInput(value, 'edit patch'), 'edit patch')
  exact(row, ['schema', 'version', 'baseDraftHash', 'operations', 'patchHash'], 'edit patch')
  if (row.schema !== 'storyforge.text-open-world-creator-edit-patch' || row.version !== 1) {
    fail('edit patch schema/version 无效')
  }
  const parsed: TextOpenWorldCreatorEditPatchV1 = {
    schema: 'storyforge.text-open-world-creator-edit-patch',
    version: 1,
    baseDraftHash: sha(row.baseDraftHash, 'edit patch.baseDraftHash'),
    operations: normalizedPatchOperations(row.operations),
    patchHash: sha(row.patchHash, 'edit patch.patchHash'),
  }
  if (await hashTextOpenWorldCreatorEditPatchV1(parsed) !== parsed.patchHash) fail('edit patch hash 不匹配')
  return parsed
}

function parseValidatedArtifact(value: unknown, index: number): TextOpenWorldCreatorEditValidatedArtifactV1 {
  const row = record(value, `validation.validatedArtifacts[${index}]`)
  exact(row, ['artifactKey', 'contentHash'], `validation.validatedArtifacts[${index}]`)
  return {
    artifactKey: editableArtifactKind(row.artifactKey, `validation.validatedArtifacts[${index}].artifactKey`),
    contentHash: sha(row.contentHash, `validation.validatedArtifacts[${index}].contentHash`),
  }
}

function parseValidationIssue(value: unknown, index: number): TextOpenWorldCreatorEditValidationIssueV1 {
  const row = record(value, `validation.issues[${index}]`)
  exact(row, ['code', 'severity', 'artifactKey', 'fieldId', 'message'], `validation.issues[${index}]`)
  return {
    code: stableKey(row.code, `validation.issues[${index}].code`),
    severity: enumValue(row.severity, ['warning', 'error'], `validation.issues[${index}].severity`),
    artifactKey: editableArtifactKind(row.artifactKey, `validation.issues[${index}].artifactKey`),
    fieldId: row.fieldId === null ? null : stableKey(row.fieldId, `validation.issues[${index}].fieldId`),
    message: text(row.message, `validation.issues[${index}].message`, 4_000),
  }
}

function validationBody(
  validation: TextOpenWorldCreatorEditValidationV1,
): Omit<TextOpenWorldCreatorEditValidationV1, 'validationHash'> {
  const { validationHash: _validationHash, ...body } = validation
  return body
}

export function hashTextOpenWorldCreatorEditValidationV1(
  input: Omit<TextOpenWorldCreatorEditValidationV1, 'validationHash'>,
): Promise<string> {
  return hashProductProductionValueV2(input)
}

export async function parseTextOpenWorldCreatorEditValidationV1(
  value: unknown,
): Promise<TextOpenWorldCreatorEditValidationV1> {
  const row = record(jsonInput(value, 'edit validation'), 'edit validation')
  exact(row, [
    'schema', 'version', 'validatorId', 'validatorVersion', 'status', 'requiredGateIds',
    'passedGateIds', 'validatedArtifacts', 'issues', 'validationHash',
  ], 'edit validation')
  if (row.schema !== 'storyforge.text-open-world-creator-edit-validation' || row.version !== 1) {
    fail('edit validation schema/version 无效')
  }
  if (!Array.isArray(row.validatedArtifacts) || row.validatedArtifacts.length < 1
    || row.validatedArtifacts.length > TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_LIMITS_V1.maximumSiblingArtifacts) {
    fail('validation.validatedArtifacts 必须是非空有界数组')
  }
  if (!Array.isArray(row.issues)
    || row.issues.length > TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_LIMITS_V1.maximumValidationIssues) {
    fail('validation.issues 必须是有界数组')
  }
  const status = enumValue(row.status,
    ['ready', 'usable-with-warnings', 'manual-repair', 'blocked'], 'validation.status')
  const issues = row.issues.map(parseValidationIssue)
    .sort((left, right) => left.code.localeCompare(right.code)
      || (left.fieldId ?? '').localeCompare(right.fieldId ?? '')
      || left.message.localeCompare(right.message))
  const hasWarnings = issues.some(issue => issue.severity === 'warning')
  const hasErrors = issues.some(issue => issue.severity === 'error')
  if ((status === 'ready' && (hasWarnings || hasErrors))
    || (status === 'usable-with-warnings' && (!hasWarnings || hasErrors))
    || ((status === 'manual-repair' || status === 'blocked') && !hasErrors)) {
    fail('validation.status 与 issues 不一致')
  }
  const requiredGateIds = canonicalSet(row.requiredGateIds, 'validation.requiredGateIds', 256, false)
  const passedGateIds = canonicalSet(row.passedGateIds, 'validation.passedGateIds', 256)
  if ((status === 'ready' || status === 'usable-with-warnings')
    && requiredGateIds.some(gate => !passedGateIds.includes(gate))) {
    fail('可确认 validation 未通过全部 required gates')
  }
  const parsed: TextOpenWorldCreatorEditValidationV1 = {
    schema: 'storyforge.text-open-world-creator-edit-validation',
    version: 1,
    validatorId: stableKey(row.validatorId, 'validation.validatorId'),
    validatorVersion: text(row.validatorVersion, 'validation.validatorVersion', 100),
    status,
    requiredGateIds,
    passedGateIds,
    validatedArtifacts: row.validatedArtifacts.map(parseValidatedArtifact),
    issues,
    validationHash: sha(row.validationHash, 'validation.validationHash'),
  }
  if (new Set(parsed.validatedArtifacts.map(item => item.artifactKey)).size !== parsed.validatedArtifacts.length) {
    fail('validation.validatedArtifacts artifactKey 不允许重复')
  }
  if (await hashTextOpenWorldCreatorEditValidationV1(validationBody(parsed)) !== parsed.validationHash) {
    fail('edit validation hash 不匹配')
  }
  return parsed
}

function parseCarriedFrom(
  value: unknown,
  index: number,
): TextOpenWorldCreatorEditCarriedFromV1 {
  const row = record(value, `ownerSiblingGroup.baseSiblings[${index}].carriedFrom`)
  exact(row, [
    'buildNumber', 'artifactKey', 'version', 'contentHash', 'proofHash',
  ], `ownerSiblingGroup.baseSiblings[${index}].carriedFrom`)
  return {
    buildNumber: positiveInteger(row.buildNumber, `baseSiblings[${index}].carriedFrom.buildNumber`),
    artifactKey: editableArtifactKind(
      row.artifactKey,
      `baseSiblings[${index}].carriedFrom.artifactKey`,
    ),
    version: positiveInteger(row.version, `baseSiblings[${index}].carriedFrom.version`),
    contentHash: sha(row.contentHash, `baseSiblings[${index}].carriedFrom.contentHash`),
    proofHash: sha(row.proofHash, `baseSiblings[${index}].carriedFrom.proofHash`),
  }
}

function parseBaseSibling(value: unknown, index: number): TextOpenWorldCreatorEditBaseSiblingV1 {
  const row = record(value, `ownerSiblingGroup.baseSiblings[${index}]`)
  exact(row, [
    'artifactKey', 'requirementKey', 'kind', 'version', 'status', 'inputHash', 'contentHash',
    'producerRunId', 'producerReceiptHash', 'parentArtifactHash', 'carriedFrom',
  ], `ownerSiblingGroup.baseSiblings[${index}]`)
  const artifactKey = editableArtifactKind(row.artifactKey, `baseSiblings[${index}].artifactKey`)
  const kind = editableArtifactKind(row.kind, `baseSiblings[${index}].kind`)
  if (artifactKey !== kind) fail(`baseSiblings[${index}] artifactKey/kind 不一致`)
  const status = enumValue(
    row.status,
    ['accepted', 'carried-forward'],
    `baseSiblings[${index}].status`,
  )
  const contentHash = sha(row.contentHash, `baseSiblings[${index}].contentHash`)
  const parentArtifactHash = row.parentArtifactHash === null
    ? null
    : sha(row.parentArtifactHash, `baseSiblings[${index}].parentArtifactHash`)
  const carriedFrom = row.carriedFrom === null ? null : parseCarriedFrom(row.carriedFrom, index)
  if ((status === 'accepted' && (parentArtifactHash !== null || carriedFrom !== null))
    || (status === 'carried-forward' && (
      parentArtifactHash !== contentHash
      || carriedFrom === null
      || carriedFrom.artifactKey !== artifactKey
      || carriedFrom.contentHash !== contentHash
    ))) {
    fail(`baseSiblings[${index}] status/carried lineage 包络不闭合`)
  }
  return {
    artifactKey,
    requirementKey: nullableStableKey(row.requirementKey, `baseSiblings[${index}].requirementKey`),
    kind,
    version: positiveInteger(row.version, `baseSiblings[${index}].version`),
    status,
    inputHash: sha(row.inputHash, `baseSiblings[${index}].inputHash`),
    contentHash,
    producerRunId: positiveInteger(row.producerRunId, `baseSiblings[${index}].producerRunId`),
    producerReceiptHash: sha(row.producerReceiptHash, `baseSiblings[${index}].producerReceiptHash`),
    parentArtifactHash,
    carriedFrom,
  }
}

function ownerSiblingGroupBody(
  group: TextOpenWorldCreatorEditOwnerSiblingGroupV1,
): Omit<TextOpenWorldCreatorEditOwnerSiblingGroupV1, 'baseGroupHash'> {
  const { baseGroupHash: _baseGroupHash, ...body } = group
  return body
}

export function hashTextOpenWorldCreatorEditOwnerSiblingGroupV1(
  input: Omit<TextOpenWorldCreatorEditOwnerSiblingGroupV1, 'baseGroupHash'>,
): Promise<string> {
  return hashProductProductionValueV2(input)
}

async function parseOwnerSiblingGroup(value: unknown): Promise<TextOpenWorldCreatorEditOwnerSiblingGroupV1> {
  const row = record(value, 'ownerSiblingGroup')
  exact(row, [
    'schema', 'version', 'ownerTaskKey', 'skillId', 'dependencyTaskKeys', 'outputArtifactKeys',
    'acceptanceGateIds', 'baseSiblings', 'baseGroupHash',
  ], 'ownerSiblingGroup')
  if (row.schema !== 'storyforge.text-open-world-creator-edit-owner-sibling-group' || row.version !== 1) {
    fail('ownerSiblingGroup schema/version 无效')
  }
  if (!Array.isArray(row.outputArtifactKeys) || row.outputArtifactKeys.length < 1
    || row.outputArtifactKeys.length > TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_LIMITS_V1.maximumSiblingArtifacts) {
    fail('ownerSiblingGroup.outputArtifactKeys 必须是非空有界数组')
  }
  const outputArtifactKeys = row.outputArtifactKeys.map((entry, index) =>
    editableArtifactKind(entry, `ownerSiblingGroup.outputArtifactKeys[${index}]`))
  if (new Set(outputArtifactKeys).size !== outputArtifactKeys.length) fail('owner sibling key 不允许重复')
  if (!Array.isArray(row.baseSiblings) || row.baseSiblings.length !== outputArtifactKeys.length) {
    fail('owner sibling group 必须完整覆盖全部输出')
  }
  const parsed: TextOpenWorldCreatorEditOwnerSiblingGroupV1 = {
    schema: 'storyforge.text-open-world-creator-edit-owner-sibling-group',
    version: 1,
    ownerTaskKey: stableKey(row.ownerTaskKey, 'ownerSiblingGroup.ownerTaskKey'),
    skillId: stableKey(row.skillId, 'ownerSiblingGroup.skillId'),
    dependencyTaskKeys: uniqueStableKeys(
      row.dependencyTaskKeys,
      'ownerSiblingGroup.dependencyTaskKeys',
      256,
    ),
    outputArtifactKeys,
    // The shared carried-task receipt hashes gates in frozen Plan order.
    acceptanceGateIds: uniqueStableKeys(
      row.acceptanceGateIds,
      'ownerSiblingGroup.acceptanceGateIds',
      256,
      false,
    ),
    baseSiblings: row.baseSiblings.map(parseBaseSibling),
    baseGroupHash: sha(row.baseGroupHash, 'ownerSiblingGroup.baseGroupHash'),
  }
  if (parsed.baseSiblings.some((sibling, index) => sibling.artifactKey !== outputArtifactKeys[index])) {
    fail('owner sibling 顺序必须与 Plan outputArtifactKeys 一致')
  }
  if (await hashTextOpenWorldCreatorEditOwnerSiblingGroupV1(ownerSiblingGroupBody(parsed))
    !== parsed.baseGroupHash) fail('owner sibling group hash 不匹配')
  return parsed
}

export function hashTextOpenWorldCreatorEditCarriedLineageV1(
  input: TextOpenWorldCreatorEditCarriedLineageHashInputV1,
): Promise<string> {
  return hashProductProductionValueV2({
    schema: 'storyforge.text-open-world-creator-edit-carried-lineage',
    version: 1,
    taskKey: input.taskKey,
    controlEpoch: input.controlEpoch,
    inputHash: input.inputHash,
    candidateHash: input.candidateHash,
    terminalReceiptHash: input.terminalReceiptHash,
    siblings: input.siblings.map(sibling => ({
      artifactKey: sibling.artifactKey,
      version: sibling.version,
      contentHash: sibling.contentHash,
      parentArtifactHash: sibling.parentArtifactHash,
      carriedFrom: sibling.carriedFrom,
    })),
  })
}

function parseProducerDependencies(value: unknown): Array<{ taskKey: string; receiptHash: string }> {
  if (!Array.isArray(value) || value.length > 256) {
    fail('producerEvidence.dependencies 必须是有界数组')
  }
  const parsed = value.map((entry, index) => {
    const row = record(entry, `producerEvidence.dependencies[${index}]`)
    exact(row, ['taskKey', 'receiptHash'], `producerEvidence.dependencies[${index}]`)
    return {
      taskKey: stableKey(row.taskKey, `producerEvidence.dependencies[${index}].taskKey`),
      receiptHash: sha(row.receiptHash, `producerEvidence.dependencies[${index}].receiptHash`),
    }
  })
  if (new Set(parsed.map(item => item.taskKey)).size !== parsed.length) {
    fail('producerEvidence.dependencies taskKey 不允许重复')
  }
  return parsed
}

function parseProducerEvidence(value: unknown): TextOpenWorldCreatorEditProducerEvidenceV1 {
  const row = record(value, 'producerEvidence')
  exact(row, [
    'schema', 'version', 'proofKind', 'taskKey', 'runId', 'rootRunId', 'attempt', 'controlEpoch',
    'inputHash', 'candidateHash', 'checkpointHash', 'terminalReceiptHash', 'rootTerminalReceiptHash',
    'dependencies', 'carriedLineageHash',
  ], 'producerEvidence')
  if (row.schema !== 'storyforge.text-open-world-creator-edit-producer-evidence' || row.version !== 1) {
    fail('producerEvidence schema/version 无效')
  }
  const proofKind = enumValue(
    row.proofKind,
    ['accepted-checkpoint', 'carried-lineage'],
    'producerEvidence.proofKind',
  )
  const checkpointHash = row.checkpointHash === null
    ? null
    : sha(row.checkpointHash, 'producerEvidence.checkpointHash')
  const carriedLineageHash = row.carriedLineageHash === null
    ? null
    : sha(row.carriedLineageHash, 'producerEvidence.carriedLineageHash')
  const attempt = positiveInteger(row.attempt, 'producerEvidence.attempt')
  const dependencies = parseProducerDependencies(row.dependencies)
  if ((proofKind === 'accepted-checkpoint'
    && (checkpointHash === null || carriedLineageHash !== null || dependencies.length !== 0))
    || (proofKind === 'carried-lineage'
      && (checkpointHash !== null || carriedLineageHash === null || attempt !== 1))) {
    fail('producerEvidence proofKind/checkpoint/lineage/dependencies 不闭合')
  }
  return {
    schema: 'storyforge.text-open-world-creator-edit-producer-evidence',
    version: 1,
    proofKind,
    taskKey: stableKey(row.taskKey, 'producerEvidence.taskKey'),
    runId: positiveInteger(row.runId, 'producerEvidence.runId'),
    rootRunId: positiveInteger(row.rootRunId, 'producerEvidence.rootRunId'),
    attempt,
    controlEpoch: nonNegativeInteger(row.controlEpoch, 'producerEvidence.controlEpoch'),
    inputHash: sha(row.inputHash, 'producerEvidence.inputHash'),
    candidateHash: sha(row.candidateHash, 'producerEvidence.candidateHash'),
    checkpointHash,
    terminalReceiptHash: sha(row.terminalReceiptHash, 'producerEvidence.terminalReceiptHash'),
    rootTerminalReceiptHash: sha(row.rootTerminalReceiptHash, 'producerEvidence.rootTerminalReceiptHash'),
    dependencies,
    carriedLineageHash,
  }
}

async function parseRebuiltArtifact(value: unknown, index: number): Promise<TextOpenWorldCreatorEditRebuiltArtifactV1> {
  const row = record(value, `rebuiltArtifacts[${index}]`)
  exact(row, [
    'schema', 'version', 'artifactKey', 'requirementKey', 'kind', 'baseVersion', 'nextVersion',
    'baseContentHash', 'contentHash', 'payload', 'metadata', 'quality', 'rights', 'byteSize',
  ], `rebuiltArtifacts[${index}]`)
  if (row.schema !== 'storyforge.text-open-world-creator-edit-rebuilt-artifact' || row.version !== 1) {
    fail(`rebuiltArtifacts[${index}] schema/version 无效`)
  }
  const artifactKey = editableArtifactKind(row.artifactKey, `rebuiltArtifacts[${index}].artifactKey`)
  const kind = editableArtifactKind(row.kind, `rebuiltArtifacts[${index}].kind`)
  if (artifactKey !== kind) fail(`rebuiltArtifacts[${index}] artifactKey/kind 不一致`)
  const baseVersion = positiveInteger(row.baseVersion, `rebuiltArtifacts[${index}].baseVersion`)
  const nextVersion = positiveInteger(row.nextVersion, `rebuiltArtifacts[${index}].nextVersion`)
  if (nextVersion !== baseVersion + 1) fail(`rebuiltArtifacts[${index}] nextVersion 必须连续递增`)
  const payload = canonicalJsonValue(
    row.payload,
    `rebuiltArtifacts[${index}].payload`,
    TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_LIMITS_V1.maximumArtifactPayloadUtf8Bytes,
  )
  const metadata = canonicalJsonValue(row.metadata, `rebuiltArtifacts[${index}].metadata`, 1024 * 1024)
  const quality = canonicalJsonValue(row.quality, `rebuiltArtifacts[${index}].quality`, 1024 * 1024)
  const rights = canonicalJsonValue(row.rights, `rebuiltArtifacts[${index}].rights`, 1024 * 1024)
  const byteSize = nonNegativeInteger(row.byteSize, `rebuiltArtifacts[${index}].byteSize`)
  if (byteSize !== canonicalBytes(payload)) fail(`rebuiltArtifacts[${index}] byteSize 不匹配`)
  const contentHash = sha(row.contentHash, `rebuiltArtifacts[${index}].contentHash`)
  if (await hashProductProductionValueV2(payload) !== contentHash) {
    fail(`rebuiltArtifacts[${index}] contentHash 不匹配`)
  }
  return {
    schema: 'storyforge.text-open-world-creator-edit-rebuilt-artifact',
    version: 1,
    artifactKey,
    requirementKey: nullableStableKey(row.requirementKey, `rebuiltArtifacts[${index}].requirementKey`),
    kind,
    baseVersion,
    nextVersion,
    baseContentHash: sha(row.baseContentHash, `rebuiltArtifacts[${index}].baseContentHash`),
    contentHash,
    payload,
    metadata,
    quality,
    rights,
    byteSize,
  }
}

function identityDeltaBody(
  delta: TextOpenWorldCreatorEditIdentityDeltaV1,
): Omit<TextOpenWorldCreatorEditIdentityDeltaV1, 'deltaHash'> {
  const { deltaHash: _deltaHash, ...body } = delta
  return body
}

export function hashTextOpenWorldCreatorEditIdentityDeltaV1(
  input: Omit<TextOpenWorldCreatorEditIdentityDeltaV1, 'deltaHash'>,
): Promise<string> {
  return hashProductProductionValueV2(input)
}

async function parseIdentityDelta(value: unknown): Promise<TextOpenWorldCreatorEditIdentityDeltaV1> {
  const row = record(value, 'identityDelta')
  exact(row, [
    'schema', 'version', 'beforeCount', 'afterCount', 'beforeSequenceHash', 'afterSequenceHash',
    'addedIdentities', 'removedIdentities', 'renamedIdentities', 'reordered', 'deltaHash',
  ], 'identityDelta')
  if (row.schema !== 'storyforge.text-open-world-creator-edit-identity-delta' || row.version !== 1) {
    fail('identityDelta schema/version 无效')
  }
  if (!Array.isArray(row.renamedIdentities)
    || row.renamedIdentities.length
      > TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_LIMITS_V1.maximumReferenceChanges) {
    fail('identityDelta.renamedIdentities 必须是有界数组')
  }
  const renamedIdentities = row.renamedIdentities.map((entry, index) => {
    const item = record(entry, `identityDelta.renamedIdentities[${index}]`)
    exact(item, ['before', 'after'], `identityDelta.renamedIdentities[${index}]`)
    return {
      before: identity(item.before, `identityDelta.renamedIdentities[${index}].before`),
      after: identity(item.after, `identityDelta.renamedIdentities[${index}].after`),
    }
  })
  const parsed: TextOpenWorldCreatorEditIdentityDeltaV1 = {
    schema: 'storyforge.text-open-world-creator-edit-identity-delta',
    version: 1,
    beforeCount: nonNegativeInteger(row.beforeCount, 'identityDelta.beforeCount'),
    afterCount: nonNegativeInteger(row.afterCount, 'identityDelta.afterCount'),
    beforeSequenceHash: sha(row.beforeSequenceHash, 'identityDelta.beforeSequenceHash'),
    afterSequenceHash: sha(row.afterSequenceHash, 'identityDelta.afterSequenceHash'),
    addedIdentities: canonicalSet(row.addedIdentities, 'identityDelta.addedIdentities', 4_096),
    removedIdentities: canonicalSet(row.removedIdentities, 'identityDelta.removedIdentities', 4_096),
    renamedIdentities,
    reordered: row.reordered === false ? false : fail('identityDelta.reordered 必须为 false'),
    deltaHash: sha(row.deltaHash, 'identityDelta.deltaHash'),
  }
  if (parsed.beforeCount !== parsed.afterCount
    || parsed.beforeSequenceHash !== parsed.afterSequenceHash
    || parsed.addedIdentities.length || parsed.removedIdentities.length || parsed.renamedIdentities.length) {
    fail('Creator edit 不允许改变稳定 ID、实体集合或实体顺序')
  }
  if (await hashTextOpenWorldCreatorEditIdentityDeltaV1(identityDeltaBody(parsed)) !== parsed.deltaHash) {
    fail('identityDelta hash 不匹配')
  }
  return parsed
}

function parseReferenceEdge(value: unknown, label: string): TextOpenWorldCreatorEditReferenceEdgeV1 {
  const row = record(value, label)
  exact(row, ['sourceIdentity', 'fieldId', 'targetIdentity'], label)
  return {
    sourceIdentity: identity(row.sourceIdentity, `${label}.sourceIdentity`),
    fieldId: stableKey(row.fieldId, `${label}.fieldId`),
    targetIdentity: identity(row.targetIdentity, `${label}.targetIdentity`),
  }
}

function referenceEdgeKey(edge: TextOpenWorldCreatorEditReferenceEdgeV1): string {
  return `${edge.sourceIdentity}\u0000${edge.fieldId}\u0000${edge.targetIdentity}`
}

function referenceDeltaBody(
  delta: TextOpenWorldCreatorEditReferenceDeltaV1,
): Omit<TextOpenWorldCreatorEditReferenceDeltaV1, 'deltaHash'> {
  const { deltaHash: _deltaHash, ...body } = delta
  return body
}

export function hashTextOpenWorldCreatorEditReferenceDeltaV1(
  input: Omit<TextOpenWorldCreatorEditReferenceDeltaV1, 'deltaHash'>,
): Promise<string> {
  return hashProductProductionValueV2(input)
}

async function parseReferenceDelta(value: unknown): Promise<TextOpenWorldCreatorEditReferenceDeltaV1> {
  const row = record(value, 'referenceDelta')
  exact(row, [
    'schema', 'version', 'beforeReferenceHash', 'afterReferenceHash', 'added', 'removed',
    'danglingTargetIdentities', 'deltaHash',
  ], 'referenceDelta')
  if (row.schema !== 'storyforge.text-open-world-creator-edit-reference-delta' || row.version !== 1) {
    fail('referenceDelta schema/version 无效')
  }
  const parseEdges = (input: unknown, label: string) => {
    if (!Array.isArray(input)
      || input.length > TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_LIMITS_V1.maximumReferenceChanges) {
      fail(`${label} 必须是有界数组`)
    }
    const edges = input.map((entry, index) => parseReferenceEdge(entry, `${label}[${index}]`))
      .sort((left, right) => referenceEdgeKey(left).localeCompare(referenceEdgeKey(right)))
    if (new Set(edges.map(referenceEdgeKey)).size !== edges.length) fail(`${label} 不允许重复`)
    return edges
  }
  const parsed: TextOpenWorldCreatorEditReferenceDeltaV1 = {
    schema: 'storyforge.text-open-world-creator-edit-reference-delta',
    version: 1,
    beforeReferenceHash: sha(row.beforeReferenceHash, 'referenceDelta.beforeReferenceHash'),
    afterReferenceHash: sha(row.afterReferenceHash, 'referenceDelta.afterReferenceHash'),
    added: parseEdges(row.added, 'referenceDelta.added'),
    removed: parseEdges(row.removed, 'referenceDelta.removed'),
    danglingTargetIdentities: canonicalSet(
      row.danglingTargetIdentities,
      'referenceDelta.danglingTargetIdentities',
      TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_LIMITS_V1.maximumReferenceChanges,
    ),
    deltaHash: sha(row.deltaHash, 'referenceDelta.deltaHash'),
  }
  const removed = new Set(parsed.removed.map(referenceEdgeKey))
  if (parsed.added.some(edge => removed.has(referenceEdgeKey(edge)))) {
    fail('referenceDelta 同一边不能同时 added/removed')
  }
  if (await hashTextOpenWorldCreatorEditReferenceDeltaV1(referenceDeltaBody(parsed)) !== parsed.deltaHash) {
    fail('referenceDelta hash 不匹配')
  }
  return parsed
}

function parseModelEvidence(value: unknown): TextOpenWorldCreatorEditModelEvidenceV1 {
  const row = record(value, 'modelEvidence')
  exact(row, [
    'schema', 'version', 'provider', 'model', 'promptHash', 'contextManifestHashes', 'outputHash',
  ], 'modelEvidence')
  if (row.schema !== 'storyforge.text-open-world-creator-edit-model-evidence' || row.version !== 1) {
    fail('modelEvidence schema/version 无效')
  }
  if (!Array.isArray(row.contextManifestHashes) || row.contextManifestHashes.length < 1
    || row.contextManifestHashes.length > 256) fail('modelEvidence.contextManifestHashes 必须是非空有界数组')
  const contextManifestHashes = row.contextManifestHashes.map((hash, index) =>
    sha(hash, `modelEvidence.contextManifestHashes[${index}]`)).sort()
  if (new Set(contextManifestHashes).size !== contextManifestHashes.length) {
    fail('modelEvidence.contextManifestHashes 不允许重复')
  }
  return {
    schema: 'storyforge.text-open-world-creator-edit-model-evidence',
    version: 1,
    provider: stableKey(row.provider, 'modelEvidence.provider'),
    model: text(row.model, 'modelEvidence.model', 500),
    promptHash: sha(row.promptHash, 'modelEvidence.promptHash'),
    contextManifestHashes,
    outputHash: sha(row.outputHash, 'modelEvidence.outputHash'),
  }
}

function parseModelUsage(value: unknown): TextOpenWorldCreatorEditModelUsageV1 {
  const row = record(value, 'modelUsage')
  exact(row, ['modelCalls', 'inputTokens', 'outputTokens', 'costUsd', 'durationMs'], 'modelUsage')
  if (row.costUsd !== null && (typeof row.costUsd !== 'number'
    || !Number.isFinite(row.costUsd) || row.costUsd < 0 || row.costUsd > 1_000_000)) {
    fail('modelUsage.costUsd 无效')
  }
  return {
    modelCalls: nonNegativeInteger(row.modelCalls, 'modelUsage.modelCalls'),
    inputTokens: nonNegativeInteger(row.inputTokens, 'modelUsage.inputTokens'),
    outputTokens: nonNegativeInteger(row.outputTokens, 'modelUsage.outputTokens'),
    costUsd: row.costUsd as number | null,
    durationMs: nonNegativeInteger(row.durationMs, 'modelUsage.durationMs'),
  }
}

function parseRevisionProvenance(
  value: unknown,
): TextOpenWorldCreatorEditRevisionProvenanceV1 | null {
  if (value === null) return null
  const row = record(value, 'revisionProvenance')
  exact(row, [
    'source', 'originCandidateHash', 'originPatchHash', 'previousCandidateHash',
    'revisionPatchHash', 'revisedAt',
  ], 'revisionProvenance')
  if (row.source !== 'deterministic-author-revision') {
    fail('revisionProvenance.source 无效')
  }
  return {
    source: 'deterministic-author-revision',
    originCandidateHash: sha(row.originCandidateHash, 'revisionProvenance.originCandidateHash'),
    originPatchHash: sha(row.originPatchHash, 'revisionProvenance.originPatchHash'),
    previousCandidateHash: sha(row.previousCandidateHash, 'revisionProvenance.previousCandidateHash'),
    revisionPatchHash: sha(row.revisionPatchHash, 'revisionProvenance.revisionPatchHash'),
    revisedAt: timestamp(row.revisedAt, 'revisionProvenance.revisedAt'),
  }
}

function parseProductionBinding(value: unknown): TextOpenWorldCreatorEditCandidateV1['production'] {
  const row = record(value, 'candidate.production')
  exact(row, ['productionId', 'productionKey', 'stateRevision'], 'candidate.production')
  return {
    productionId: positiveInteger(row.productionId, 'candidate.production.productionId'),
    productionKey: stableKey(row.productionKey, 'candidate.production.productionKey'),
    stateRevision: nonNegativeInteger(row.stateRevision, 'candidate.production.stateRevision'),
  }
}

function parseBuildBinding(value: unknown): TextOpenWorldCreatorEditCandidateV1['baseBuild'] {
  const row = record(value, 'candidate.baseBuild')
  exact(row, [
    'buildId', 'buildNumber', 'stateRevision', 'controlEpoch', 'planHash', 'manifestHash',
    'rootTerminalReceiptHash',
  ], 'candidate.baseBuild')
  return {
    buildId: positiveInteger(row.buildId, 'candidate.baseBuild.buildId'),
    buildNumber: positiveInteger(row.buildNumber, 'candidate.baseBuild.buildNumber'),
    stateRevision: nonNegativeInteger(row.stateRevision, 'candidate.baseBuild.stateRevision'),
    controlEpoch: nonNegativeInteger(row.controlEpoch, 'candidate.baseBuild.controlEpoch'),
    planHash: sha(row.planHash, 'candidate.baseBuild.planHash'),
    manifestHash: sha(row.manifestHash, 'candidate.baseBuild.manifestHash'),
    rootTerminalReceiptHash: sha(row.rootTerminalReceiptHash, 'candidate.baseBuild.rootTerminalReceiptHash'),
  }
}

export function hashTextOpenWorldCreatorEditCandidateV1(
  input: Omit<TextOpenWorldCreatorEditCandidateV1, 'candidateHash'>,
): Promise<string> {
  return hashProductProductionValueV2(input)
}

export async function hashTextOpenWorldCreatorEditBaseStateV1(
  candidate: Pick<TextOpenWorldCreatorEditCandidateV1,
    'production' | 'baseBuild' | 'governanceSnapshotHash' | 'ownerSiblingGroup' | 'producerEvidence'>,
): Promise<string> {
  return hashProductProductionValueV2({
    schema: 'storyforge.text-open-world-creator-edit-base-state',
    version: 1,
    production: candidate.production,
    baseBuild: candidate.baseBuild,
    governanceSnapshotHash: candidate.governanceSnapshotHash,
    ownerSiblingGroupHash: candidate.ownerSiblingGroup.baseGroupHash,
    producerTerminalReceiptHash: candidate.producerEvidence.terminalReceiptHash,
  })
}

export async function parseTextOpenWorldCreatorEditCandidateV1(
  value: unknown,
): Promise<TextOpenWorldCreatorEditCandidateV1> {
  const row = record(jsonInput(value, 'edit candidate'), 'edit candidate')
  exact(row, [
    'schema', 'version', 'portable', 'production', 'baseBuild', 'governanceSnapshotHash',
    'target', 'editableFields', 'ownerSiblingGroup', 'producerEvidence', 'baseDraftHash',
    'patch', 'rebuiltArtifacts', 'validation', 'identityDelta', 'referenceDelta', 'mode',
    'modelEvidence', 'modelUsage', 'revisionProvenance', 'status', 'createdAt', 'candidateHash',
  ], 'edit candidate')
  if (row.schema !== 'storyforge.text-open-world-creator-edit-candidate'
    || row.version !== 1 || row.portable !== false) fail('edit candidate schema/version/portable 无效')
  if (!Array.isArray(row.editableFields) || row.editableFields.length < 1
    || row.editableFields.length > TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_LIMITS_V1.maximumEditableFields) {
    fail('candidate.editableFields 必须是非空有界数组')
  }
  if (!Array.isArray(row.rebuiltArtifacts) || row.rebuiltArtifacts.length < 1
    || row.rebuiltArtifacts.length > TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_LIMITS_V1.maximumSiblingArtifacts) {
    fail('candidate.rebuiltArtifacts 必须是非空有界数组')
  }
  const production = parseProductionBinding(row.production)
  const baseBuild = parseBuildBinding(row.baseBuild)
  const target = parseTextOpenWorldCreatorEditTargetV1(row.target)
  const editableFields = row.editableFields.map(parseTextOpenWorldCreatorEditFieldV1)
    .sort((left, right) => left.fieldId.localeCompare(right.fieldId))
  const ownerSiblingGroup = await parseOwnerSiblingGroup(row.ownerSiblingGroup)
  const producerEvidence = parseProducerEvidence(row.producerEvidence)
  const patch = await parseTextOpenWorldCreatorEditPatchV1(row.patch)
  const rebuiltArtifacts: TextOpenWorldCreatorEditRebuiltArtifactV1[] = []
  for (let index = 0; index < row.rebuiltArtifacts.length; index += 1) {
    rebuiltArtifacts.push(await parseRebuiltArtifact(row.rebuiltArtifacts[index], index))
  }
  const validation = await parseTextOpenWorldCreatorEditValidationV1(row.validation)
  const identityDelta = await parseIdentityDelta(row.identityDelta)
  const referenceDelta = await parseReferenceDelta(row.referenceDelta)
  const mode = enumValue(row.mode, ['direct', 'agent'], 'candidate.mode')
  const modelEvidence = row.modelEvidence === null ? null : parseModelEvidence(row.modelEvidence)
  const modelUsage = parseModelUsage(row.modelUsage)
  const revisionProvenance = parseRevisionProvenance(row.revisionProvenance)
  const status = enumValue(row.status,
    ['ready', 'usable-with-warnings', 'manual-repair', 'blocked'], 'candidate.status')
  const parsed: TextOpenWorldCreatorEditCandidateV1 = {
    schema: 'storyforge.text-open-world-creator-edit-candidate',
    version: 1,
    portable: false,
    production,
    baseBuild,
    governanceSnapshotHash: sha(row.governanceSnapshotHash, 'candidate.governanceSnapshotHash'),
    target,
    editableFields,
    ownerSiblingGroup,
    producerEvidence,
    baseDraftHash: sha(row.baseDraftHash, 'candidate.baseDraftHash'),
    patch,
    rebuiltArtifacts,
    validation,
    identityDelta,
    referenceDelta,
    mode,
    modelEvidence,
    modelUsage,
    revisionProvenance,
    status,
    createdAt: timestamp(row.createdAt, 'candidate.createdAt'),
    candidateHash: sha(row.candidateHash, 'candidate.candidateHash'),
  }

  const fieldIds = editableFields.map(field => field.fieldId)
  if (new Set(fieldIds).size !== fieldIds.length
    || new Set(editableFields.map(field => field.jsonPointer)).size !== editableFields.length) {
    fail('candidate.editableFields fieldId/jsonPointer 不允许重复')
  }
  if (editableFields.some(field => field.artifactKey !== target.artifactKey
    || field.entityIdentity !== target.entityIdentity)) {
    fail('candidate.editableFields 必须全部属于选中 target')
  }
  const fieldById = new Map(editableFields.map(field => [field.fieldId, field]))
  for (const [index, operation] of patch.operations.entries()) {
    const field = fieldById.get(operation.fieldId)
    if (!field) fail(`patch.operations[${index}] 不在 editableFields allowlist`)
    if (field.baseValueHash !== operation.baseValueHash) fail(`patch.operations[${index}] baseValueHash 不一致`)
    operation.value = parseValueForField(operation.value, field, `patch.operations[${index}].value`)
  }
  // Value normalization above is part of the patch identity. It normally does
  // not change parser-normalized input, but always recheck before acceptance.
  if (await hashTextOpenWorldCreatorEditPatchV1(patch) !== patch.patchHash) fail('normalized patch hash 不匹配')

  if (ownerSiblingGroup.ownerTaskKey !== target.ownerTaskKey
    || !ownerSiblingGroup.outputArtifactKeys.includes(target.artifactKey)) {
    fail('target 不属于 owner sibling group')
  }
  if (producerEvidence.taskKey !== ownerSiblingGroup.ownerTaskKey
    || producerEvidence.controlEpoch !== baseBuild.controlEpoch
    || producerEvidence.rootTerminalReceiptHash !== baseBuild.rootTerminalReceiptHash) {
    fail('producer evidence 与 owner/base Build 不闭合')
  }
  if (ownerSiblingGroup.baseSiblings.some(sibling =>
    sibling.producerRunId !== producerEvidence.runId
    || sibling.producerReceiptHash !== producerEvidence.terminalReceiptHash
    || sibling.inputHash !== producerEvidence.inputHash)) {
    fail('owner sibling producer 证据不一致')
  }
  const siblingStatuses = new Set(ownerSiblingGroup.baseSiblings.map(sibling => sibling.status))
  if (siblingStatuses.size !== 1
    || (producerEvidence.proofKind === 'accepted-checkpoint' && !siblingStatuses.has('accepted'))
    || (producerEvidence.proofKind === 'carried-lineage' && !siblingStatuses.has('carried-forward'))) {
    fail('owner sibling status 与 producer proofKind 不一致')
  }
  if (producerEvidence.proofKind === 'carried-lineage') {
    const dependencyTaskKeys = producerEvidence.dependencies.map(dependency => dependency.taskKey)
    if (dependencyTaskKeys.length !== ownerSiblingGroup.dependencyTaskKeys.length
      || dependencyTaskKeys.some((taskKey, index) => (
        taskKey !== ownerSiblingGroup.dependencyTaskKeys[index]
      ))) {
      fail('carried producer dependencies 未按 Plan dependsOn 顺序完整绑定')
    }
    const lineageBuildNumbers = new Set(ownerSiblingGroup.baseSiblings.map(
      sibling => sibling.carriedFrom!.buildNumber,
    ))
    if (lineageBuildNumbers.size !== 1) {
      fail('carried owner sibling group 必须来自同一历史 Build')
    }
    for (const [index, sibling] of ownerSiblingGroup.baseSiblings.entries()) {
      const carriedFrom = sibling.carriedFrom!
      if (carriedFrom.buildNumber > baseBuild.buildNumber
        || (carriedFrom.buildNumber === baseBuild.buildNumber
          && carriedFrom.version >= sibling.version)) {
        fail(`baseSiblings[${index}] carriedFrom 不是严格历史版本`)
      }
    }
    const syntheticCandidateHash = await hashProductProductionCarriedCandidateV1(
      ownerSiblingGroup.baseSiblings,
    )
    const syntheticReceiptHash = await hashProductProductionCarriedReceiptV1({
      taskKey: ownerSiblingGroup.ownerTaskKey,
      inputHash: producerEvidence.inputHash,
      candidateHash: syntheticCandidateHash,
      dependencies: producerEvidence.dependencies,
      passedGateIds: ownerSiblingGroup.acceptanceGateIds,
      controlEpoch: baseBuild.controlEpoch,
    })
    const carriedLineageHash = await hashTextOpenWorldCreatorEditCarriedLineageV1({
      taskKey: ownerSiblingGroup.ownerTaskKey,
      controlEpoch: baseBuild.controlEpoch,
      inputHash: producerEvidence.inputHash,
      candidateHash: syntheticCandidateHash,
      terminalReceiptHash: syntheticReceiptHash,
      siblings: ownerSiblingGroup.baseSiblings,
    })
    if (producerEvidence.candidateHash !== syntheticCandidateHash
      || producerEvidence.terminalReceiptHash !== syntheticReceiptHash
      || producerEvidence.carriedLineageHash !== carriedLineageHash) {
      fail('carried producer synthetic candidate/receipt/lineage hash 不闭合')
    }
  }
  const targetSibling = ownerSiblingGroup.baseSiblings.find(sibling => sibling.artifactKey === target.artifactKey)
  if (!targetSibling || targetSibling.version !== target.artifactVersion
    || targetSibling.contentHash !== target.artifactContentHash
    || patch.baseDraftHash !== parsed.baseDraftHash) {
    fail('target/base draft/base sibling 身份不闭合')
  }
  if (rebuiltArtifacts.length !== ownerSiblingGroup.outputArtifactKeys.length
    || rebuiltArtifacts.some((artifact, index) => artifact.artifactKey !== ownerSiblingGroup.outputArtifactKeys[index])) {
    fail('rebuiltArtifacts 必须按 Plan 顺序完整覆盖 owner sibling group')
  }
  for (let index = 0; index < rebuiltArtifacts.length; index += 1) {
    const rebuilt = rebuiltArtifacts[index]
    const base = ownerSiblingGroup.baseSiblings[index]
    if (rebuilt.requirementKey !== base.requirementKey || rebuilt.kind !== base.kind
      || rebuilt.baseVersion !== base.version || rebuilt.baseContentHash !== base.contentHash) {
      fail(`rebuiltArtifacts[${index}] 与 base sibling 不闭合`)
    }
  }
  const rebuiltTarget = rebuiltArtifacts.find(artifact => artifact.artifactKey === target.artifactKey)!
  if (rebuiltTarget.contentHash === target.artifactContentHash) fail('target patch 没有形成内容变化')
  if (validation.validatedArtifacts.length !== rebuiltArtifacts.length
    || validation.validatedArtifacts.some((entry, index) =>
      entry.artifactKey !== rebuiltArtifacts[index].artifactKey
      || entry.contentHash !== rebuiltArtifacts[index].contentHash)) {
    fail('validation 未精确覆盖 rebuilt sibling group')
  }
  if (ownerSiblingGroup.acceptanceGateIds.some(gate => !validation.requiredGateIds.includes(gate))) {
    fail('validation.requiredGateIds 未覆盖 owner task gates')
  }
  if (status !== validation.status) fail('candidate.status 与 validation.status 不一致')
  if ((status === 'ready' || status === 'usable-with-warnings')
    && referenceDelta.danglingTargetIdentities.length) fail('可确认 candidate 不允许 dangling reference')
  const zeroUsage = modelUsage.modelCalls === 0 && modelUsage.inputTokens === 0
    && modelUsage.outputTokens === 0 && modelUsage.costUsd === null
    && modelUsage.durationMs === 0
  if ((mode === 'direct' && (modelEvidence !== null || !zeroUsage))
    || (mode === 'agent' && (modelEvidence === null || modelUsage.modelCalls !== 1))) {
    fail('candidate.mode 与 model evidence/usage 不一致')
  }
  if (revisionProvenance
    && (revisionProvenance.revisionPatchHash !== patch.patchHash
      || revisionProvenance.revisedAt !== parsed.createdAt
      || revisionProvenance.previousCandidateHash === parsed.candidateHash
      || revisionProvenance.originCandidateHash === parsed.candidateHash)) {
    fail('candidate revision provenance 与 Patch/时间/身份不闭合')
  }
  const candidateJson = canonicalProductProductionJsonV2(parsed)
  if (new TextEncoder().encode(candidateJson).byteLength
    > TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_LIMITS_V1.maximumCandidateUtf8Bytes) {
    fail('edit candidate 超过字节上限')
  }
  if (await hashTextOpenWorldCreatorEditCandidateV1(candidateBody(parsed)) !== parsed.candidateHash) {
    fail('edit candidate hash 不匹配')
  }
  return parsed
}

export function hashTextOpenWorldCreatorEditWarningAcknowledgementV1(codes: readonly string[]): Promise<string> {
  return hashProductProductionValueV2({
    schema: 'storyforge.text-open-world-creator-edit-warning-acknowledgement',
    version: 1,
    codes: [...codes].sort((left, right) => left.localeCompare(right)),
  })
}

export function hashTextOpenWorldCreatorEditIntentV1(
  input: Omit<TextOpenWorldCreatorEditIntentV1, 'intentHash'>,
): Promise<string> {
  return hashProductProductionValueV2(input)
}

export async function parseTextOpenWorldCreatorEditIntentV1(value: unknown): Promise<TextOpenWorldCreatorEditIntentV1> {
  const row = record(jsonInput(value, 'edit intent'), 'edit intent')
  exact(row, [
    'schema', 'version', 'portable', 'candidate', 'candidateHash', 'warningAcknowledgementCodes',
    'warningAcknowledgementHash', 'confirmedAt', 'intentHash',
  ], 'edit intent')
  if (row.schema !== 'storyforge.text-open-world-creator-edit-intent'
    || row.version !== 1 || row.portable !== false) fail('edit intent schema/version/portable 无效')
  const candidate = await parseTextOpenWorldCreatorEditCandidateV1(row.candidate)
  const codes = canonicalSet(row.warningAcknowledgementCodes, 'intent.warningAcknowledgementCodes', 512)
  const candidateWarningCodes = warningCodes(candidate.validation)
  if (!['ready', 'usable-with-warnings'].includes(candidate.status)
    || codes.length !== candidateWarningCodes.length
    || codes.some((code, index) => code !== candidateWarningCodes[index])) {
    fail('intent 只能确认可用 candidate，且必须精确确认全部 warning')
  }
  const parsed: TextOpenWorldCreatorEditIntentV1 = {
    schema: 'storyforge.text-open-world-creator-edit-intent',
    version: 1,
    portable: false,
    candidate,
    candidateHash: sha(row.candidateHash, 'intent.candidateHash'),
    warningAcknowledgementCodes: codes,
    warningAcknowledgementHash: sha(row.warningAcknowledgementHash, 'intent.warningAcknowledgementHash'),
    confirmedAt: timestamp(row.confirmedAt, 'intent.confirmedAt'),
    intentHash: sha(row.intentHash, 'intent.intentHash'),
  }
  if (parsed.candidateHash !== candidate.candidateHash
    || parsed.warningAcknowledgementHash !== await hashTextOpenWorldCreatorEditWarningAcknowledgementV1(codes)) {
    fail('intent candidate/warning acknowledgement hash 不匹配')
  }
  if (await hashTextOpenWorldCreatorEditIntentV1(intentBody(parsed)) !== parsed.intentHash) {
    fail('edit intent hash 不匹配')
  }
  return parsed
}

export function hashTextOpenWorldCreatorEditTerminalReceiptV1(
  input: Omit<TextOpenWorldCreatorEditTerminalReceiptV1, 'receiptHash'>,
): Promise<string> {
  return hashProductProductionValueV2(input)
}

export async function createTextOpenWorldCreatorEditTerminalReceiptV1(input: {
  intent: TextOpenWorldCreatorEditIntentV1
  baseUnchangedHash: string
  impactPlanHandoffHash: string
  completedAt: number
}): Promise<TextOpenWorldCreatorEditTerminalReceiptV1> {
  const intent = await parseTextOpenWorldCreatorEditIntentV1(input.intent)
  const candidate = intent.candidate
  const receipt: Omit<TextOpenWorldCreatorEditTerminalReceiptV1, 'receiptHash'> = {
    schema: 'storyforge.text-open-world-creator-edit-terminal-receipt',
    version: 1,
    portable: false,
    productionKey: candidate.production.productionKey,
    baseBuildNumber: candidate.baseBuild.buildNumber,
    controlEpoch: candidate.baseBuild.controlEpoch,
    candidateHash: candidate.candidateHash,
    validationHash: candidate.validation.validationHash,
    intentHash: intent.intentHash,
    status: 'impact-plan-required',
    criteria: [
      { id: 'candidate-integrity', evidenceHash: candidate.candidateHash },
      { id: 'domain-validation', evidenceHash: candidate.validation.validationHash },
      { id: 'author-confirmation', evidenceHash: intent.intentHash },
      { id: 'base-unchanged', evidenceHash: sha(input.baseUnchangedHash, 'baseUnchangedHash') },
      { id: 'impact-plan-handoff', evidenceHash: sha(input.impactPlanHandoffHash, 'impactPlanHandoffHash') },
    ],
    completedAt: timestamp(input.completedAt, 'completedAt'),
  }
  return { ...receipt, receiptHash: await hashTextOpenWorldCreatorEditTerminalReceiptV1(receipt) }
}

export async function parseTextOpenWorldCreatorEditTerminalReceiptV1(
  value: unknown,
  expected?: {
    intent: TextOpenWorldCreatorEditIntentV1
    baseUnchangedHash: string
    impactPlanHandoffHash: string
  },
): Promise<TextOpenWorldCreatorEditTerminalReceiptV1> {
  const row = record(jsonInput(value, 'edit terminal receipt'), 'edit terminal receipt')
  exact(row, [
    'schema', 'version', 'portable', 'productionKey', 'baseBuildNumber', 'controlEpoch',
    'candidateHash', 'validationHash', 'intentHash', 'status', 'criteria', 'completedAt', 'receiptHash',
  ], 'edit terminal receipt')
  if (row.schema !== 'storyforge.text-open-world-creator-edit-terminal-receipt'
    || row.version !== 1 || row.portable !== false || row.status !== 'impact-plan-required') {
    fail('edit terminal receipt schema/version/status 无效')
  }
  if (!Array.isArray(row.criteria) || row.criteria.length !== TERMINAL_CRITERIA.length) {
    fail('edit terminal receipt criteria 不完整')
  }
  const criteria = row.criteria.map((entry, index) => {
    const item = record(entry, `terminal.criteria[${index}]`)
    exact(item, ['id', 'evidenceHash'], `terminal.criteria[${index}]`)
    if (item.id !== TERMINAL_CRITERIA[index]) fail('terminal criteria 顺序/集合无效')
    return { id: item.id, evidenceHash: sha(item.evidenceHash, `terminal.criteria[${index}].evidenceHash`) }
  }) as TextOpenWorldCreatorEditTerminalReceiptV1['criteria']
  const parsed: TextOpenWorldCreatorEditTerminalReceiptV1 = {
    schema: 'storyforge.text-open-world-creator-edit-terminal-receipt',
    version: 1,
    portable: false,
    productionKey: stableKey(row.productionKey, 'terminal.productionKey'),
    baseBuildNumber: positiveInteger(row.baseBuildNumber, 'terminal.baseBuildNumber'),
    controlEpoch: nonNegativeInteger(row.controlEpoch, 'terminal.controlEpoch'),
    candidateHash: sha(row.candidateHash, 'terminal.candidateHash'),
    validationHash: sha(row.validationHash, 'terminal.validationHash'),
    intentHash: sha(row.intentHash, 'terminal.intentHash'),
    status: 'impact-plan-required',
    criteria,
    completedAt: timestamp(row.completedAt, 'terminal.completedAt'),
    receiptHash: sha(row.receiptHash, 'terminal.receiptHash'),
  }
  if (await hashTextOpenWorldCreatorEditTerminalReceiptV1(terminalReceiptBody(parsed)) !== parsed.receiptHash) {
    fail('edit terminal receipt hash 不匹配')
  }
  if (parsed.criteria[0].evidenceHash !== parsed.candidateHash
    || parsed.criteria[1].evidenceHash !== parsed.validationHash
    || parsed.criteria[2].evidenceHash !== parsed.intentHash) {
    fail('edit terminal receipt 内在 criteria 不闭合')
  }
  if (expected) {
    const intent = await parseTextOpenWorldCreatorEditIntentV1(expected.intent)
    const candidate = intent.candidate
    const expectedEvidence = [
      candidate.candidateHash,
      candidate.validation.validationHash,
      intent.intentHash,
      sha(expected.baseUnchangedHash, 'expected.baseUnchangedHash'),
      sha(expected.impactPlanHandoffHash, 'expected.impactPlanHandoffHash'),
    ]
    if (parsed.productionKey !== candidate.production.productionKey
      || parsed.baseBuildNumber !== candidate.baseBuild.buildNumber
      || parsed.controlEpoch !== candidate.baseBuild.controlEpoch
      || parsed.candidateHash !== candidate.candidateHash
      || parsed.validationHash !== candidate.validation.validationHash
      || parsed.intentHash !== intent.intentHash
      || parsed.completedAt !== intent.confirmedAt
      || parsed.criteria.some((criterion, index) => criterion.evidenceHash !== expectedEvidence[index])) {
      fail('edit terminal receipt 与 intent/base/handoff 不闭合')
    }
  }
  return parsed
}
