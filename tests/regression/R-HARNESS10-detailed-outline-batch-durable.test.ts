import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const clientMock = vi.hoisted(() => ({ output: '' }))
vi.mock('../../src/lib/ai/client', () => ({
  chat: vi.fn(async () => clientMock.output),
}))
import { db } from '../../src/lib/db/schema'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { adopt } from '../../src/lib/registry/adopt'
import { adoptChapterOutlineWorkshopResult } from '../../src/lib/outline/adopt-workshop'
import { batchGenerateDetails } from '../../src/lib/ai/batch-detail-runner'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import {
  beginDetailedOutlineBatchStepV1,
  commitDetailedOutlineBatchCandidateV1,
  createDetailedOutlineBatchDurableRunV1,
  detailedOutlineBatchManifestV1,
  detailedOutlineBatchStepIdV1,
  hashDetailedOutlineBatchCandidateV1,
  persistDetailedOutlineBatchCandidateV1,
  readLatestDetailedOutlineBatchCandidatesV1,
  recordDetailedOutlineBatchCandidateV1,
  recordDetailedOutlineBatchModelOutputV1,
  verifyDetailedOutlineBatchRunV1,
  type DetailedOutlineBatchCandidateV1,
} from '../../src/lib/agent/run/detailed-outline-batch-durable'
import type { WorkspaceScope } from '../../src/lib/types'

const OUTPUT = JSON.stringify({
  openingHook: '潮声从上一章的门缝里涌来。',
  endingCliffhanger: '灯芯忽然映出第二道影子。',
  sceneLocation: '潮门内港',
  emotionArc: 'rising',
  appearingCharacterIds: [],
  foreshadowIds: [],
  scenes: [{
    title: '潮门回响',
    summary: '守灯人发现潮门的刻痕正在移动。',
    location: '潮门内港',
    conflict: '时间紧迫与未知警告冲突。',
    pace: 'fast',
    characterIds: [],
    estimatedWords: 1200,
  }],
})

async function createWorkspace(): Promise<{
  scope: WorkspaceScope
  worldGroupId: number
  outlineNodeIds: number[]
}> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: '批量细纲 durable',
    genre: 'fantasy',
    genres: ['fantasy'],
    description: '',
    status: 'drafting',
    targetWordCount: 100_000,
    worldCode: 'batch-world',
    worldVersion: 1,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({
    projectId,
    code: 'batch-world',
    name: '批量世界',
    description: '',
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId,
    worldId,
    title: '批量作品',
    description: '',
    genres: ['fantasy'],
    status: 'drafting',
    targetWordCount: 100_000,
    createdAt: now,
    updatedAt: now,
  }) as number
  await db.projects.update(projectId, { activeWorldId: worldId, activeWorkId: workId, ownershipSchemaVersion: 1 })
  const worldGroupId = await db.worldGroups.add({
    projectId,
    name: '主世界',
    order: 0,
    createdAt: now,
    updatedAt: now,
  }) as number
  const outlineNodeIds = await db.outlineNodes.bulkAdd([
    {
      projectId,
      workId,
      worldGroupId,
      parentId: null,
      type: 'chapter',
      title: '潮门一',
      summary: '守灯人抵达潮门。',
      order: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      projectId,
      workId,
      worldGroupId,
      parentId: null,
      type: 'chapter',
      title: '潮门二',
      summary: '守灯人听见钟声。',
      order: 1,
      createdAt: now,
      updatedAt: now,
    },
  ] as any, { allKeys: true }) as number[]
  return { scope: { projectId, worldId, workId }, worldGroupId, outlineNodeIds }
}

async function createCandidate(input: {
  fixture: Awaited<ReturnType<typeof createWorkspace>>
  snapshot: Awaited<ReturnType<typeof createDetailedOutlineBatchDurableRunV1>>
  outlineNodeId: number
  recordLedger?: boolean
}) {
  const { fixture, outlineNodeId } = input
  const assembled = await assembleContext({
    projectId: fixture.scope.projectId,
    scope: fixture.scope,
    worldGroupId: fixture.worldGroupId,
    outlineNodeId,
    sourceKeys: [
      'canonAssertions', 'chapterOutline', 'adjacentChapterOutlines', 'worldview', 'storyCore',
      'activeNarrativeBlueprint', 'characterDrivenPlan', 'powerSystem',
      'cultivationProgress', 'codex', 'characters', 'creativeRules',
      'worldRules', 'historical', 'locations', 'foreshadows',
    ],
  })
  const manifest = await detailedOutlineBatchManifestV1({
    runId: input.snapshot.run.id,
    scope: fixture.scope,
    worldGroupId: fixture.worldGroupId,
    outlineNodeId,
    assembled,
  })
  let snapshot = await beginDetailedOutlineBatchStepV1({
    scope: fixture.scope,
    snapshot: input.snapshot,
    contextManifest: manifest,
    binding: {
      outlineNodeId,
      sourceSummaryHash: await hashCanonicalValue({ version: 1, summary: outlineNodeId === fixture.outlineNodeIds[0] ? '守灯人抵达潮门。' : '守灯人听见钟声。' }),
      promptHash: await hashCanonicalValue([{ role: 'user', content: '批量完善细纲' }]),
    },
  })
  snapshot = await recordDetailedOutlineBatchModelOutputV1({
    scope: fixture.scope,
    snapshot,
    outlineNodeId,
    output: OUTPUT,
  })
  const sourceSummaryHash = await hashCanonicalValue({
    version: 1,
    summary: outlineNodeId === fixture.outlineNodeIds[0] ? '守灯人抵达潮门。' : '守灯人听见钟声。',
  })
  const stepId = detailedOutlineBatchStepIdV1(outlineNodeId)
  const draft: DetailedOutlineBatchCandidateV1 = {
    version: 1,
    type: 'detailed-outline-batch-candidate',
    projectId: fixture.scope.projectId,
    runId: snapshot.run.id,
    stepId,
    outlineNodeId,
    worldGroupId: fixture.worldGroupId,
    operation: 'enhanced',
    sourceSummaryHash,
    output: OUTPUT,
    outputHash: await hashCanonicalValue(OUTPUT),
    contextManifestHash: manifest.manifestHash,
    workspaceScope: fixture.scope,
    createdAt: Date.now(),
    durable: { runId: snapshot.run.id, stepId, attempt: 1, candidateHash: '' },
  }
  const candidate: DetailedOutlineBatchCandidateV1 = {
    ...draft,
    durable: { ...draft.durable, candidateHash: await hashDetailedOutlineBatchCandidateV1(draft) },
  }
  const persisted = await persistDetailedOutlineBatchCandidateV1({ scope: fixture.scope, candidate })
  if (input.recordLedger !== false) {
    snapshot = await recordDetailedOutlineBatchCandidateV1({ scope: fixture.scope, snapshot, candidate })
  }
  return { candidate, snapshot, eventId: persisted.event.id! }
}

describe.sequential('R-HARNESS10 · 批量细纲 durable run', { timeout: 20_000 }, () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    clientMock.output = OUTPUT
  })

  afterEach(() => db.close())

  it('父任务按章节持久化候选，逐章作者确认后才经 adopt 写入并终态验证', async () => {
    const fixture = await createWorkspace()
    let snapshot = await createDetailedOutlineBatchDurableRunV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      outlineNodeIds: fixture.outlineNodeIds,
    })
    const candidates: DetailedOutlineBatchCandidateV1[] = []
    const postStates: unknown[] = []
    for (const outlineNodeId of fixture.outlineNodeIds) {
      const pending = await createCandidate({ fixture, snapshot, outlineNodeId })
      snapshot = pending.snapshot
      expect(snapshot.projection.state).toBe('awaiting_confirmation')
      const adopted = await commitDetailedOutlineBatchCandidateV1({
        scope: fixture.scope,
        runId: snapshot.run.id,
        candidate: pending.candidate,
        output: pending.candidate.output,
        currentSourceSummaryHash: async () => pending.candidate.sourceSummaryHash,
        adopt: async () => {
          const result = await adoptChapterOutlineWorkshopResult({
            raw: pending.candidate.output,
            projectId: fixture.scope.projectId,
            scope: fixture.scope,
            outlineNodeId,
            chapterSummary: outlineNodeId === fixture.outlineNodeIds[0] ? '守灯人抵达潮门。' : '守灯人听见钟声。',
            validCharacterIds: new Set(),
            validForeshadowIds: new Set(),
          })
          if (!result.ok) throw new Error(result.reason)
        },
        postState: async () => db.detailedOutlines.where('outlineNodeId').equals(outlineNodeId).first(),
      })
      snapshot = adopted
      candidates.push(pending.candidate)
      postStates.push(await db.detailedOutlines.where('outlineNodeId').equals(outlineNodeId).first())
    }
    const verified = await verifyDetailedOutlineBatchRunV1({
      scope: fixture.scope,
      runId: snapshot.run.id,
      candidates,
      postStates,
    })
    expect(verified.snapshot.projection.state).toBe('completed')
    expect(verified.receiptHash).toMatch(/^[a-f0-9]{64}$/)
    expect(await db.detailedOutlines.count()).toBe(2)
  })

  it('候选事件已落库但父任务未推进时，刷新会补齐 candidate.persisted，不重复调用模型', async () => {
    const fixture = await createWorkspace()
    const snapshot = await createDetailedOutlineBatchDurableRunV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      outlineNodeIds: fixture.outlineNodeIds,
    })
    const pending = await createCandidate({
      fixture,
      snapshot,
      outlineNodeId: fixture.outlineNodeIds[0],
      recordLedger: false,
    })
    const restored = await readLatestDetailedOutlineBatchCandidatesV1({
      scope: fixture.scope,
      runId: snapshot.run.id,
    })
    expect(restored).toHaveLength(1)
    expect(restored[0]?.durable.candidateHash).toBe(pending.candidate.durable.candidateHash)
    expect((await db.agentRunEvents.where('runId').equals(snapshot.run.id).toArray())
      .filter(event => event.type === 'candidate.persisted')).toHaveLength(1)
  })

  it('真实批量 runner 在作者确认前不写正式细纲，确认后才完成父任务', async () => {
    const fixture = await createWorkspace()
    const chapter = (await db.outlineNodes.get(fixture.outlineNodeIds[0]))!
    const assembled = await assembleContext({
      projectId: fixture.scope.projectId,
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      outlineNodeId: chapter.id,
      sourceKeys: [
        'canonAssertions', 'chapterOutline', 'adjacentChapterOutlines', 'worldview', 'storyCore',
        'activeNarrativeBlueprint', 'characterDrivenPlan', 'powerSystem',
        'cultivationProgress', 'codex', 'characters', 'creativeRules',
        'worldRules', 'historical', 'locations', 'foreshadows',
      ],
    })
    expect(assembled.included).toContain('adjacentChapterOutlines')
    let release: ((decision: 'adopt' | 'reject') => void) | null = null
    let candidateReady: (() => void) | null = null
    const ready = new Promise<void>(resolve => { candidateReady = resolve })
    const run = batchGenerateDetails({
      chapters: [chapter],
      existingDetails: [],
      scope: fixture.scope,
      contextResolver: async () => ({
        worldGroupId: fixture.worldGroupId,
        worldContext: assembled.text,
        assembled,
      }),
      onCandidate: async () => {
        candidateReady?.()
        return new Promise<'adopt' | 'reject'>(resolve => { release = resolve })
      },
      onSave: async (outlineNodeId, data) => {
        const result = await adopt({
          projectId: fixture.scope.projectId,
          scope: fixture.scope,
          target: 'detailedOutlines',
          mode: 'add',
          data: { outlineNodeId, ...data },
        })
        if (!result.written.length) throw new Error('test adoption failed')
      },
      onPostState: outlineNodeId => db.detailedOutlines.where('outlineNodeId').equals(outlineNodeId).first(),
    })
    await ready
    expect(await db.detailedOutlines.count()).toBe(0)
    expect(release).not.toBeNull()
    ;(release as (decision: 'adopt' | 'reject') => void)('adopt')
    const result = await run
    expect(result.generated).toBe(1)
    expect(await db.detailedOutlines.count()).toBe(1)
    expect((await db.agentRuns.get(result.runIds[0]))?.status).toBe('completed')
  })
})
