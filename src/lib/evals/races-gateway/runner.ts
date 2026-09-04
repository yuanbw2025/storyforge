import { hashCanonicalValue } from '../../agent/run/hash'
import { getOrCreateAgentConversation } from '../../agent/conversations'
import { executeMasterAgentPlan, type MasterAgentPlan } from '../../agent/orchestrator'
import {
  restoreMasterAgentCandidatesV1,
  runDurableMasterAgentPlanV1,
} from '../../agent/run/master-durable'
import { commitMasterAgentCandidateAdoptionV1 } from '../../agent/run/master-adoption'
import { parseWorldviewFieldCandidateDraft } from '../../agent/worldview-field-copilot'
import { AgentTeamBudgetTracker } from '../../agent/team-budget'
import { readAgentRunV1 } from '../../agent/run/event-store'
import { classifyHarnessFailureV1 } from '../../agent/run/harness-failure'
import {
  parseStructuredOutputRunEvidenceV1,
  structuredOutputFailureEvidenceV1,
} from '../../agent/structured-output-pipeline'
import {
  readContextGatewayManifestV3ForAttemptV1,
  verifyContextGatewayCandidateEvidenceV1,
} from '../../context-gateway/attempt-evidence'
import { db } from '../../db/schema'
import { readAgentRunArtifactExactV1 } from '../../memory/artifact-store'
import { cascadeDeleteProject } from '../../registry/lifecycle'
import type { ContextSourceRefV1 } from '../../registry/types'
import type { AIConfig, Character, WorkspaceScope, Worldview } from '../../types'
import { resolveWorkspaceOwnership } from '../../workspace/ownership'
import { stampNewRecord } from '../../workspace/scope'
import { createWorkspace } from '../../workspace/create-workspace'
import { createWorldWork } from '../../workspace/works'
import { RACES_GATEWAY_EVAL_FIXTURES_V1 } from './fixtures'
import { RacesGatewayBlindGraderFailureV1 } from './protocol'
import {
  createRacesGatewayFailureTranscriptArchiveV2,
  createRacesGatewayTranscriptArchiveV1,
  readRacesGatewayTranscriptArchiveV1,
} from './archive'
import { scoreRacesGatewayEvalV1, RACES_GATEWAY_EVAL_THRESHOLDS_V1 } from './scoring'
import {
  RACES_GATEWAY_EVAL_STORAGE_KEY_V21,
  RACES_GATEWAY_EVAL_VERSION_V21,
  type RacesGatewayBlindGradeV1,
  type RacesGatewayBlindGradeEvidenceV1,
  type RacesGatewayEvalCheckpointV1,
  type RacesGatewayEvalFixtureV1,
  type RacesGatewayEvalProgressV1,
  type RacesGatewayEvalResultV1,
} from './types'

const EMPTY_HASH = '0'.repeat(64)
const PROJECT_MARKER = '[RACE6-EVAL] isolated transcript/outcome workspace'
const FIXTURE_TASK_PREFIX = 'race6-'

export type RacesGatewayBlindGraderV1 = (input: {
  title: string
  seedText: string
  candidateText: string
}) => Promise<{ grade: RacesGatewayBlindGradeV1; evidence: RacesGatewayBlindGradeEvidenceV1 }>

interface SeededRacesGatewayWorkspaceV1 {
  projectId: number
  scope: WorkspaceScope
  worldviewId: number | null
  lateTargetCharacterId: number | null
}

function checkpointBody(checkpoint: RacesGatewayEvalCheckpointV1) {
  const { checkpointHash: _checkpointHash, ...body } = checkpoint
  return body
}

async function sealCheckpoint(
  checkpoint: RacesGatewayEvalCheckpointV1,
): Promise<RacesGatewayEvalCheckpointV1> {
  return {
    ...checkpoint,
    checkpointHash: await hashCanonicalValue(checkpointBody(checkpoint)),
  }
}

function safeError(value: unknown): string {
  return (value instanceof Error ? value.message : String(value))
    .replace(/(?:sk|ak|key)-[A-Za-z0-9_-]{8,}/gi, '[credential]')
    .slice(0, 1_000)
}

function modeFor(fixture: RacesGatewayEvalFixtureV1): 'expand' | 'polish' {
  return fixture.kind === 'polish' ? 'polish' : 'expand'
}

function planFor(fixture: RacesGatewayEvalFixtureV1): MasterAgentPlan {
  const mode = modeFor(fixture)
  return {
    summary: `RACE-6 ${fixture.id} 种族与民族冻结评测。`,
    tasks: [{
      id: `${FIXTURE_TASK_PREFIX}${fixture.id}`,
      agentId: 'world-origin',
      skillId: 'world-origin.worldview-field',
      instruction: [
        `生成世界基座字段。目标字段=races；生成模式=${mode}。`,
        `作者补充：${fixture.authorRequest}`,
      ].join('\n'),
      dependsOn: [],
    }],
    workflow: {
      version: 1,
      workflowId: 'single-domain-direct',
      reasonCodes: ['single-explicit-domain'],
    },
  }
}

function emptyWorldview(): Omit<Worldview, 'id' | 'projectId'> {
  return {
    worldOrigin: '', races: '', createdAt: Date.now(), updatedAt: Date.now(),
  }
}

async function seedWorkspace(fixture: RacesGatewayEvalFixtureV1): Promise<SeededRacesGatewayWorkspaceV1> {
  const now = Date.now()
  const created = await createWorkspace({
    name: fixture.title,
    genres: ['fantasy'],
    description: `${PROJECT_MARKER} ${fixture.id}`,
    status: 'drafting',
    targetWordCount: 1_000_000,
  }, { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' })
  const { scope } = created
  const projectId = scope.projectId
  let worldviewId: number | null = null
  if (fixture.kind === 'partial-world' || fixture.kind === 'pinned-mandatory'
    || fixture.kind === 'expand' || fixture.kind === 'polish') {
    const values = emptyWorldview()
    if (fixture.kind === 'partial-world') values.worldOrigin = fixture.seedText
    else values.races = fixture.seedText
    worldviewId = await db.worldviews.add(stampNewRecord(scope, 'worldviews', {
      projectId,
      ...values,
    }, { owner: 'world' }) as Worldview) as number
  }
  let lateTargetCharacterId: number | null = null
  if (fixture.kind === 'late-target') {
    for (let index = 0; index < 24; index += 1) {
      const isTarget = index === 23
      const character = stampNewRecord(scope, 'characters', {
        projectId,
        name: isTarget ? fixture.expectedAnchor! : `目录填充角色${fixture.id}-${index + 1}`,
        roleWeight: 'secondary', moralAxis: 'neutral', orderAxis: 'neutral',
        shortDescription: isTarget
          ? `${fixture.expectedAnchor}负责保存跨族群通行契约，身份不能被同名概念替代。`
          : `第 ${index + 1} 位普通港口居民。`,
        appearance: '', personality: '谨慎', background: '生活在港口。', motivation: '维持日常秩序。',
        abilities: '', relationships: '[]', arc: '', createdAt: now + index, updatedAt: now + index,
      }, { owner: 'world' }) as Character
      const id = await db.characters.add(character) as number
      if (isTarget) lateTargetCharacterId = id
    }
  }
  return { projectId, scope, worldviewId, lateTargetCharacterId }
}

function retrievalDecisions(manifest: Awaited<ReturnType<typeof readContextGatewayManifestV3ForAttemptV1>>['manifest']) {
  const trace = manifest.gateway.retrievalTrace
  return [...trace.mandatory, ...trace.autoSelected, ...trace.agentReads]
}

function includesRef(
  refs: readonly ContextSourceRefV1[],
  table: string,
  recordId?: number | null,
  field?: string,
): boolean {
  return refs.some(ref => ref.table === table
    && (recordId == null || ref.recordId === recordId)
    && (field == null || ref.field === field))
}

async function executeModelFixture(input: {
  fixture: RacesGatewayEvalFixtureV1
  modelIdentity: { provider: string; model: string }
  generatorConfig: AIConfig
  grade: RacesGatewayBlindGraderV1
}): Promise<RacesGatewayEvalResultV1> {
  const startedAt = performance.now()
  let seeded: SeededRacesGatewayWorkspaceV1 | null = null
  let generatedEvidence: RacesGatewayEvalResultV1 | null = null
  let durableRunId: number | null = null
  try {
    seeded = await seedWorkspace(input.fixture)
    const conversation = await getOrCreateAgentConversation({
      projectId: seeded.projectId,
      scope: seeded.scope,
      worldGroupId: null,
      purpose: `races-gateway-eval:${input.fixture.id}`,
      title: `RACE-6 ${input.fixture.id}`,
    })
    const plan = planFor(input.fixture)
    const run = await runDurableMasterAgentPlanV1(
      {
        scope: seeded.scope,
        worldGroupId: null,
        conversationId: conversation.id!,
        plan,
        budget: new AgentTeamBudgetTracker('balanced'),
        onDurableBoundary: boundary => {
          durableRunId = boundary.runId
        },
      },
      {
        execute: executeInput => executeMasterAgentPlan({
          ...executeInput,
          taskConfigOverrides: { [plan.tasks[0].id]: input.generatorConfig },
        }),
      },
    )
    const restored = await restoreMasterAgentCandidatesV1({ scope: seeded.scope, runId: run.runId })
    if (restored.candidates.length !== 1) throw new Error(`预期 1 个候选，实际 ${restored.candidates.length}`)
    const candidate = restored.candidates[0]
    if (candidate.payload.generator?.provider !== input.modelIdentity.provider
      || candidate.payload.generator?.model !== input.modelIdentity.model) {
      throw new Error('实际 generator 身份与 RACE-6 冻结身份不一致')
    }
    const parsed = parseWorldviewFieldCandidateDraft(candidate.draft)
    if (parsed.field !== 'races') throw new Error('候选字段不是 races')
    if (input.fixture.kind === 'expand' || input.fixture.kind === 'polish') {
      if (candidate.payload.worldviewFieldOperation !== input.fixture.kind) {
        throw new Error(`双版本候选 operation 漂移：预期 ${input.fixture.kind}`)
      }
      if (!JSON.stringify(candidate.payload.baseSnapshot).includes(input.fixture.seedText)) {
        throw new Error('双版本候选没有冻结原文 baseline')
      }
    }
    const stepId = `master:${FIXTURE_TASK_PREFIX}${input.fixture.id}`
    const evidence = await verifyContextGatewayCandidateEvidenceV1({
      scope: seeded.scope,
      runId: run.runId,
      stepId,
      attempt: 1,
      candidateHash: candidate.payload.candidateHash!,
    })
    const decisions = retrievalDecisions(evidence.manifest)
    const refs = decisions.flatMap(decision => decision.sourceRefs)
    const selectedResourceKeys = decisions.map(decision => decision.resourceKey)
    const transcriptArtifactKeys = new Set(evidence.manifest.artifacts
      .filter(ref => ref.role !== 'source-snapshot'
        || (ref.resourceKey != null && selectedResourceKeys.includes(ref.resourceKey)))
      .map(ref => `${ref.role}:${ref.contentHash}`))
    const transcriptArtifacts = Object.fromEntries(Object.entries(evidence.artifactBodies)
      .filter(([key]) => transcriptArtifactKeys.has(key)))
    const mandatoryDelivered = input.fixture.kind === 'pinned-mandatory'
      ? evidence.manifest.gateway.retrievalTrace.mandatory.some(decision => (
          includesRef(decision.sourceRefs, 'worldviews', seeded?.worldviewId, 'races')
        ))
      : null
    const expectedAnchorDelivered = input.fixture.kind === 'late-target'
      ? includesRef(refs, 'characters', seeded.lateTargetCharacterId)
      : null
    generatedEvidence = {
      fixtureId: input.fixture.id,
      kind: input.fixture.kind,
      status: 'passed',
      failureStage: null,
      projectId: seeded.projectId,
      runId: run.runId,
      candidateEventId: candidate.event.id!,
      candidateText: parsed.value,
      contextManifestHash: evidence.manifest.manifestHash,
      transcriptArchive: await createRacesGatewayTranscriptArchiveV1({
        manifest: evidence.manifest,
        artifactBodies: transcriptArtifacts,
      }),
      selectedResourceKeys,
      mandatoryDelivered,
      expectedAnchorDelivered,
      expectedAnchorInOutcome: input.fixture.kind === 'late-target'
        ? parsed.value.includes(input.fixture.expectedAnchor!)
        : null,
      staleBlocked: null,
      crossScopeBlocked: null,
      grade: null,
      gradeEvidence: null,
      gradeFailureEvidence: null,
      failureEvidence: null,
      structuredFailureEvidence: null,
      error: null,
      durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
    }
    const isQualityCase = input.fixture.kind === 'empty'
      || input.fixture.kind === 'partial-world'
      || input.fixture.kind === 'pinned-mandatory'
    const graded = isQualityCase
      ? await input.grade({ title: input.fixture.title, seedText: input.fixture.seedText, candidateText: parsed.value })
      : null
    return {
      ...generatedEvidence,
      // Pinned Canon is a semantic preservation claim, not a character-match
      // claim. The exact source remains frozen in the transcript and the
      // independent grader compares it with the candidate. Late-target cases
      // stay literal because their author request explicitly requires the
      // precise character name.
      expectedAnchorInOutcome: input.fixture.kind === 'pinned-mandatory'
        ? graded?.grade.constraintsRespected ?? false
        : generatedEvidence.expectedAnchorInOutcome,
      grade: graded?.grade ?? null,
      gradeEvidence: graded?.evidence ?? null,
      durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
    }
  } catch (error) {
    const failedProjectId = seeded?.projectId ?? null
    const failureEvidence = await classifyHarnessFailureV1(error)
    const structuredFailureEvidence = structuredOutputFailureEvidenceV1(error)
    const gradeFailureEvidence = error instanceof RacesGatewayBlindGraderFailureV1
      ? error.failureEvidence
      : null
    let failureArchive: RacesGatewayEvalResultV1['transcriptArchive'] = null
    let archiveFailure = ''
    if (seeded && durableRunId != null && !generatedEvidence) {
      try {
        const snapshot = await readAgentRunV1(seeded.scope, durableRunId)
        const stepId = `master:${FIXTURE_TASK_PREFIX}${input.fixture.id}`
        const attempt = snapshot.projection.steps[stepId]?.attempt ?? 1
        const seen = new Set<string>()
        const artifactRefs = snapshot.events.flatMap(event => {
          if (event.type !== 'evidence.artifact.recorded'
            || event.payload.stepId !== stepId
            || event.payload.attempt !== attempt) return []
          const key = `${event.payload.artifactKind}:${event.payload.contentHash}`
          if (seen.has(key)) return []
          seen.add(key)
          return [{
            version: 1 as const,
            artifactKind: event.payload.artifactKind,
            contentHash: event.payload.contentHash,
            byteLength: event.payload.byteLength,
            stepId,
            attempt,
          }]
        })
        const artifactBodies = Object.fromEntries(await Promise.all(artifactRefs.map(async ref => [
          `${ref.artifactKind}:${ref.contentHash}`,
          await readAgentRunArtifactExactV1({
            projectId: seeded!.projectId,
            artifactKind: ref.artifactKind,
            contentHash: ref.contentHash,
          }),
        ])))
        failureArchive = await createRacesGatewayFailureTranscriptArchiveV2({
          runId: durableRunId,
          stepId,
          attempt,
          artifactRefs,
          artifactBodies,
        })
      } catch (failure) {
        archiveFailure = `；失败证据归档失败：${safeError(failure)}`
      }
    }
    let cleanupFailure = ''
    if (failedProjectId != null) {
      try {
        if (await db.projects.get(failedProjectId)) await cascadeDeleteProject(failedProjectId)
      } catch (cleanupError) {
        cleanupFailure = `；隔离项目清理失败：${safeError(cleanupError)}`
      }
    }
    const emptyFailure: RacesGatewayEvalResultV1 = {
      fixtureId: input.fixture.id,
      kind: input.fixture.kind,
      status: 'failed',
      failureStage: 'generation',
      projectId: null,
      runId: null,
      candidateEventId: null,
      candidateText: '',
      contextManifestHash: null,
      transcriptArchive: null,
      selectedResourceKeys: [],
      mandatoryDelivered: null,
      expectedAnchorDelivered: null,
      expectedAnchorInOutcome: null,
      staleBlocked: null,
      crossScopeBlocked: null,
      grade: null,
      gradeEvidence: null,
      gradeFailureEvidence,
      failureEvidence,
      structuredFailureEvidence,
      error: `${safeError(error)}${archiveFailure}${cleanupFailure}`,
      durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
    }
    return generatedEvidence
      ? {
          ...generatedEvidence,
          status: 'failed',
          failureStage: 'grader',
          projectId: null,
          grade: null,
          gradeEvidence: null,
          gradeFailureEvidence,
          failureEvidence,
          structuredFailureEvidence,
          error: emptyFailure.error,
          durationMs: emptyFailure.durationMs,
        }
      : { ...emptyFailure, transcriptArchive: failureArchive }
  }
}

async function sourceResult(input: {
  fixture: RacesGatewayEvalFixtureV1
  results: readonly RacesGatewayEvalResultV1[]
}): Promise<{ result: RacesGatewayEvalResultV1; scope: WorkspaceScope }> {
  const result = input.results.find(item => item.fixtureId === input.fixture.sourceCaseId && item.status === 'passed')
  if (!result?.projectId || !result.runId || !result.candidateEventId) {
    throw new Error(`源样本 ${input.fixture.sourceCaseId ?? '<none>'} 不可用`)
  }
  const scope = (await resolveWorkspaceOwnership(result.projectId)).scope
  return { result, scope }
}

async function executeCrossScopeFixture(
  fixture: RacesGatewayEvalFixtureV1,
  results: readonly RacesGatewayEvalResultV1[],
): Promise<RacesGatewayEvalResultV1> {
  const startedAt = performance.now()
  try {
    const source = await sourceResult({ fixture, results })
    const otherWork = await createWorldWork(source.scope.projectId, {
      title: `${fixture.id} 攻击作品`,
      description: '', genres: ['fantasy'], status: 'drafting', targetWordCount: 10_000,
      kind: 'novel', novelProfile: 'long',
    })
    const otherWorkId = otherWork.id!
    let blocked = false
    let message = ''
    try {
      await commitMasterAgentCandidateAdoptionV1({
        scope: { ...source.scope, workId: otherWorkId },
        runId: source.result.runId!,
        candidateEventId: source.result.candidateEventId!,
        worldGroupId: null,
      })
    } catch (error) {
      blocked = true
      message = safeError(error)
    }
    const worldview = await db.worldviews.where('projectId').equals(source.scope.projectId).toArray()
    if (!blocked || worldview.some(row => Boolean(row.races?.trim()))) {
      throw new Error('跨 scope 攻击未 fail-closed 或写入了 races Canon')
    }
    return {
      fixtureId: fixture.id, kind: fixture.kind, status: 'passed', projectId: source.scope.projectId,
      failureStage: null,
      runId: source.result.runId, candidateEventId: source.result.candidateEventId, candidateText: '',
      contextManifestHash: source.result.contextManifestHash, selectedResourceKeys: [], mandatoryDelivered: null,
      transcriptArchive: null,
      expectedAnchorDelivered: null, expectedAnchorInOutcome: null, staleBlocked: null,
      crossScopeBlocked: true, grade: null, error: message || null,
      gradeEvidence: null,
      gradeFailureEvidence: null,
      failureEvidence: null,
      structuredFailureEvidence: null,
      durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
    }
  } catch (error) {
    return failedAttackResult(fixture, error, startedAt)
  }
}

async function mutateSelectedWorldviewRef(input: {
  fixture: RacesGatewayEvalFixtureV1
  source: Awaited<ReturnType<typeof sourceResult>>
}): Promise<void> {
  const manifest = await readContextGatewayManifestV3ForAttemptV1({
    scope: input.source.scope,
    runId: input.source.result.runId!,
    stepId: `master:${FIXTURE_TASK_PREFIX}${input.fixture.sourceCaseId}`,
    attempt: 1,
  })
  const ref = retrievalDecisions(manifest.manifest)
    .flatMap(decision => decision.sourceRefs)
    .find(item => item.table === 'worldviews' && typeof item.recordId === 'number')
  if (!ref || typeof ref.recordId !== 'number') throw new Error('源候选没有可变更的 worldview SourceRef')
  const row = await db.worldviews.get(ref.recordId)
  if (!row) throw new Error('CAS SourceRef 对应 worldview 已丢失')
  const current = (row as unknown as Record<string, unknown>)[ref.field]
  const update: Partial<Worldview> = { updatedAt: Math.max(Date.now(), row.updatedAt + 1) }
  ;(update as Record<string, unknown>)[ref.field] =
    `${typeof current === 'string' ? current : JSON.stringify(current)}\n[CAS-${input.fixture.id}] 作者并发修订`
  await db.worldviews.update(ref.recordId, update)
}

async function executeCasFixture(
  fixture: RacesGatewayEvalFixtureV1,
  results: readonly RacesGatewayEvalResultV1[],
): Promise<RacesGatewayEvalResultV1> {
  const startedAt = performance.now()
  try {
    const source = await sourceResult({ fixture, results })
    await mutateSelectedWorldviewRef({ fixture, source })
    let blocked = false
    let message = ''
    try {
      await commitMasterAgentCandidateAdoptionV1({
        scope: source.scope,
        runId: source.result.runId!,
        candidateEventId: source.result.candidateEventId!,
        worldGroupId: null,
      })
    } catch (error) {
      message = safeError(error)
      blocked = /stale|过期|漂移|变化|不一致/i.test(message)
    }
    const worldview = await db.worldviews.where('projectId').equals(source.scope.projectId).first()
    if (!blocked || Boolean(worldview?.races?.trim())) {
      throw new Error(`CAS 攻击未以 stale fail-closed：${message || '候选被错误采纳'}`)
    }
    return {
      fixtureId: fixture.id, kind: fixture.kind, status: 'passed', projectId: source.scope.projectId,
      failureStage: null,
      runId: source.result.runId, candidateEventId: source.result.candidateEventId, candidateText: '',
      contextManifestHash: source.result.contextManifestHash, selectedResourceKeys: [], mandatoryDelivered: null,
      transcriptArchive: null,
      expectedAnchorDelivered: null, expectedAnchorInOutcome: null, staleBlocked: true,
      crossScopeBlocked: null, grade: null, error: message || null,
      gradeEvidence: null,
      gradeFailureEvidence: null,
      failureEvidence: null,
      structuredFailureEvidence: null,
      durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
    }
  } catch (error) {
    return failedAttackResult(fixture, error, startedAt)
  }
}

async function failedAttackResult(
  fixture: RacesGatewayEvalFixtureV1,
  error: unknown,
  startedAt: number,
): Promise<RacesGatewayEvalResultV1> {
  return {
    fixtureId: fixture.id, kind: fixture.kind, status: 'failed', failureStage: 'attack',
    projectId: null, runId: null,
    candidateEventId: null, candidateText: '', contextManifestHash: null, transcriptArchive: null,
    selectedResourceKeys: [],
    mandatoryDelivered: null, expectedAnchorDelivered: null, expectedAnchorInOutcome: null,
    staleBlocked: fixture.kind === 'concurrent-cas' ? false : null,
    crossScopeBlocked: fixture.kind === 'cross-scope-attack' ? false : null,
    grade: null, gradeEvidence: null, gradeFailureEvidence: null,
    failureEvidence: await classifyHarnessFailureV1(error, { stage: 'gate' }),
    structuredFailureEvidence: structuredOutputFailureEvidenceV1(error),
    error: safeError(error),
    durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
  }
}

function isModelFixture(fixture: RacesGatewayEvalFixtureV1): boolean {
  return fixture.kind !== 'cross-scope-attack' && fixture.kind !== 'concurrent-cas'
}

async function cleanupCompletedProjectsV1(input: {
  checkpoint: RacesGatewayEvalCheckpointV1
  fixtures: readonly RacesGatewayEvalFixtureV1[]
}): Promise<void> {
  const stillNeeded = new Set(input.fixtures
    .slice(input.checkpoint.nextIndex)
    .map(fixture => fixture.sourceCaseId)
    .filter((value): value is string => value != null))
  const disposable = new Set(input.checkpoint.results
    .filter(result => result.status === 'passed' && result.projectId != null && !stillNeeded.has(result.fixtureId))
    .map(result => result.projectId!))
  for (const projectId of disposable) {
    if (await db.projects.get(projectId)) await cascadeDeleteProject(projectId)
  }
}

export async function verifyRacesGatewayEvalCheckpointV1(
  checkpoint: RacesGatewayEvalCheckpointV1,
  fixtures: readonly RacesGatewayEvalFixtureV1[] = RACES_GATEWAY_EVAL_FIXTURES_V1,
): Promise<boolean> {
  try {
    if (checkpoint.version !== RACES_GATEWAY_EVAL_VERSION_V21
      || !/^[a-f0-9]{64}$/.test(checkpoint.fixtureHash)
      || !/^[a-f0-9]{64}$/.test(checkpoint.checkpointHash)) return false
    if (await hashCanonicalValue(fixtures) !== checkpoint.fixtureHash) return false
    if (await hashCanonicalValue(checkpointBody(checkpoint)) !== checkpoint.checkpointHash) return false
    if (checkpoint.nextIndex < 0 || checkpoint.nextIndex > fixtures.length) return false
    if (!checkpoint.graderPreflight
      || checkpoint.graderPreflight.provider !== checkpoint.graderIdentity.provider
      || checkpoint.graderPreflight.model !== checkpoint.graderIdentity.model
      || checkpoint.graderPreflight.promptVersion !== checkpoint.graderIdentity.promptVersion
      || !/^[a-f0-9]{64}$/.test(checkpoint.graderPreflight.inputHash)
      || !/^[a-f0-9]{64}$/.test(checkpoint.graderPreflight.outputHash)) return false
    if (checkpoint.results.some((result, index) => result.fixtureId !== fixtures[index]?.id)) return false
    for (let index = 0; index < checkpoint.results.length; index += 1) {
      const result = checkpoint.results[index]
      const fixture = fixtures[index]
      if (!fixture || result.kind !== fixture.kind) return false
      if ((result.status === 'failed') !== (result.failureEvidence !== null)
        || (result.status === 'failed') !== (result.failureStage !== null)) return false
      if (result.gradeFailureEvidence) {
        if (result.failureStage !== 'grader'
          || result.gradeFailureEvidence.rawOutput.length > 240_000
          || await hashCanonicalValue(result.gradeFailureEvidence.rawOutput)
            !== result.gradeFailureEvidence.outputHash) return false
      }
      if (result.structuredFailureEvidence) {
        parseStructuredOutputRunEvidenceV1(result.structuredFailureEvidence)
      }
      if (!isModelFixture(fixture)) continue
      if (!result.transcriptArchive) {
        if (result.status === 'passed') return false
        continue
      }
      const transcript = await readRacesGatewayTranscriptArchiveV1(result.transcriptArchive)
      if (transcript.version !== 1) {
        if (result.status === 'passed') return false
        continue
      }
      if (transcript.manifest.manifestHash !== result.contextManifestHash) return false
      const roles = new Set(transcript.manifest.artifacts.map(item => item.role))
      for (const role of ['selector-result', 'context-packet', 'rendered-request', 'raw-response']) {
        if (!roles.has(role as never)
          || !Object.keys(transcript.artifactBodies).some(key => key.startsWith(`${role}:`))) return false
      }
      for (const ref of transcript.manifest.artifacts) {
        if (ref.role === 'source-snapshot' && ref.resourceKey
          && result.selectedResourceKeys.includes(ref.resourceKey)
          && transcript.artifactBodies[`source-snapshot:${ref.contentHash}`] == null) return false
      }
      if (result.status !== 'passed') continue
      if (fixture.kind === 'empty' || fixture.kind === 'partial-world'
        || fixture.kind === 'pinned-mandatory') {
        if (!result.grade || !result.gradeEvidence
          || result.gradeEvidence.provider !== checkpoint.graderIdentity.provider
          || result.gradeEvidence.model !== checkpoint.graderIdentity.model
          || result.gradeEvidence.promptVersion !== checkpoint.graderIdentity.promptVersion) return false
      }
    }
    const attemptCounts = new Map<string, number>()
    for (const failure of checkpoint.attemptFailures) {
      const fixture = fixtures.find(item => item.id === failure.fixtureId)
      const expectedAttempt = (attemptCounts.get(failure.fixtureId) ?? 0) + 1
      if (!fixture
        || failure.attempt !== expectedAttempt
        || !Number.isInteger(failure.recordedAt)
        || failure.recordedAt < checkpoint.startedAt
        || failure.result.fixtureId !== fixture.id
        || failure.result.kind !== fixture.kind
        || failure.result.status !== 'failed') return false
      attemptCounts.set(failure.fixtureId, expectedAttempt)
      if (failure.result.transcriptArchive) {
        const transcript = await readRacesGatewayTranscriptArchiveV1(failure.result.transcriptArchive)
        if (transcript.version === 1) {
          if (transcript.manifest.manifestHash !== failure.result.contextManifestHash) return false
        } else {
          const kinds = new Set(transcript.artifactRefs.map(ref => ref.artifactKind))
          for (const kind of ['selector-result', 'context-packet', 'rendered-request']) {
            if (!kinds.has(kind as never)) return false
          }
          if (failure.result.structuredFailureEvidence && !kinds.has('raw-response')) return false
        }
      }
    }
    if (checkpoint.status === 'completed' && (checkpoint.nextIndex !== fixtures.length || !checkpoint.score)) return false
    return true
  } catch {
    return false
  }
}

export function loadRacesGatewayEvalCheckpointV1(): RacesGatewayEvalCheckpointV1 | null {
  try {
    const raw = localStorage.getItem(RACES_GATEWAY_EVAL_STORAGE_KEY_V21)
    return raw ? JSON.parse(raw) as RacesGatewayEvalCheckpointV1 : null
  } catch {
    return null
  }
}

export function persistRacesGatewayEvalCheckpointV1(checkpoint: RacesGatewayEvalCheckpointV1): void {
  localStorage.setItem(RACES_GATEWAY_EVAL_STORAGE_KEY_V21, JSON.stringify(checkpoint))
}

export function exportRacesGatewayEvalCheckpointV1(checkpoint: RacesGatewayEvalCheckpointV1): string {
  return JSON.stringify(checkpoint, null, 2)
}

export async function cleanupRacesGatewayEvalProjectsV1(): Promise<number> {
  const projectIds = [...new Set((await db.works.toArray())
    .filter(work => work.description.startsWith(PROJECT_MARKER))
    .map(work => work.projectId))]
  for (const projectId of projectIds) await cascadeDeleteProject(projectId)
  return projectIds.length
}

export async function clearRacesGatewayEvalCheckpointV1(): Promise<void> {
  localStorage.removeItem(RACES_GATEWAY_EVAL_STORAGE_KEY_V21)
  await cleanupRacesGatewayEvalProjectsV1()
}

export async function runRacesGatewayEvalV1(input: {
  modelIdentity: { provider: string; model: string }
  generatorConfig: AIConfig
  graderIdentity: { provider: string; model: string; promptVersion: string }
  graderPreflight: RacesGatewayBlindGradeEvidenceV1
  grade: RacesGatewayBlindGraderV1
  fixtures?: readonly RacesGatewayEvalFixtureV1[]
  resumeFrom?: RacesGatewayEvalCheckpointV1 | null
  onProgress?: (progress: RacesGatewayEvalProgressV1) => void | Promise<void>
}): Promise<RacesGatewayEvalCheckpointV1> {
  const fixtures = input.fixtures ?? RACES_GATEWAY_EVAL_FIXTURES_V1
  if (!fixtures.length) throw new Error('RACE-6 评测集不能为空')
  if (input.generatorConfig.provider !== input.modelIdentity.provider
    || input.generatorConfig.model !== input.modelIdentity.model) {
    throw new Error('RACE-6 generator 配置与冻结模型身份不一致')
  }
  if (input.modelIdentity.provider === input.graderIdentity.provider) {
    throw new Error('RACE-6 V21 generator 与盲评 grader 必须使用不同提供商身份')
  }
  if (input.graderPreflight.provider !== input.graderIdentity.provider
    || input.graderPreflight.model !== input.graderIdentity.model
    || input.graderPreflight.promptVersion !== input.graderIdentity.promptVersion) {
    throw new Error('RACE-6 grader schema preflight 与冻结模型身份不一致')
  }
  const fixtureHash = await hashCanonicalValue(fixtures)
  let checkpoint: RacesGatewayEvalCheckpointV1
  if (input.resumeFrom) {
    if (!await verifyRacesGatewayEvalCheckpointV1(input.resumeFrom, fixtures)) {
      throw new Error('RACE-6 checkpoint 验签失败')
    }
    if (input.resumeFrom.fixtureHash !== fixtureHash
      || input.resumeFrom.modelIdentity.provider !== input.modelIdentity.provider
      || input.resumeFrom.modelIdentity.model !== input.modelIdentity.model
      || JSON.stringify(input.resumeFrom.graderIdentity) !== JSON.stringify(input.graderIdentity)) {
      throw new Error('RACE-6 checkpoint 与当前冻结夹具或模型身份不一致')
    }
    if (input.resumeFrom.status === 'completed') return input.resumeFrom
    checkpoint = {
      ...structuredClone(input.resumeFrom),
      status: 'running',
      results: input.resumeFrom.results.slice(0, input.resumeFrom.nextIndex),
      score: null,
    }
  } else {
    // A new protocol run may follow a failed older checkpoint. Evaluation
    // workspaces are disposable and must never become invisible orphans.
    await cleanupRacesGatewayEvalProjectsV1()
    const now = Date.now()
    checkpoint = await sealCheckpoint({
      version: RACES_GATEWAY_EVAL_VERSION_V21,
      fixtureHash,
      modelIdentity: input.modelIdentity,
      graderIdentity: input.graderIdentity,
      graderPreflight: input.graderPreflight,
      thresholds: RACES_GATEWAY_EVAL_THRESHOLDS_V1,
      nextIndex: 0,
      status: 'running',
      results: [],
      attemptFailures: [],
      score: null,
      startedAt: now,
      updatedAt: now,
      checkpointHash: EMPTY_HASH,
    })
  }
  await cleanupCompletedProjectsV1({ checkpoint, fixtures })
  const save = async (fixture: RacesGatewayEvalFixtureV1) => {
    checkpoint = await sealCheckpoint({ ...checkpoint, updatedAt: Date.now() })
    persistRacesGatewayEvalCheckpointV1(checkpoint)
    await input.onProgress?.({ fixture, completed: checkpoint.nextIndex, total: fixtures.length, checkpoint })
  }
  for (let index = checkpoint.nextIndex; index < fixtures.length; index += 1) {
    const fixture = fixtures[index]
    await input.onProgress?.({ fixture, completed: checkpoint.nextIndex, total: fixtures.length, checkpoint })
    let result: RacesGatewayEvalResultV1
    if (fixture.kind === 'cross-scope-attack') result = await executeCrossScopeFixture(fixture, checkpoint.results)
    else if (fixture.kind === 'concurrent-cas') result = await executeCasFixture(fixture, checkpoint.results)
    else result = await executeModelFixture({
      fixture,
      modelIdentity: input.modelIdentity,
      generatorConfig: input.generatorConfig,
      grade: input.grade,
    })
    checkpoint.results = [...checkpoint.results.slice(0, index), result]
    if (result.status === 'failed') {
      const attempt = checkpoint.attemptFailures
        .filter(item => item.fixtureId === fixture.id).length + 1
      checkpoint.attemptFailures = [...checkpoint.attemptFailures, {
        fixtureId: fixture.id,
        attempt,
        recordedAt: Date.now(),
        result,
      }]
      checkpoint.status = 'failed'
      checkpoint.nextIndex = index
      await save(fixture)
      throw new Error(`RACE-6 ${fixture.id} 执行失败：${result.error ?? '未知错误'}`)
    }
    checkpoint.nextIndex = index + 1
    await save(fixture)
    await cleanupCompletedProjectsV1({ checkpoint, fixtures })
  }
  checkpoint.score = scoreRacesGatewayEvalV1(
    checkpoint.results,
    checkpoint.thresholds,
    fixtures,
    checkpoint.attemptFailures,
  )
  checkpoint.status = 'completed'
  checkpoint = await sealCheckpoint({ ...checkpoint, updatedAt: Date.now() })
  persistRacesGatewayEvalCheckpointV1(checkpoint)
  return checkpoint
}
