import { assertCodexProductionPolicyV1, codexSourceUnitEndsV1, CODEX_PRODUCTION_POLICY_V1, type CodexProductionPolicyV1 } from './codex-extraction-v2-source-units'
import type { WorkspaceScope } from '../../types'
import type { ContextMaterialAllocationV2 } from '../../types/agent-run'
import type { captureRegisteredContextSourceV2 } from '../../registry/assemble-context'
import type { AIRequestEvidenceV2, PublicAIResponseV2 } from '../../ai/client'
import { parseModelCapacityFactsV2 } from '../../ai/model-capacity'
import type { CodexRequestRefV1 } from '../../ai/codex-transport'
import type { ExactRunArtifactKindV1 } from '../../types/memory-engineering'
import { canonicalStringify, hashCanonicalValue } from './hash'

/** A failed new-start admission owns no paid response to auto-restore over
 * this page's author input. It grants neither a replacement nor a legacy send. */
export class CodexExtractionAdmissionUnavailableV2 extends Error {}

export const CODEX_EXTRACTION_PROFILE_V2 = 'task-request-v2' as const
export const CODEX_EXTRACTION_SKILL_V2 = 'world-origin.codex-extract.v2' as const
export const CODEX_EXTRACTION_ENTRY_V2 = 'world.codex.extract.v2' as const
export const CODEX_EXTRACTION_STEP_V2 = 'world-origin:codex-extract-v2' as const
export type RegisteredCodexCaptureV2 = Awaited<ReturnType<typeof captureRegisteredContextSourceV2>>
export interface CodexExactRefV2 {
  artifactKind: ExactRunArtifactKindV1
  contentHash: string
  byteLength: number
  stepId?: string
  attempt?: number
}
export interface CodexExtractionRootV2 {
  version: 'codex-extraction-root-v2'
  portable: false
  scope: WorkspaceScope
  worldGroupId: number | null
  categoryId: number
  sourceCaptureHash: string
  baselineCaptureHash: string
  baselineStateHash: string
  promptTemplateHash: string
  supplementTags: boolean
  lengthPlan: null
  /** Absent on immutable legacy Roots; never default during readback. */
  productionPolicy?: CodexProductionPolicyV1
  rootHash: string
}
export interface CodexExtractionFrameV2 {
  version: 'codex-extraction-frame-v2'
  rootHash: string
  startChar: number
  endChar: number
  sourceRangeHash: string
  wireFrameHash: string
  materialAllocationHash: string
  request: AIRequestEvidenceV2
  frameHash: string
}
export interface CodexExtractionPlanV2 {
  version: 'codex-extraction-plan-v2'
  portable: false
  rootHash: string
  sourceUTF16Length: number
  frames: CodexExtractionFrameV2[]
  previousPlanHash: string | null
  predecessorResultHashes: string[]
  carriedFrameHashes: string[]
  forecast: { modelCalls: number; inputTokens: number; outputTokens: number }
  planHash: string
}
export interface CodexExtractionResponseV2 {
  version: 'codex-extraction-response-v2'
  runId: number
  generation: number
  contractHash: string
  rootHash: string
  planHash: string
  frameHash: string
  callId: string
  nativeRequest: CodexRequestRefV1 | null
  response: PublicAIResponseV2
  rawTextHash: string
}
export function assertCodexPublicResponseV2(response: PublicAIResponseV2): void {
  assertCodexExactObjectV2(response, ['text','finishReason','usage','completion','responseStatus','wireDigest'], 'publicResponse')
  if (typeof response.text !== 'string' || ![null,'stop','length','content_filter','tool_calls','unknown'].includes(response.finishReason)
    || !['complete','incomplete','failed','unknown'].includes(response.completion)
    || !(response.responseStatus === null || Number.isInteger(response.responseStatus) && response.responseStatus >= 100 && response.responseStatus <= 599)
    || !response.usage || typeof response.usage !== 'object' || Array.isArray(response.usage)
    || Object.entries(response.usage).some(([key,value]) => !['inputTokens','outputTokens','totalTokens'].includes(key)
      || !Number.isSafeInteger(value) || value < 0)) throw new Error('可见响应投影字段无效。')
  if (response.wireDigest !== null) requireCodexHashV2(response.wireDigest, 'response.wire')
  if (response.completion === 'complete' && response.finishReason !== 'stop'
    || response.completion === 'incomplete' && response.finishReason !== 'length') throw new Error('响应终态与完成原因不一致。')
}
export function requireCodexHashV2(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} hash 无效。`)
  return value
}
export function assertCodexExactObjectV2(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) throw new Error(`${label}字段不在闭集。`)
}
export async function assertCodexExtractionRootV2(root: CodexExtractionRootV2): Promise<void> {
  assertCodexExactObjectV2(root, ['version','portable','scope','worldGroupId','categoryId','sourceCaptureHash','baselineCaptureHash','baselineStateHash','promptTemplateHash','supplementTags','lengthPlan','rootHash', ...(root.productionPolicy ? ['productionPolicy'] : [])], 'root')
  assertCodexExactObjectV2(root.scope, ['projectId','worldId','workId'], 'root.scope')
  if (root.productionPolicy) assertCodexProductionPolicyV1(root.productionPolicy)
  const { rootHash, ...body } = root
  if (body.version !== 'codex-extraction-root-v2' || body.portable !== false || body.lengthPlan !== null
    || typeof body.supplementTags !== 'boolean' || !Number.isSafeInteger(body.categoryId) || body.categoryId < 1
    || !(body.worldGroupId === null || Number.isSafeInteger(body.worldGroupId) && body.worldGroupId > 0)
    || Object.values(body.scope).some(id => !Number.isSafeInteger(id) || id < 1)
    || await hashCanonicalValue(body) !== requireCodexHashV2(rootHash, 'root')) throw new Error('提取root身份无效。')
  for (const hash of [root.sourceCaptureHash,root.baselineCaptureHash,root.baselineStateHash,root.promptTemplateHash]) requireCodexHashV2(hash, 'root来源')
}

function natural(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} 不是非负安全整数。`)
  return value
}
export async function assertRegisteredCodexCaptureV2(capture: RegisteredCodexCaptureV2): Promise<void> {
  assertCodexExactObjectV2(capture, ['version','protocolVersion','sourceKey','sourceVersion','scope','worldGroupId','categoryId','rawText','rawUTF16Length','rawBodyHash','sourceAuthorityHash','captureHash'], 'capture')
  assertCodexExactObjectV2(capture.scope, ['projectId','worldId','workId'], 'capture.scope')
  const { captureHash, ...body } = capture
  if (typeof body.rawText !== 'string' || typeof body.sourceVersion !== 'string' || !body.sourceVersion
    || body.version !== 'registered-context-source-capture-v2' || body.protocolVersion !== 'registered-host-full-v2'
    || !['manualText','codexExtractionBaseline','codexExtractionProgressV2'].includes(body.sourceKey)
    || body.rawText.length !== body.rawUTF16Length || !body.rawText.trim()
    || await hashCanonicalValue(body) !== requireCodexHashV2(captureHash, 'capture')) throw new Error('完整来源捕获已变化。')
  requireCodexHashV2(body.rawBodyHash, 'capture.rawBody')
  requireCodexHashV2(body.sourceAuthorityHash, 'capture.authority')
  for (const id of [body.scope.projectId, body.scope.worldId, body.scope.workId]) {
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('完整来源必须归真实既有 Work。')
  }
}
export async function createCodexExtractionRootV2(input: {
  source: RegisteredCodexCaptureV2
  baseline: RegisteredCodexCaptureV2
  baselineStateHash: string
  promptTemplateHash: string
  supplementTags: boolean
  newProductionPolicy?: boolean
}): Promise<CodexExtractionRootV2> {
  await assertRegisteredCodexCaptureV2(input.source)
  await assertRegisteredCodexCaptureV2(input.baseline)
  if (input.source.sourceKey !== 'manualText' || input.baseline.sourceKey !== 'codexExtractionBaseline'
    || canonicalStringify(input.source.scope) !== canonicalStringify(input.baseline.scope)
    || input.source.worldGroupId !== input.baseline.worldGroupId
    || !Number.isSafeInteger(input.baseline.categoryId) || input.baseline.categoryId! < 1) throw new Error('提取来源和登记分类不属于同一授权目标。')
  const productionPolicy: CodexProductionPolicyV1 | undefined = input.newProductionPolicy
    ? { version: CODEX_PRODUCTION_POLICY_V1, sourceUnitEnds: codexSourceUnitEndsV1(input.source.rawText) } : undefined
  const body = { version: 'codex-extraction-root-v2' as const, portable: false as const,
    scope: { ...input.source.scope }, worldGroupId: input.baseline.worldGroupId, categoryId: input.baseline.categoryId!,
    sourceCaptureHash: input.source.captureHash, baselineCaptureHash: input.baseline.captureHash,
    baselineStateHash: requireCodexHashV2(input.baselineStateHash, 'baseline'),
    promptTemplateHash: requireCodexHashV2(input.promptTemplateHash, 'prompt'), supplementTags: input.supplementTags, lengthPlan: null,
    ...(productionPolicy ? { productionPolicy } : {}) }
  return { ...body, rootHash: await hashCanonicalValue(body) }
}
export async function createCodexContextMaterialV2(input: {
  root: CodexExtractionRootV2
  source: RegisteredCodexCaptureV2
  baseline: RegisteredCodexCaptureV2
  inputTokenForecast: number
  progress?: RegisteredCodexCaptureV2
}): Promise<ContextMaterialAllocationV2> {
  await assertRegisteredCodexCaptureV2(input.source)
  await assertRegisteredCodexCaptureV2(input.baseline)
  if (input.root.sourceCaptureHash !== input.source.captureHash || input.root.baselineCaptureHash !== input.baseline.captureHash) throw new Error('完整材料不属于冻结 root。')
  await assertCodexExtractionRootV2(input.root)
  const captures = [input.source, input.baseline]
  if (input.progress) {
    await assertRegisteredCodexCaptureV2(input.progress)
    const progress = JSON.parse(input.progress.rawText) as Record<string, unknown>
    if (input.progress.sourceKey !== 'codexExtractionProgressV2' || progress.rootHash !== input.root.rootHash
      || canonicalStringify(input.progress.scope) !== canonicalStringify(input.root.scope)
      || progress.authority !== 'draft-not-canon' || !Array.isArray(progress.results) || !progress.results.length) throw new Error('后继材料缺少同一Run/root已验证草稿来源。')
    captures.push(input.progress)
  }
  const hashes = captures.map(capture => capture.captureHash)
  const readPlan = captures.map(capture => ({ sourceKey: capture.sourceKey,
    sourceVersion: capture.sourceVersion, scope: capture.scope, authorityHash: capture.sourceAuthorityHash }))
  const body = { version: 'context-material-allocation-v2' as const, authorityHash: input.root.rootHash,
    capturedSourceHashes: hashes, selectedSourceHashes: [...hashes], readPlanHash: await hashCanonicalValue(readPlan),
    inputTokenForecast: natural(input.inputTokenForecast, '资料预估'), captureProtocolVersion: 'registered-host-full-v2' as const }
  return { ...body, allocationHash: await hashCanonicalValue(body) }
}
export async function assertCodexExtractionPlanV2(plan: CodexExtractionPlanV2): Promise<void> {
  assertCodexExactObjectV2(plan, ['version','portable','rootHash','sourceUTF16Length','frames','previousPlanHash','predecessorResultHashes','carriedFrameHashes','forecast','planHash'], 'plan')
  assertCodexExactObjectV2(plan.forecast, ['modelCalls','inputTokens','outputTokens'], 'plan.forecast')
  const { planHash, ...body } = plan
  if (plan.version !== 'codex-extraction-plan-v2' || plan.portable !== false
    || await hashCanonicalValue(body) !== requireCodexHashV2(planHash, 'plan')) throw new Error('词条范围计划已变化。')
  requireCodexHashV2(plan.rootHash, 'root')
  natural(plan.sourceUTF16Length, '原文长度')
  if (!Array.isArray(plan.frames) || !Array.isArray(plan.carriedFrameHashes) || !Array.isArray(plan.predecessorResultHashes)
    || new Set(plan.predecessorResultHashes).size !== plan.predecessorResultHashes.length) throw new Error('计划数组或前结果引用无效。')
  if (new Set(plan.carriedFrameHashes).size !== plan.carriedFrameHashes.length) throw new Error('重复沿用frame。')
  let end = 0, inputTokens = 0, outputTokens = 0, modelCalls = 0
  for (const frame of plan.frames) {
    assertCodexExactObjectV2(frame, ['version','rootHash','startChar','endChar','sourceRangeHash','wireFrameHash','materialAllocationHash','request','frameHash'], 'frame')
    assertCodexExactObjectV2(frame.request, ['version','profile','routeHash','capacity','materialAllocationHash','messagesHash','optionsHash','wireBodyHash','requestHash','policyHash','inputMeasurement','wireOutputTokens','forecastOutputTokens','wireOutputBasis','forecastBasis','sentParameters'], 'frame.request')
    assertCodexExactObjectV2(frame.request.inputMeasurement, ['tokens','method','version','reliability'], 'frame.measurement')
    const request = frame.request
    parseModelCapacityFactsV2(request.capacity)
    for (const hash of [request.routeHash,request.materialAllocationHash,request.messagesHash,request.optionsHash,request.wireBodyHash,request.requestHash,request.policyHash]) requireCodexHashV2(hash, 'request')
    if (request.version !== 'ai-request-evidence-v2' || request.capacity.routeHash !== request.routeHash
      || request.forecastBasis !== 'source-token-estimate-v1' || !['evidenced-output-limit','evidenced-shared-window','explicit-author-constraint','provider-managed'].includes(request.wireOutputBasis)
      || !['exact','estimate'].includes(request.inputMeasurement.reliability) || typeof request.inputMeasurement.method !== 'string' || !request.inputMeasurement.method
      || typeof request.inputMeasurement.version !== 'string' || !request.inputMeasurement.version
      || !(request.wireOutputTokens === null || Number.isSafeInteger(request.wireOutputTokens) && request.wireOutputTokens > 0)
      || !request.sentParameters || typeof request.sentParameters !== 'object' || Array.isArray(request.sentParameters)) throw new Error('frame完整请求证据无效。')
    requireCodexHashV2(frame.sourceRangeHash, '来源范围')
    requireCodexHashV2(frame.wireFrameHash, '准确请求工件')
    const { frameHash, ...frameBody } = frame
    if (frame.version !== 'codex-extraction-frame-v2' || frame.rootHash !== plan.rootHash
      || frame.startChar !== end || natural(frame.endChar, '范围终点') <= frame.startChar
      || frame.endChar > plan.sourceUTF16Length || await hashCanonicalValue(frameBody) !== requireCodexHashV2(frameHash, 'frame')
      || frame.materialAllocationHash !== frame.request.materialAllocationHash
      || frame.request.profile !== CODEX_EXTRACTION_PROFILE_V2) throw new Error('词条范围存在缺口、重叠或请求改绑。')
    end = frame.endChar
    if (!plan.carriedFrameHashes.includes(frame.frameHash)) {
      inputTokens += natural(frame.request.inputMeasurement.tokens, '请求输入预估')
      outputTokens += natural(frame.request.forecastOutputTokens, '请求输出预估')
      modelCalls++
    }
  }
  if (end !== plan.sourceUTF16Length || plan.forecast.modelCalls !== modelCalls
    || plan.forecast.inputTokens !== natural(inputTokens, '输入预估合计')
    || plan.forecast.outputTokens !== natural(outputTokens, '输出预估合计')) throw new Error('词条计划没有完整覆盖或预估不一致。')
  if (plan.previousPlanHash !== null) requireCodexHashV2(plan.previousPlanHash, '前计划')
  if (plan.carriedFrameHashes.some(hash => !plan.frames.some(frame => frame.frameHash === hash))) throw new Error('沿用frame不在覆盖计划中。')
  plan.predecessorResultHashes.forEach(hash => requireCodexHashV2(hash, '前结果'))
}

export interface CodexExtractionCandidateV2 {
  version: 'codex-extraction-candidate-v2'
  portable: false
  runId: number
  rootHash: string
  planHash: string
  resultRefs: CodexExactRefV2[]
  entries: import('../../ai/adapters/structured-extract-adapter').ExtractedCodexEntry[]
  candidateHash: string
}
export interface CodexExtractionAuthorDraftV2 {
  version: 'codex-extraction-author-draft-v2'
  runId: number
  modelCandidateHash: string
  modelCandidateRef: CodexExactRefV2
  entries: import('../../ai/adapters/structured-extract-adapter').ExtractedCodexEntry[]
  editPaths: string[]
  draftHash: string
}
export interface CodexExtractionReviewV2 {
  version: 'codex-extraction-reviewed-v2'
  runId: number
  modelCandidateHash: string
  modelCandidateRef: CodexExactRefV2
  draftHash: string
  selectedIndexes: number[]
  compiledContentHash: string
  confirmedCandidateHash: string
}
export interface CodexExtractionIntentV2 {
  version: 'codex-extraction-adoption-intent-v2'
  runId: number
  rootHash: string
  modelCandidateHash: string
  draftRef: CodexExactRefV2
  reviewRef: CodexExactRefV2
  review: CodexExtractionReviewV2
  formalItems: Array<Record<string, unknown>>
  intentHash: string
}
