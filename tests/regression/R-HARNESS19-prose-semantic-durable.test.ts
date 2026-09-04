import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { createContextManifestFromAssemblyV1 } from '../../src/lib/agent/run/context-manifest'
import {
  beginProseGenerationGatewayStepV1,
  beginProseSemanticStepV1,
  commitProseGenerationAdoptionV1,
  completeProseSemanticStepV1,
  createProseGenerationDurableRunV1,
  finalizeProseGenerationGatewayStepV1,
  hashProseGenerationCandidateV1,
  isProseGenerationCandidateCurrentV1,
  persistProseGenerationCandidateV1,
  readLatestProseGenerationCandidateV1,
  recordProseGenerationCandidateV1,
  recordProseSemanticModelOutputV1,
  recoverProseGenerationCandidateV1,
  PROSE_GENERATION_STEP_ID_V1,
  PROSE_SEMANTIC_REVIEW_STEP_ID_V1,
  type ProseGenerationCandidateV1,
} from '../../src/lib/agent/run/prose-generation-durable'
import {
  runProseSemanticReviewCycleV1,
} from '../../src/lib/agent/prose-semantic-review'
import { createAgentSkillExecutionBindingV1 } from '../../src/lib/agent/execution-binding'
import {
  getAgentSkillV1,
  resolveAgentSkillContextSourceKeysV1,
} from '../../src/lib/agent/skill-registry'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { buildChapterInformationBoundaryV1 } from '../../src/lib/agent/information-boundary'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { hashChapterText } from '../../src/lib/ai/chapter-memory/text-normalization'
import type { WorkspaceScope } from '../../src/lib/types'
import type { AssembleContextResult } from '../../src/lib/registry/types'
import { runDurableProseSemanticReviewV1 } from '../../src/lib/agent/run/prose-semantic-durable'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { prepareProseGatewayAssemblyV1 } from '../../src/lib/prose/gateway-context'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { captureWorkspaceContentRevisionV1 } from '../../src/lib/authoring/content-revision'

function withGatewayEvidence(assembled: AssembleContextResult): AssembleContextResult {
  const content = '【章纲】守灯人在潮门外观察退潮，不知道月井密钥。'
  return {
    ...assembled,
    text: content,
    segments: [{ label: 'Context Gateway', layer: 'L0', content, tokens: 24, trimmable: false }],
    included: ['ragSelection'],
    omitted: [],
    sourceEvidence: [{
      key: 'ragSelection', status: 'included', delivery: 'full', sourceHash: 'a'.repeat(64),
      originalCharacters: content.length, inputCharacters: content.length,
      originalTokens: 24, inputTokens: 24,
    }],
    totalInputTokens: 24,
  }
}

async function seedWorkspace(): Promise<{
  scope: WorkspaceScope
  outlineNodeId: number
  chapterId: number
}> {
  const now = Date.now()
  const created = await createWorkspace({
    name: 'H19 正文语义闭环', genres: ['fantasy'], status: 'drafting',
    description: '', targetWordCount: 100_000,
  }, { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' })
  const { scope } = created
  const projectId = scope.projectId
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
    projectId,
    parentId: null,
    type: 'chapter',
    title: '潮门',
    summary: '守灯人在潮门外观察退潮，不知道月井密钥。',
    order: 0,
    createdAt: now,
    updatedAt: now,
  } as any, { owner: 'work' })) as number
  await db.detailedOutlines.add(stampNewRecord(scope, 'detailedOutlines', {
    projectId, outlineNodeId,
    scenes: [{ sceneId: 'scene-1', title: '观察退潮', summary: '守灯人在潮门外观察退潮。', characterIds: [], location: '潮门', conflict: '秘密不可泄漏', pace: 'medium', estimatedWords: 1000 }],
    openingHook: '退潮开始。', endingCliffhanger: '潮门震动。', sceneLocation: '潮门',
    appearingCharacterIds: [], foreshadowIds: [], emotionArc: 'rising',
    prohibitions: ['守灯人不知道月井密钥'], lastUsedSummary: '守灯人在潮门外观察退潮。',
    createdAt: now, updatedAt: now,
  } as any, { owner: 'work' }))
  const chapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', {
    projectId,
    outlineNodeId,
    title: '潮门',
    content: '',
    wordCount: 0,
    status: 'outline',
    order: 0,
    notes: '',
    createdAt: now,
    updatedAt: now,
    perspectiveCharacterId: null,
  } as any, { owner: 'work' })) as number
  return { scope, outlineNodeId, chapterId }
}

describe.sequential('R-HARNESS19 · 正文语义评审 durable 主路径', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('统一运行入口装配 Skill 上下文并持久化初审、修订和复核步骤', async () => {
    const fixture = await seedWorkspace()
    let snapshot = await createProseGenerationDurableRunV1({
      scope: fixture.scope,
      worldGroupId: null,
      chapterId: fixture.chapterId,
      operation: 'generate',
      semanticReview: true,
    })
    const generationAssembled = await prepareProseGatewayAssemblyV1({
      projectId: fixture.scope.projectId,
      scope: fixture.scope,
      worldGroupId: null,
      chapterId: fixture.chapterId,
      outlineNodeId: fixture.outlineNodeId,
      operation: 'generate', authorRequest: '写潮门正文', perspectiveCharacterId: null,
      config: useAIConfigStore.getState().config,
    })
    const boundary = await buildChapterInformationBoundaryV1({
      scope: fixture.scope,
      chapterId: fixture.chapterId,
      outlineNodeId: fixture.outlineNodeId,
      worldGroupId: null,
      perspectiveCharacterId: null,
    })
    const messages = [{ role: 'user' as const, content: '写潮门正文' }]
    const begun = await beginProseGenerationGatewayStepV1({
      scope: fixture.scope,
      snapshot,
      worldGroupId: null,
      chapterId: fixture.chapterId,
      outlineNodeId: fixture.outlineNodeId,
      assembled: generationAssembled,
      messages,
      binding: {
        operation: 'generate',
        sourceTextHash: await hashChapterText(''),
        promptHash: await hashCanonicalValue(messages),
        informationBoundaryHash: boundary.manifestHash,
      },
      budgetReservationTokens: 18_000,
    })
    snapshot = begun.snapshot
    const outputText = '守灯人说出了月井密钥。'
    const finalized = await finalizeProseGenerationGatewayStepV1({
      scope: fixture.scope,
      snapshot,
      attempt: begun.attempt,
      output: outputText,
      usedTokens: 1_200,
    })
    snapshot = finalized.snapshot
    const stages: string[] = []
    const publishedSequences: number[] = []
    const review = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({
        issues: [{
          code: 'pov-knowledge-leak',
          severity: 'blocking',
          candidateQuote: outputText,
          evidence: [{ sourceKey: 'ragSelection', quote: '不知道月井密钥' }],
          reason: '守灯人使用了尚未知晓的密钥。',
          revisionInstruction: '改为只观察潮水，不说出密钥。',
          autoRevisable: true,
        }],
      }))
      .mockResolvedValueOnce('{"issues":[]}')
    const revise = vi.fn(async () => '守灯人站在潮门外，只观察潮水退去。')

    const result = await runDurableProseSemanticReviewV1({
      scope: fixture.scope,
      snapshot,
      projectId: fixture.scope.projectId,
      worldGroupId: null,
      chapterId: fixture.chapterId,
      outlineNodeId: fixture.outlineNodeId,
      chapterTitle: '潮门',
      originalText: outputText,
      generationMessages: messages,
      generationAssembled,
      informationBoundary: boundary,
      generationProvider: 'test-provider',
      generationModel: 'test-model',
      reviewerProvider: 'custom',
      reviewerModel: 'test-reviewer',
      budget: new AgentTeamBudgetTracker('balanced'),
      review,
      revise,
      onStage: stage => stages.push(stage),
      onSnapshot: next => publishedSequences.push(next.projection.lastSequence),
    })

    expect(result.cycle.status).toBe('passed')
    expect(result.cycle.outputText).toBe('守灯人站在潮门外，只观察潮水退去。')
    expect(result.cycle.initialReview.verdict).toBe('revise')
    expect(result.cycle.finalReview.verdict).toBe('pass')
    expect(review).toHaveBeenCalledTimes(2)
    expect(revise).toHaveBeenCalledOnce()
    expect(stages).toEqual(['reviewing', 'revising', 'rereviewing'])
    expect(publishedSequences).toHaveLength(9)
    expect(result.snapshot.events.filter(event => (
      event.type === 'step.succeeded' && event.payload.stepId.startsWith('prose-semantic-')
    ))).toHaveLength(3)
    expect(result.snapshot.events.filter(event => (
      event.type === 'context.assembled' && event.payload.stepId.startsWith('prose-semantic-')
    ))).toHaveLength(3)
  })

  it('冻结生成/评审/修订版本，恢复通过语义候选，并把 reviewer 写入 terminal receipt', async () => {
    const fixture = await seedWorkspace()
    let snapshot = await createProseGenerationDurableRunV1({
      scope: fixture.scope,
      worldGroupId: null,
      chapterId: fixture.chapterId,
      operation: 'generate',
      semanticReview: true,
    })
    expect(snapshot.contract.workflowKind).toBe('generate-verify-revise')
    expect(snapshot.contract.budget.maxModelCalls).toBe(4)
    expect(snapshot.contract.executionBindings?.map(binding => binding.stepId)).toEqual([
      'prose-generation',
      'prose-semantic-review',
      'prose-semantic-revision',
      'prose-semantic-rereview',
    ])

    const generationAssembled = await prepareProseGatewayAssemblyV1({
      projectId: fixture.scope.projectId,
      scope: fixture.scope,
      worldGroupId: null,
      chapterId: fixture.chapterId,
      outlineNodeId: fixture.outlineNodeId,
      operation: 'generate', authorRequest: '写潮门正文', perspectiveCharacterId: null,
      config: useAIConfigStore.getState().config,
    })
    const sourceTextHash = await hashChapterText('')
    const boundary = await buildChapterInformationBoundaryV1({
      scope: fixture.scope,
      chapterId: fixture.chapterId,
      outlineNodeId: fixture.outlineNodeId,
      worldGroupId: null,
      perspectiveCharacterId: null,
    })
    const generationMessages = [{ role: 'user' as const, content: `受控资料：\n${generationAssembled.text}\n\n写潮门正文` }]
    const begun = await beginProseGenerationGatewayStepV1({
      scope: fixture.scope,
      snapshot,
      worldGroupId: null,
      chapterId: fixture.chapterId,
      outlineNodeId: fixture.outlineNodeId,
      assembled: generationAssembled,
      messages: generationMessages,
      binding: {
        operation: 'generate',
        sourceTextHash,
        promptHash: await hashCanonicalValue(generationMessages),
        informationBoundaryHash: boundary.manifestHash,
      },
      budgetReservationTokens: 18_000,
    })
    snapshot = begun.snapshot
    const outputText = '守灯人站在潮门外，只观察潮水退去。'
    const finalized = await finalizeProseGenerationGatewayStepV1({
      scope: fixture.scope,
      snapshot,
      attempt: begun.attempt,
      output: outputText,
      usedTokens: 1_200,
    })
    snapshot = finalized.snapshot
    const generationManifest = finalized.manifest

    const reviewSkill = getAgentSkillV1('prose.review')
    const reviewSourceKeys = resolveAgentSkillContextSourceKeysV1(reviewSkill)
    const reviewAssembled = withGatewayEvidence(await assembleContext({
      projectId: fixture.scope.projectId,
      scope: fixture.scope,
      chapterId: fixture.chapterId,
      outlineNodeId: fixture.outlineNodeId,
      sourceKeys: reviewSourceKeys,
      inputBudgetMaxTokens: 24_000,
    }))
    const reviewManifest = await createContextManifestFromAssemblyV1({
      runId: snapshot.run.id,
      stepId: PROSE_SEMANTIC_REVIEW_STEP_ID_V1,
      attempt: 1,
      projectId: fixture.scope.projectId,
      worldGroupId: null,
      declaredSourceKeys: reviewSourceKeys,
      assembled: reviewAssembled,
      boundary: { chapterId: fixture.chapterId, outlineNodeId: fixture.outlineNodeId },
      readerVersion: 'prose-semantic-review-context-v1',
    })
    const contractBinding = snapshot.contract.executionBindings?.find(binding => (
      binding.stepId === PROSE_SEMANTIC_REVIEW_STEP_ID_V1
    ))
    if (!contractBinding) throw new Error('测试夹具缺少冻结语义评审 binding')
    const { stepId: _stepId, ...reviewerBinding } = contractBinding
    snapshot = await beginProseSemanticStepV1({
      scope: fixture.scope,
      snapshot,
      stepId: PROSE_SEMANTIC_REVIEW_STEP_ID_V1,
      contextManifest: reviewManifest,
      executionBinding: reviewerBinding,
      requestBinding: { candidateTextHash: await hashCanonicalValue(outputText) },
      reservedTokens: 4_000,
    })
    const rawReview = '{"issues":[]}'
    snapshot = await recordProseSemanticModelOutputV1({
      scope: fixture.scope,
      snapshot,
      stepId: PROSE_SEMANTIC_REVIEW_STEP_ID_V1,
      output: rawReview,
      usedTokens: 900,
    })
    const cycle = await runProseSemanticReviewCycleV1({
      chapterTitle: '潮门',
      originalText: outputText,
      generationMessages: [{ role: 'user', content: '写潮门正文' }],
      assembled: reviewAssembled,
      contextManifestHashes: {
        initial: reviewManifest.manifestHash,
        final: 'f'.repeat(64),
      },
      reviewer: {
        provider: 'test-provider',
        model: 'test-reviewer',
        promptVersion: getAgentSkillV1('prose.review').promptVersion,
        executionBinding: reviewerBinding,
        correlatedJudge: true,
      },
      revisionExecutionBinding: createAgentSkillExecutionBindingV1(getAgentSkillV1('prose.revise')),
      budget: new AgentTeamBudgetTracker('balanced'),
      review: vi.fn(async () => rawReview),
      revise: vi.fn(async text => text.map(message => message.content).join('\n')),
      validateRevision: async () => [],
    })
    snapshot = await completeProseSemanticStepV1({
      scope: fixture.scope,
      snapshot,
      stepId: PROSE_SEMANTIC_REVIEW_STEP_ID_V1,
      artifactHash: cycle.finalReview.artifactHash,
    })

    const candidateBody = {
      version: 1 as const,
      type: 'prose-generation-candidate' as const,
      projectId: fixture.scope.projectId,
      chapterId: fixture.chapterId,
      chapterTitle: '潮门',
      worldGroupId: null,
      operation: 'generate' as const,
      sourceTextHash,
      contentRevision: await captureWorkspaceContentRevisionV1({ scope: fixture.scope, worldGroupId: null }),
      outputText,
      outputTextHash: await hashCanonicalValue(outputText),
      gatewayEvidenceVersion: 3 as const,
      expectedContentHash: await hashChapterText(outputText),
      informationBoundaryHash: boundary.manifestHash,
      perspectiveCharacterId: null,
      perspectiveFromChapter: false,
      semanticReview: {
        version: 1 as const,
        initial: cycle.initialReview,
        final: cycle.finalReview,
        budget: cycle.budget,
      },
      createdAt: Date.now(),
    }
    const candidate: ProseGenerationCandidateV1 = {
      ...candidateBody,
      durable: {
        runId: snapshot.run.id,
        stepId: PROSE_GENERATION_STEP_ID_V1,
        attempt: 1,
        contextManifestHash: generationManifest.manifestHash,
        candidateHash: await hashProseGenerationCandidateV1(candidateBody),
      },
    }
    await persistProseGenerationCandidateV1({ scope: fixture.scope, candidate })
    snapshot = await recordProseGenerationCandidateV1({ scope: fixture.scope, snapshot, candidate })
    expect(snapshot.projection.state).toBe('awaiting_confirmation')

    const restored = await readLatestProseGenerationCandidateV1({
      scope: fixture.scope,
      chapterId: fixture.chapterId,
    })
    expect(restored?.semanticReview?.final.artifactHash).toBe(cycle.finalReview.artifactHash)
    expect((await recoverProseGenerationCandidateV1({ scope: fixture.scope, candidate }))?.projection.state)
      .toBe('awaiting_confirmation')

    const tampered = structuredClone(candidate)
    tampered.semanticReview!.final.artifactHash = '0'.repeat(64)
    expect(await isProseGenerationCandidateCurrentV1(tampered)).toBe(false)

    const ledgerMismatch = structuredClone(candidate)
    const { artifactHash: _oldArtifactHash, ...forgedArtifactBody } = ledgerMismatch.semanticReview!.initial
    const forgedArtifact = {
      ...forgedArtifactBody,
      contextManifestHash: 'e'.repeat(64),
      artifactHash: '',
    }
    forgedArtifact.artifactHash = await hashCanonicalValue({
      ...forgedArtifactBody,
      contextManifestHash: forgedArtifact.contextManifestHash,
    })
    ledgerMismatch.semanticReview!.initial = forgedArtifact
    ledgerMismatch.semanticReview!.final = forgedArtifact
    const { durable: _oldDurable, ...forgedCandidateBody } = ledgerMismatch
    ledgerMismatch.durable.candidateHash = await hashProseGenerationCandidateV1(forgedCandidateBody)
    expect(await isProseGenerationCandidateCurrentV1(ledgerMismatch)).toBe(false)

    const completed = await commitProseGenerationAdoptionV1({
      scope: fixture.scope,
      runId: snapshot.run.id,
      candidate,
      contentHtml: `<p>${outputText}</p>`,
      wordCount: outputText.length,
    })
    expect(completed.snapshot.projection.state).toBe('completed')
    expect(completed.receipt?.semanticVerifier).toEqual({
      provider: 'test-provider',
      model: 'test-reviewer',
      promptVersion: 'prose-semantic-review-v2',
    })
    expect(completed.receipt?.criteria.some(criterion => (
      criterion.id === 'prose-generation.semantic-review'
        && criterion.evidenceRefs.includes(`semantic-review:${cycle.finalReview.artifactHash}`)
    ))).toBe(true)
    expect(completed.snapshot.events.filter(event => event.type === 'budget.settled')).toHaveLength(2)
  })
})
