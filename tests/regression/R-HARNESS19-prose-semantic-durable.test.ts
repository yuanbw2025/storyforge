import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { createContextManifestFromAssemblyV1 } from '../../src/lib/agent/run/context-manifest'
import {
  beginProseGenerationStepV1,
  beginProseSemanticStepV1,
  commitProseGenerationAdoptionV1,
  completeProseSemanticStepV1,
  createProseGenerationDurableRunV1,
  hashProseGenerationCandidateV1,
  isProseGenerationCandidateCurrentV1,
  persistProseGenerationCandidateV1,
  readLatestProseGenerationCandidateV1,
  recordProseGenerationCandidateV1,
  recordProseGenerationModelOutputV1,
  recordProseSemanticModelOutputV1,
  recoverProseGenerationCandidateV1,
  PROSE_GENERATION_SOURCE_KEYS_V1,
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
import { runDurableProseSemanticReviewV1 } from '../../src/lib/agent/run/prose-semantic-durable'

async function seedWorkspace(): Promise<{
  scope: WorkspaceScope
  outlineNodeId: number
  chapterId: number
}> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: 'H19 正文语义闭环',
    genre: 'fantasy',
    genres: ['fantasy'],
    status: 'drafting',
    description: '',
    targetWordCount: 100_000,
    worldCode: 'h19-world',
    worldVersion: 1,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({
    projectId,
    code: 'h19-world',
    name: '潮门世界',
    description: '',
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId,
    worldId,
    title: '潮门',
    description: '',
    genres: ['fantasy'],
    status: 'drafting',
    targetWordCount: 100_000,
    createdAt: now,
    updatedAt: now,
  }) as number
  await db.projects.update(projectId, {
    activeWorldId: worldId,
    activeWorkId: workId,
    ownershipSchemaVersion: 1,
  })
  const outlineNodeId = await db.outlineNodes.add({
    projectId,
    workId,
    parentId: null,
    type: 'chapter',
    title: '潮门',
    summary: '守灯人在潮门外观察退潮，不知道月井密钥。',
    order: 0,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const chapterId = await db.chapters.add({
    projectId,
    workId,
    outlineNodeId,
    title: '潮门',
    content: '',
    wordCount: 0,
    status: 'outline',
    order: 0,
    notes: '',
    createdAt: now,
    updatedAt: now,
  } as any) as number
  return { scope: { projectId, worldId, workId }, outlineNodeId, chapterId }
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
    const generationAssembled = await assembleContext({
      projectId: fixture.scope.projectId,
      scope: fixture.scope,
      chapterId: fixture.chapterId,
      outlineNodeId: fixture.outlineNodeId,
      sourceKeys: [...PROSE_GENERATION_SOURCE_KEYS_V1],
      inputBudgetMaxTokens: 48_000,
    })
    const generationManifest = await createContextManifestFromAssemblyV1({
      runId: snapshot.run.id,
      stepId: PROSE_GENERATION_STEP_ID_V1,
      attempt: 1,
      projectId: fixture.scope.projectId,
      worldGroupId: null,
      declaredSourceKeys: PROSE_GENERATION_SOURCE_KEYS_V1,
      assembled: generationAssembled,
      boundary: { chapterId: fixture.chapterId, outlineNodeId: fixture.outlineNodeId },
      readerVersion: 'chapter-prose-generation-context-v1',
    })
    const boundary = await buildChapterInformationBoundaryV1({
      scope: fixture.scope,
      chapterId: fixture.chapterId,
      outlineNodeId: fixture.outlineNodeId,
      worldGroupId: null,
      perspectiveCharacterId: null,
    })
    const messages = [{ role: 'user' as const, content: '写潮门正文' }]
    snapshot = await beginProseGenerationStepV1({
      scope: fixture.scope,
      snapshot,
      contextManifest: generationManifest,
      binding: {
        operation: 'generate',
        sourceTextHash: await hashChapterText(''),
        promptHash: await hashCanonicalValue(messages),
        informationBoundaryHash: boundary.manifestHash,
      },
      budgetReservationTokens: 18_000,
    })
    const outputText = '守灯人说出了月井密钥。'
    snapshot = await recordProseGenerationModelOutputV1({
      scope: fixture.scope,
      snapshot,
      output: outputText,
      usedTokens: 1_200,
    })
    const stages: string[] = []
    const publishedSequences: number[] = []
    const review = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({
        issues: [{
          code: 'pov-knowledge-leak',
          severity: 'blocking',
          candidateQuote: outputText,
          evidence: [{ sourceKey: 'chapterOutline', quote: '不知道月井密钥' }],
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

    const generationAssembled = await assembleContext({
      projectId: fixture.scope.projectId,
      scope: fixture.scope,
      chapterId: fixture.chapterId,
      outlineNodeId: fixture.outlineNodeId,
      sourceKeys: [...PROSE_GENERATION_SOURCE_KEYS_V1],
      inputBudgetMaxTokens: 48_000,
    })
    const generationManifest = await createContextManifestFromAssemblyV1({
      runId: snapshot.run.id,
      stepId: PROSE_GENERATION_STEP_ID_V1,
      attempt: 1,
      projectId: fixture.scope.projectId,
      worldGroupId: null,
      declaredSourceKeys: PROSE_GENERATION_SOURCE_KEYS_V1,
      assembled: generationAssembled,
      boundary: { chapterId: fixture.chapterId, outlineNodeId: fixture.outlineNodeId },
      readerVersion: 'chapter-prose-generation-context-v1',
    })
    const sourceTextHash = await hashChapterText('')
    const boundary = await buildChapterInformationBoundaryV1({
      scope: fixture.scope,
      chapterId: fixture.chapterId,
      outlineNodeId: fixture.outlineNodeId,
      worldGroupId: null,
      perspectiveCharacterId: null,
    })
    snapshot = await beginProseGenerationStepV1({
      scope: fixture.scope,
      snapshot,
      contextManifest: generationManifest,
      binding: {
        operation: 'generate',
        sourceTextHash,
        promptHash: await hashCanonicalValue([{ role: 'user', content: '写潮门正文' }]),
        informationBoundaryHash: boundary.manifestHash,
      },
      budgetReservationTokens: 18_000,
    })
    const outputText = '守灯人站在潮门外，只观察潮水退去。'
    snapshot = await recordProseGenerationModelOutputV1({
      scope: fixture.scope,
      snapshot,
      output: outputText,
      usedTokens: 1_200,
    })

    const reviewSkill = getAgentSkillV1('prose.review')
    const reviewSourceKeys = resolveAgentSkillContextSourceKeysV1(reviewSkill)
    const reviewAssembled = await assembleContext({
      projectId: fixture.scope.projectId,
      scope: fixture.scope,
      chapterId: fixture.chapterId,
      outlineNodeId: fixture.outlineNodeId,
      sourceKeys: reviewSourceKeys,
      inputBudgetMaxTokens: 24_000,
    })
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
    const reviewerBinding = createAgentSkillExecutionBindingV1(reviewSkill)
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
        promptVersion: 'prose-semantic-review-v1',
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
      outputText,
      outputTextHash: await hashCanonicalValue(outputText),
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
      promptVersion: 'prose-semantic-review-v1',
    })
    expect(completed.receipt?.criteria.some(criterion => (
      criterion.id === 'prose-generation.semantic-review'
        && criterion.evidenceRefs.includes(`semantic-review:${cycle.finalReview.artifactHash}`)
    ))).toBe(true)
    expect(completed.snapshot.events.filter(event => event.type === 'budget.settled')).toHaveLength(2)
  })
})
