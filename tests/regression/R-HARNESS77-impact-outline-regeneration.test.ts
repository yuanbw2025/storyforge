import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope } from '../../src/lib/types'
import { buildEditImpactGraphV1 } from '../../src/lib/consistency/impact-analysis'
import { buildImpactHandoffV2 } from '../../src/lib/consistency/impact-handoff'
import { buildImpactRemediationPlanV1 } from '../../src/lib/consistency/impact-remediation-plan'
import { executeImpactAuthorReviewV1 } from '../../src/lib/agent/run/impact-review-durable'
import {
  beginImpactManualCorrectionV1,
  completeImpactManualCorrectionV1,
} from '../../src/lib/agent/run/impact-manual-correction-durable'
import { executeImpactPostCorrectionReplanV1 } from '../../src/lib/agent/run/impact-post-correction-replan-durable'
import {
  adoptImpactOutlineRegenerationCandidateV1,
  generateImpactOutlineRegenerationCandidateV1,
  readCompletedImpactOutlineRegenerationsV1,
  readPendingImpactOutlineRegenerationCandidateV1,
  rejectImpactOutlineRegenerationCandidateV1,
  type ImpactOutlineRegenerationAdoptionBoundaryV1,
} from '../../src/lib/agent/run/impact-outline-regeneration-durable'
import { staleAgentRunVerificationV1 } from '../../src/lib/agent/run/event-store'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'

const VALID_OUTPUT = JSON.stringify({
  summary: '钟楼根据半开启的潮门重新安排守夜人撤离，并留下下一章追查潮声来源的因果钩子。',
  reason: '上游事实从完全开启改为半开启，后续行动必须保留阻滞与调查空间。',
  evidenceRefs: ['章节正文', '当前章节大纲'],
})

async function seed(label = 'h77') {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: `生成式影响重建-${label}`, genre: 'fantasy', genres: ['fantasy'], status: 'drafting', description: '',
    targetWordCount: 100_000, worldCode: `${label}-${now}`, worldVersion: 1, createdAt: now, updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({
    projectId, code: `${label}-${now}`, name: '主世界', description: '', currentVersion: 1,
    createdAt: now, updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId, worldId, title: label, description: '', genres: ['fantasy'], status: 'drafting',
    targetWordCount: 100_000, createdAt: now, updatedAt: now,
  } as any) as number
  await db.projects.update(projectId, { activeWorldId: worldId, activeWorkId: workId, ownershipSchemaVersion: 1 })
  const worldGroupId = await db.worldGroups.add({
    projectId, worldId, name: '主世界', order: 0, createdAt: now, updatedAt: now,
  }) as number
  const volumeId = await db.outlineNodes.add({
    projectId, workId, worldGroupId, parentId: null, type: 'volume', title: '第一卷', summary: '',
    order: 0, createdAt: now, updatedAt: now,
  } as any) as number
  const sourceOutlineNodeId = await db.outlineNodes.add({
    projectId, workId, worldGroupId, parentId: volumeId, type: 'chapter', title: '第一章', summary: '潮门开启',
    order: 0, createdAt: now, updatedAt: now,
  } as any) as number
  const targetOutlineNodeId = await db.outlineNodes.add({
    projectId, workId, worldGroupId, parentId: volumeId, type: 'chapter', title: '第二章', summary: '钟楼照常回应',
    order: 1, createdAt: now, updatedAt: now,
  } as any) as number
  const sourceChapterId = await db.chapters.add({
    projectId, workId, outlineNodeId: sourceOutlineNodeId, title: '第一章', content: '<p>潮门只开启一半，钟声穿过旧港。</p>',
    wordCount: 17, status: 'revised', order: 0, notes: '', createdAt: now, updatedAt: now,
  } as any) as number
  await db.chapters.add({
    projectId, workId, outlineNodeId: targetOutlineNodeId, title: '第二章', content: '<p>钟楼仍按旧计划回应。</p>',
    wordCount: 12, status: 'draft', order: 1, notes: '', createdAt: now, updatedAt: now,
  } as any)
  const factId = await db.temporalFacts.add({
    projectId, workId, worldGroupId, subjectType: 'location', subjectId: null, subjectName: '潮门',
    predicate: 'state', value: '开启', validFromChapterId: sourceChapterId, validToChapterId: null,
    sourceChapterId, sourceQuote: '潮门', sourceTextHash: '', status: 'confirmed', locked: false,
    createdAt: now, updatedAt: now,
  } as any) as number
  await db.storyCores.add({
    projectId, workId, logline: '潮汐改变港城命运', concept: '', theme: '', centralConflict: '',
    plotPattern: '', storyLines: '', mainPlot: '', subPlots: '',
    createdAt: now, updatedAt: now,
  } as any)
  return {
    scope: { projectId, worldId, workId } satisfies WorkspaceScope,
    projectId, worldGroupId, volumeId, sourceOutlineNodeId, targetOutlineNodeId, sourceChapterId, factId,
  }
}

async function prepare(fixture: Awaited<ReturnType<typeof seed>>) {
  const graph = await buildEditImpactGraphV1(fixture.scope, fixture.sourceChapterId)
  const plan = await buildImpactRemediationPlanV1(graph)
  const factItem = plan.items.find(item => item.table === 'temporalFacts' && item.recordId === fixture.factId)!
  const review = await executeImpactAuthorReviewV1({
    scope: fixture.scope, worldGroupId: fixture.worldGroupId, plan, itemId: factItem.id,
    decision: 'needs-manual-action', note: '把潮门状态改为半开启后重新规划。',
  })
  const handoff = buildImpactHandoffV2({
    plan, itemId: factItem.id, decision: 'needs-manual-action', reviewRunId: review.snapshot.run.id,
    reviewReceiptHash: review.receiptHash, sourceOutlineNodeId: fixture.sourceOutlineNodeId,
  })
  await beginImpactManualCorrectionV1({ scope: fixture.scope, handoff })
  await db.temporalFacts.update(fixture.factId, { value: '半开启', updatedAt: Date.now() + 1 })
  await completeImpactManualCorrectionV1({ scope: fixture.scope, handoff })
  const replan = await executeImpactPostCorrectionReplanV1({ scope: fixture.scope, handoff })
  const item = replan.output.plan.items.find(candidate => (
    candidate.table === 'outlineNodes' && candidate.recordId === fixture.targetOutlineNodeId
  ))!
  expect(replan.output.remainingItemIds).toContain(item.id)
  return { replan, item }
}

describe.sequential('R-HARNESS77 · H57 生成式下游章纲摘要重建', { timeout: 30_000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('只经登记 Context 调一次模型，建立 H57 child 候选且确认前正式摘要零写入', async () => {
    const fixture = await seed()
    const { replan, item } = await prepare(fixture)
    let prompt = ''
    const result = await generateImpactOutlineRegenerationCandidateV1({
      scope: fixture.scope, expectedReplan: replan, itemId: item.id,
      runAI: async messages => { prompt = messages.map(message => message.content).join('\n'); return VALID_OUTPUT },
    })
    expect(prompt).toContain('潮门只开启一半')
    expect(prompt).toContain('钟楼照常回应')
    expect(prompt).toContain(item.id)
    expect(prompt).toContain('键严格为 summary、reason、evidenceRefs')
    expect(result.snapshot.run.parentRunId).toBe(replan.snapshot.run.id)
    expect(result.snapshot.run.parentReceiptHash).toBe(replan.receiptHash)
    expect(result.snapshot.run.parentArtifactHash).toBe(replan.output.outputHash)
    expect(result.snapshot.contract.permissions.contextSourceKeys)
      .toEqual(expect.arrayContaining(['chapterContent', 'chapterOutline', 'consistencyReport']))
    expect(result.snapshot.contract.permissions.writeTargets).toEqual([
      { table: 'outlineNodes', fields: ['summary'], mode: 'author-confirmed' },
    ])
    expect((await db.outlineNodes.get(fixture.targetOutlineNodeId))?.summary).toBe('钟楼照常回应')
    expect(result.snapshot.projection.state).toBe('awaiting_confirmation')
  })

  it('严格拒绝协议外字段与未进入模型的证据标签，且不产生正式写入', async () => {
    const fixture = await seed()
    const { replan, item } = await prepare(fixture)
    await expect(generateImpactOutlineRegenerationCandidateV1({
      scope: fixture.scope, expectedReplan: replan, itemId: item.id,
      runAI: async () => JSON.stringify({
        summary: '非法候选', reason: '测试', evidenceRefs: ['不存在的来源'], extra: true,
      }),
    })).rejects.toThrow(/协议外字段|Context/)
    expect((await db.outlineNodes.get(fixture.targetOutlineNodeId))?.summary).toBe('钟楼照常回应')
    expect((await db.agentRuns.where('projectId').equals(fixture.projectId).toArray())
      .filter(row => row.parentRelation?.startsWith('impact-outline-regen:'))[0]?.status).toBe('failed')
  })

  it('配置缺失时模型调用和新 Run 都为零', async () => {
    const fixture = await seed()
    const { replan, item } = await prepare(fixture)
    const before = await db.agentRuns.count()
    await expect(generateImpactOutlineRegenerationCandidateV1({
      scope: fixture.scope, expectedReplan: replan, itemId: item.id,
      aiConfig: { provider: 'openai', apiKey: '', model: '' } as any,
    })).rejects.toThrow()
    expect(await db.agentRuns.count()).toBe(before)
  })

  it('模型结果未知窗口不自动重试；作者再次生成会创建新的 child Run', async () => {
    const fixture = await seed()
    const { replan, item } = await prepare(fixture)
    let calls = 0
    await expect(generateImpactOutlineRegenerationCandidateV1({
      scope: fixture.scope, expectedReplan: replan, itemId: item.id,
      runAI: async () => { calls++; throw new Error('network outcome unknown') },
    })).rejects.toThrow('network outcome unknown')
    const retry = await generateImpactOutlineRegenerationCandidateV1({
      scope: fixture.scope, expectedReplan: replan, itemId: item.id,
      runAI: async () => { calls++; return VALID_OUTPUT },
    })
    expect(calls).toBe(2)
    const runs = (await db.agentRuns.where('projectId').equals(fixture.projectId).toArray())
      .filter(row => row.parentRelation?.startsWith('impact-outline-regen:'))
    expect(runs).toHaveLength(2)
    expect(retry.snapshot.run.id).not.toBe(runs.find(row => row.status === 'paused')?.id)
  })

  it('候选检查点后的崩溃窗口可补写 candidate 事件，不重复模型调用', async () => {
    const fixture = await seed()
    const { replan, item } = await prepare(fixture)
    let calls = 0
    await expect(generateImpactOutlineRegenerationCandidateV1({
      scope: fixture.scope, expectedReplan: replan, itemId: item.id,
      runAI: async () => { calls++; return VALID_OUTPUT },
      onDurableBoundary: boundary => { if (boundary === 'candidate.checkpoint') throw new Error('interrupt:candidate') },
    })).rejects.toThrow('interrupt:candidate')
    const recovered = await readPendingImpactOutlineRegenerationCandidateV1({
      scope: fixture.scope, sourceChapterId: fixture.sourceChapterId,
    })
    expect(calls).toBe(1)
    expect(recovered?.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(recovered?.candidate.result.summary).toContain('钟楼')
  })

  it('目标摘要、来源正文、登记上游或 H57 receipt 任一变化都阻断采纳', async () => {
    const targetChanged = await seed('target-stale')
    const targetPrepared = await prepare(targetChanged)
    const targetCandidate = await generateImpactOutlineRegenerationCandidateV1({
      scope: targetChanged.scope, expectedReplan: targetPrepared.replan, itemId: targetPrepared.item.id,
      runAI: async () => VALID_OUTPUT,
    })
    await db.outlineNodes.update(targetChanged.targetOutlineNodeId, { summary: '作者另行修改' })
    await expect(adoptImpactOutlineRegenerationCandidateV1({
      scope: targetChanged.scope, runId: targetCandidate.snapshot.run.id,
    })).rejects.toThrow(/目标|Context/)

    const contextChanged = await seed('context-stale')
    const contextPrepared = await prepare(contextChanged)
    const contextCandidate = await generateImpactOutlineRegenerationCandidateV1({
      scope: contextChanged.scope, expectedReplan: contextPrepared.replan, itemId: contextPrepared.item.id,
      runAI: async () => VALID_OUTPUT,
    })
    const core = await db.storyCores.where('projectId').equals(contextChanged.projectId).first()
    await db.storyCores.update(core!.id!, { logline: '作者修改了上游故事核心' })
    await expect(adoptImpactOutlineRegenerationCandidateV1({
      scope: contextChanged.scope, runId: contextCandidate.snapshot.run.id,
    })).rejects.toThrow(/Context|来源/)

    const parentStale = await seed('parent-stale')
    const parentPrepared = await prepare(parentStale)
    const parentCandidate = await generateImpactOutlineRegenerationCandidateV1({
      scope: parentStale.scope, expectedReplan: parentPrepared.replan, itemId: parentPrepared.item.id,
      runAI: async () => VALID_OUTPUT,
    })
    await staleAgentRunVerificationV1({
      scope: parentStale.scope, runId: parentPrepared.replan.snapshot.run.id, reason: '测试父回执过期',
    })
    await expect(adoptImpactOutlineRegenerationCandidateV1({
      scope: parentStale.scope, runId: parentCandidate.snapshot.run.id,
    })).rejects.toThrow(/H57|plan|来源/)
  })

  it('采纳意图检查点之后、正式写入之前的 Context 漂移仍会停止原 Run', async () => {
    const fixture = await seed('intent-context-stale')
    const { replan, item } = await prepare(fixture)
    const generated = await generateImpactOutlineRegenerationCandidateV1({
      scope: fixture.scope, expectedReplan: replan, itemId: item.id, runAI: async () => VALID_OUTPUT,
    })
    await expect(adoptImpactOutlineRegenerationCandidateV1({
      scope: fixture.scope,
      runId: generated.snapshot.run.id,
      onDurableBoundary: boundary => {
        if (boundary === 'intent.checkpoint') throw new Error('interrupt:intent')
      },
    })).rejects.toThrow('interrupt:intent')
    const core = await db.storyCores.where('projectId').equals(fixture.projectId).first()
    await db.storyCores.update(core!.id!, { logline: '作者在确认与正式写入之间修改了上游故事核心' })
    await expect(adoptImpactOutlineRegenerationCandidateV1({
      scope: fixture.scope,
      runId: generated.snapshot.run.id,
    })).rejects.toThrow(/确认后来源 Context|正式写入已停止/)
    expect((await db.outlineNodes.get(fixture.targetOutlineNodeId))?.summary).toBe('钟楼照常回应')
  })

  it('八个采纳边界均沿同一 Run 收敛，正式摘要只由冻结意图写入', async () => {
    const fixture = await seed()
    const { replan, item } = await prepare(fixture)
    const generated = await generateImpactOutlineRegenerationCandidateV1({
      scope: fixture.scope, expectedReplan: replan, itemId: item.id, runAI: async () => VALID_OUTPUT,
    })
    const boundaries: ImpactOutlineRegenerationAdoptionBoundaryV1[] = [
      'intent.checkpoint', 'confirmation.recorded', 'adoption.started', 'formal.written',
      'adoption.committed', 'step.succeeded', 'verification.started', 'verification.accepted',
    ]
    for (const boundary of boundaries) {
      await expect(adoptImpactOutlineRegenerationCandidateV1({
        scope: fixture.scope, runId: generated.snapshot.run.id,
        onDurableBoundary: reached => { if (reached === boundary) throw new Error(`interrupt:${boundary}`) },
      })).rejects.toThrow(`interrupt:${boundary}`)
    }
    const completed = await adoptImpactOutlineRegenerationCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id,
    })
    expect(completed.snapshot.projection.state).toBe('completed')
    expect((await db.outlineNodes.get(fixture.targetOutlineNodeId))?.summary)
      .toBe(JSON.parse(VALID_OUTPUT).summary)
    expect((await db.chapters.get(fixture.sourceChapterId))?.content).toContain('潮门只开启一半')
    expect(completed.receiptHash).toHaveLength(64)
  })

  it('拒绝候选零写入，之后可显式生成新的候选', async () => {
    const fixture = await seed()
    const { replan, item } = await prepare(fixture)
    const first = await generateImpactOutlineRegenerationCandidateV1({
      scope: fixture.scope, expectedReplan: replan, itemId: item.id, runAI: async () => VALID_OUTPUT,
    })
    await rejectImpactOutlineRegenerationCandidateV1({ scope: fixture.scope, runId: first.snapshot.run.id })
    expect((await db.outlineNodes.get(fixture.targetOutlineNodeId))?.summary).toBe('钟楼照常回应')
    const second = await generateImpactOutlineRegenerationCandidateV1({
      scope: fixture.scope, expectedReplan: replan, itemId: item.id, runAI: async () => VALID_OUTPUT,
    })
    expect(second.snapshot.run.id).not.toBe(first.snapshot.run.id)
  })

  it('完成证明可恢复；终验后目标再变会撤销旧 receipt', async () => {
    const fixture = await seed()
    const { replan, item } = await prepare(fixture)
    const generated = await generateImpactOutlineRegenerationCandidateV1({
      scope: fixture.scope, expectedReplan: replan, itemId: item.id, runAI: async () => VALID_OUTPUT,
    })
    await adoptImpactOutlineRegenerationCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id })
    expect(await readCompletedImpactOutlineRegenerationsV1({
      scope: fixture.scope, sourceChapterId: fixture.sourceChapterId,
    })).toHaveLength(1)
    await db.outlineNodes.update(fixture.targetOutlineNodeId, { summary: '作者终验后再次修改' })
    expect(await readCompletedImpactOutlineRegenerationsV1({
      scope: fixture.scope, sourceChapterId: fixture.sourceChapterId,
    })).toHaveLength(0)
    expect((await db.agentRuns.get(generated.snapshot.run.id))?.terminalReceiptHash).toBeNull()
  })

  it('来源章纲不是后续目标，已 resolved 或非 outline 项都不能创建生成式重建', async () => {
    const fixture = await seed()
    const { replan } = await prepare(fixture)
    const sourceItem = replan.output.plan.items.find(item => item.recordId === fixture.sourceOutlineNodeId)!
    await expect(generateImpactOutlineRegenerationCandidateV1({
      scope: fixture.scope, expectedReplan: replan, itemId: sourceItem.id, runAI: async () => VALID_OUTPUT,
    })).rejects.toThrow(/后续章纲/)
    const factItem = replan.output.plan.items.find(item => item.table === 'temporalFacts')!
    await expect(generateImpactOutlineRegenerationCandidateV1({
      scope: fixture.scope, expectedReplan: replan, itemId: factItem.id, runAI: async () => VALID_OUTPUT,
    })).rejects.toThrow(/不存在可生成式重建/)
  })

  it('跨 Work 不能恢复候选，导入后物理 lineage/candidate 明确不可便携', async () => {
    const fixture = await seed()
    const { replan, item } = await prepare(fixture)
    const generated = await generateImpactOutlineRegenerationCandidateV1({
      scope: fixture.scope, expectedReplan: replan, itemId: item.id, runAI: async () => VALID_OUTPUT,
    })
    const other = await seed('other-work')
    await expect(readPendingImpactOutlineRegenerationCandidateV1({
      scope: other.scope, sourceChapterId: fixture.sourceChapterId,
    })).rejects.toThrow(/不存在|越界/)

    await adoptImpactOutlineRegenerationCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id })
    const importedId = await importProjectJSON(await exportProjectJSON(fixture.projectId))
    const imported = (await db.agentRuns.where('projectId').equals(importedId).toArray())
      .find(row => row.parentRelation?.startsWith('impact-outline-regen:'))!
    expect(imported.status).toBe('running')
    expect(imported.terminalReceiptHash).toBeNull()
  })
})
