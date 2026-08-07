import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  clearRecentGenerationShadowTracesV1,
  listRecentGenerationShadowTracesV1,
  readAgentRunV1,
} from '../../src/lib/agent/run'
import {
  prepareGenerationNode,
  runGenerationNode,
  type GenerationNode,
} from '../../src/lib/generation/generation-node'
import {
  beginOutlineGenerationAdoptionV1,
  commitOutlineGenerationAdoptionV1,
  createOutlineGenerationTraceV1,
  isOutlineDurableHarnessEnabledV1,
  OUTLINE_DURABLE_HARNESS_STORAGE_KEY,
  OUTLINE_GENERATION_ADOPTION_INTENT_PAYLOAD_TYPE,
  OUTLINE_GENERATION_CANDIDATE_PAYLOAD_TYPE,
  OUTLINE_GENERATION_CONVERSATION_PURPOSE,
  OUTLINE_GENERATION_SOURCE_KEYS,
  recoverPendingOutlineGenerationAdoptionsV1,
  restoreLatestOutlineGenerationCandidateV1,
  staleOutlineGenerationCandidateV1,
} from '../../src/lib/outline/harness'
import { adoptGeneratedOutlineItems } from '../../src/lib/outline/adopt-generation'
import { encodeGenerationOperation, type OutlineGenerationRequest } from '../../src/lib/outline/generation-request'
import type { AssembleContextResult } from '../../src/lib/registry/types'
import type { WorkspaceScope } from '../../src/lib/types'

async function createWorkspace(): Promise<{
  scope: WorkspaceScope
  worldGroupId: number
  outlineNodeId: number
}> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: '大纲 durable adapter',
    genre: 'fantasy',
    genres: ['fantasy'],
    description: '',
    status: 'drafting',
    targetWordCount: 100_000,
    worldCode: 'outline-durable-world',
    worldVersion: 1,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({
    projectId,
    code: 'outline-durable-world',
    name: '潮汐世界',
    description: '',
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId,
    worldId,
    title: '潮城纪事',
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
  const worldGroupId = await db.worldGroups.add({
    projectId,
    name: '主世界',
    order: 0,
    createdAt: now,
    updatedAt: now,
  }) as number
  const outlineNodeId = await db.outlineNodes.add({
    projectId,
    worldId: null,
    workId,
    worldGroupId,
    parentId: null,
    type: 'volume',
    title: '第一卷',
    summary: '',
    order: 0,
    createdAt: now,
    updatedAt: now,
  }) as number
  return { scope: { projectId, worldId, workId }, worldGroupId, outlineNodeId }
}

function assembly(): AssembleContextResult {
  return {
    text: '【故事核心】潮汐城市必须在七日内迁徙。',
    segments: [{
      label: '故事核心',
      layer: 'L1',
      content: '【故事核心】潮汐城市必须在七日内迁徙。',
      tokens: 16,
      trimmable: true,
    }],
    included: ['storyCore'],
    omitted: OUTLINE_GENERATION_SOURCE_KEYS.filter(key => key !== 'storyCore'),
    trimmed: [],
    totalInputTokens: 16,
    inputBudget: 8_000,
    overBudgetBeforeTrim: false,
    overBudgetAfterTrim: false,
  }
}

function node(
  run: () => Promise<string>,
  id = 'outline.chapter:batch:1',
): GenerationNode<AssembleContextResult, string> {
  return {
    id,
    kind: 'outline.chapter',
    editableInput: true,
    assembleInput: assembled => [{ role: 'user', content: assembled.text }],
    run,
  }
}

async function persistOutlineCandidate(
  fixture: Awaited<ReturnType<typeof createWorkspace>>,
  request: OutlineGenerationRequest,
  output: string,
) {
  const assembled = assembly()
  const run = vi.fn(async () => output)
  const generationNode = node(run, encodeGenerationOperation(request))
  const trace = await createOutlineGenerationTraceV1({
    projectId: fixture.scope.projectId,
    worldGroupId: fixture.worldGroupId,
    request,
    assembled,
    durable: true,
  })
  const generated = await runGenerationNode(
    generationNode,
    prepareGenerationNode(generationNode, assembled),
    { shadowTrace: trace },
  )
  const candidate = await trace.persistCandidate(generated.output)
  if (!candidate) throw new Error('测试前置条件失败：未持久化大纲候选')
  return { candidate, run }
}

const RECOVERY_BATCH_STARTS = [0, 5, 10, 15] as const

function recoveryBatch(start: number): number[] {
  return Array.from({ length: 5 }, (_, index) => start + index)
}

describe.sequential('R-HARNESS1-outline-durable-adapter · 大纲双写接入', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    clearRecentGenerationShadowTracesV1()
    localStorage.removeItem(OUTLINE_DURABLE_HARNESS_STORAGE_KEY)
  })

  afterEach(() => {
    localStorage.removeItem(OUTLINE_DURABLE_HARNESS_STORAGE_KEY)
    db.close()
  })

  it('真实 GenerationNode 只调用一次模型，将正文写入既有候选表并让 durable run 等待确认', async () => {
    const fixture = await createWorkspace()
    const assembled = assembly()
    const run = vi.fn(async () => '第一章：潮门关闭前的最后一班船')
    const generationNode = node(run)
    const trace = await createOutlineGenerationTraceV1({
      projectId: fixture.scope.projectId,
      worldGroupId: fixture.worldGroupId,
      request: { kind: 'chapters', volumeId: fixture.outlineNodeId },
      assembled,
      durable: true,
    })

    const result = await runGenerationNode(
      generationNode,
      prepareGenerationNode(generationNode, assembled),
      { shadowTrace: trace },
    )
    const candidate = await trace.persistCandidate(result.output)

    expect(result.output).toBe('第一章：潮门关闭前的最后一班船')
    expect(run).toHaveBeenCalledOnce()
    expect(trace.mode, trace.initializationError).toBe('durable-shadow')
    expect(candidate).toMatchObject({
      type: OUTLINE_GENERATION_CANDIDATE_PAYLOAD_TYPE,
      operation: `outline.chapter:batch:${fixture.outlineNodeId}`,
      output: '第一章：潮门关闭前的最后一班船',
    })
    expect(listRecentGenerationShadowTracesV1()).toHaveLength(1)
    const durableRunId = trace.durable!.runId
    const snapshot = await readAgentRunV1(fixture.scope, durableRunId)
    expect(snapshot.projection.steps[`outline.chapter:batch:${fixture.outlineNodeId}`]).toMatchObject({
      status: 'awaiting_confirmation',
      attempt: 1,
    })
    expect(snapshot.projection.state).toBe('awaiting_confirmation')
    expect(snapshot.events.map(event => event.type)).toEqual([
      'run.created',
      'contract.accepted',
      'step.scheduled',
      'step.started',
      'context.assembled',
      'model.requested',
      'model.responded',
      'candidate.persisted',
    ])
    const ledgerText = JSON.stringify({ run: snapshot.run, events: snapshot.events })
    expect(ledgerText).not.toContain('潮汐城市必须在七日内迁徙')
    expect(ledgerText).not.toContain('潮门关闭前的最后一班船')
    const conversation = await db.agentConversations.get(snapshot.run.conversationId!)
    expect(conversation?.purpose).toBe(OUTLINE_GENERATION_CONVERSATION_PURPOSE)
    const persistedCandidate = await db.agentEvents.get(candidate!.candidateEventId)
    expect(persistedCandidate).toMatchObject({
      kind: 'candidate',
      content: '第一章：潮门关闭前的最后一班船',
    })
  })

  it.each(RECOVERY_BATCH_STARTS)('候选持久化后、确认前第 %i 轮起连续 5 次刷新均只恢复证据', async batchStart => {
    for (const iteration of recoveryBatch(batchStart)) {
      const fixture = await createWorkspace()
      const assembled = assembly()
      const output = `第一章：潮声中的密令-${iteration}`
      const run = vi.fn(async () => output)
      const generationNode = node(run)
      const trace = await createOutlineGenerationTraceV1({
        projectId: fixture.scope.projectId,
        worldGroupId: fixture.worldGroupId,
        request: { kind: 'chapters', volumeId: fixture.outlineNodeId },
        assembled,
        durable: true,
      })
      const result = await runGenerationNode(
        generationNode,
        prepareGenerationNode(generationNode, assembled),
        { shadowTrace: trace },
      )
      await trace.persistCandidate(result.output)

      const restored = await restoreLatestOutlineGenerationCandidateV1(fixture.scope.projectId)

      expect(restored, `第 ${iteration + 1} 次候选恢复`).toMatchObject({
        runId: trace.durable!.runId,
        output,
        operation: `outline.chapter:batch:${fixture.outlineNodeId}`,
      })
      expect(await restoreLatestOutlineGenerationCandidateV1(fixture.scope.projectId)).toMatchObject({
        runId: trace.durable!.runId,
        output,
      })
      expect(run).toHaveBeenCalledOnce()
    }
  })

  it('作者确认和采纳沿候选哈希推进，业务证据提交后步骤才成功', async () => {
    const fixture = await createWorkspace()
    const assembled = assembly()
    const generationNode = node(async () => '第一章：潮港封锁')
    const trace = await createOutlineGenerationTraceV1({
      projectId: fixture.scope.projectId,
      worldGroupId: fixture.worldGroupId,
      request: { kind: 'chapters', volumeId: fixture.outlineNodeId },
      assembled,
      durable: true,
    })
    const result = await runGenerationNode(
      generationNode,
      prepareGenerationNode(generationNode, assembled),
      { shadowTrace: trace },
    )
    const candidate = (await trace.persistCandidate(result.output))!

    await beginOutlineGenerationAdoptionV1(candidate)
    let snapshot = await readAgentRunV1(fixture.scope, candidate.runId)
    expect(snapshot.projection.steps[candidate.stepId]).toMatchObject({
      status: 'running',
      confirmation: 'adopt',
      candidateHash: candidate.candidateHash,
    })

    await commitOutlineGenerationAdoptionV1(candidate, {
      writtenCount: 1,
      targetIds: [fixture.outlineNodeId],
    })
    snapshot = await readAgentRunV1(fixture.scope, candidate.runId)
    expect(snapshot.projection.steps[candidate.stepId]).toMatchObject({
      status: 'succeeded',
      outputHash: candidate.candidateHash,
    })
    expect(snapshot.events.map(event => event.type).slice(-5)).toEqual([
      'candidate.persisted',
      'confirmation.recorded',
      'adoption.started',
      'adoption.committed',
      'step.succeeded',
    ])
    expect(await restoreLatestOutlineGenerationCandidateV1(fixture.scope.projectId)).toBeNull()
    const confirmations = await db.agentEvents
      .where('conversationId')
      .equals(candidate.conversationId)
      .filter(event => event.kind === 'confirmation')
      .toArray()
    expect(confirmations).toHaveLength(1)
  })

  it('候选正文被篡改时拒绝刷新恢复和采纳，重试标旧后也不再恢复', async () => {
    const fixture = await createWorkspace()
    const assembled = assembly()
    const generationNode = node(async () => '第一章：原始候选')
    const trace = await createOutlineGenerationTraceV1({
      projectId: fixture.scope.projectId,
      worldGroupId: fixture.worldGroupId,
      request: { kind: 'chapters', volumeId: fixture.outlineNodeId },
      assembled,
      durable: true,
    })
    const result = await runGenerationNode(
      generationNode,
      prepareGenerationNode(generationNode, assembled),
      { shadowTrace: trace },
    )
    const candidate = (await trace.persistCandidate(result.output))!
    await db.agentEvents.update(candidate.candidateEventId, { content: '第一章：被篡改的候选' })

    expect(await restoreLatestOutlineGenerationCandidateV1(fixture.scope.projectId)).toBeNull()
    await expect(beginOutlineGenerationAdoptionV1(candidate)).rejects.toThrow('正文或来源证据已损坏')

    await db.agentEvents.update(candidate.candidateEventId, { content: candidate.output })
    await staleOutlineGenerationCandidateV1(candidate)
    expect(await restoreLatestOutlineGenerationCandidateV1(fixture.scope.projectId)).toBeNull()
    const snapshot = await readAgentRunV1(fixture.scope, candidate.runId)
    expect(snapshot.projection.steps[candidate.stepId].status).toBe('stale')
  })

  it.each(RECOVERY_BATCH_STARTS)('确认后、业务写入前第 %i 轮起连续 5 次中断均按冻结计划恢复一次', async batchStart => {
    for (const iteration of recoveryBatch(batchStart)) {
      const fixture = await createWorkspace()
      const assembled = assembly()
      const run = vi.fn(async () => `确认后中断候选-${iteration}`)
      const generationNode = node(run)
      const trace = await createOutlineGenerationTraceV1({
        projectId: fixture.scope.projectId,
        worldGroupId: fixture.worldGroupId,
        request: { kind: 'chapters', volumeId: fixture.outlineNodeId },
        assembled,
        durable: true,
      })
      const generated = await runGenerationNode(
        generationNode,
        prepareGenerationNode(generationNode, assembled),
        { shadowTrace: trace },
      )
      const candidate = (await trace.persistCandidate(generated.output))!
      const items = [
        { title: `第${iteration * 2 + 1}章`, summary: `冲突建立-${iteration}` },
        { title: `第${iteration * 2 + 2}章`, summary: `冲突升级-${iteration}` },
      ]
      await beginOutlineGenerationAdoptionV1(candidate, {
        version: 1,
        kind: 'chapters',
        destinationVolumeId: fixture.outlineNodeId,
        items,
        startingOrder: 0,
        baseExistingTitles: [],
      })

      const recovered = await recoverPendingOutlineGenerationAdoptionsV1(fixture.scope.projectId)

      expect(recovered, `第 ${iteration + 1} 次确认后恢复`)
        .toEqual({ recoveredRunIds: [candidate.runId], failed: [] })
      const chapters = (await db.outlineNodes
        .where('projectId')
        .equals(fixture.scope.projectId)
        .toArray())
        .filter(row => row.type === 'chapter')
        .sort((left, right) => left.order - right.order)
        .map(row => ({ title: row.title, summary: row.summary, order: row.order }))
      expect(chapters).toEqual(items.map((item, order) => ({ ...item, order })))
      const snapshot = await readAgentRunV1(fixture.scope, candidate.runId)
      expect(snapshot.projection.steps[candidate.stepId]).toMatchObject({
        status: 'succeeded',
        confirmation: 'adopt',
      })
      expect(await recoverPendingOutlineGenerationAdoptionsV1(fixture.scope.projectId))
        .toEqual({ recoveredRunIds: [], failed: [] })
      const events = await db.agentEvents
        .where('conversationId')
        .equals(candidate.conversationId)
        .toArray()
      expect(events.filter(event => event.kind === 'candidate')).toHaveLength(1)
      expect(events.filter(event => event.kind === 'confirmation')).toHaveLength(1)
      expect(run).toHaveBeenCalledOnce()
    }
  })

  it.each(RECOVERY_BATCH_STARTS)('部分业务写入后第 %i 轮起连续 5 次中断均补齐缺项且不重复调用', async batchStart => {
    for (const iteration of recoveryBatch(batchStart)) {
      const fixture = await createWorkspace()
      const assembled = assembly()
      const run = vi.fn(async () => `部分写入候选-${iteration}`)
      const generationNode = node(run)
      const trace = await createOutlineGenerationTraceV1({
        projectId: fixture.scope.projectId,
        worldGroupId: fixture.worldGroupId,
        request: { kind: 'chapters', volumeId: fixture.outlineNodeId },
        assembled,
        durable: true,
      })
      const generated = await runGenerationNode(
        generationNode,
        prepareGenerationNode(generationNode, assembled),
        { shadowTrace: trace },
      )
      const candidate = (await trace.persistCandidate(generated.output))!
      const items = [
        { title: `第${iteration * 2 + 1}章`, summary: `冲突建立-${iteration}` },
        { title: `第${iteration * 2 + 2}章`, summary: `冲突升级-${iteration}` },
      ]
      await beginOutlineGenerationAdoptionV1(candidate, {
        version: 1,
        kind: 'chapters',
        destinationVolumeId: fixture.outlineNodeId,
        items,
        startingOrder: 0,
        baseExistingTitles: [],
      })

      // 模拟 adopt 循环写完第一项后页面崩溃，账本尚无 adoption.committed。
      await adoptGeneratedOutlineItems({
        projectId: fixture.scope.projectId,
        workspaceScope: fixture.scope,
        worldGroupId: fixture.worldGroupId,
        parentId: fixture.outlineNodeId,
        type: 'chapter',
        items: items.slice(0, 1),
        startingOrder: 0,
      })

      const recovered = await recoverPendingOutlineGenerationAdoptionsV1(fixture.scope.projectId)

      expect(recovered, `第 ${iteration + 1} 次部分写入恢复`)
        .toEqual({ recoveredRunIds: [candidate.runId], failed: [] })
      const chapters = (await db.outlineNodes
        .where('projectId')
        .equals(fixture.scope.projectId)
        .toArray())
        .filter(row => row.type === 'chapter')
        .sort((left, right) => left.order - right.order)
        .map(row => ({ title: row.title, summary: row.summary, order: row.order }))
      expect(chapters).toEqual(items.map((item, order) => ({ ...item, order })))
      const snapshot = await readAgentRunV1(fixture.scope, candidate.runId)
      expect(snapshot.projection.steps[candidate.stepId]).toMatchObject({
        status: 'succeeded',
        confirmation: 'adopt',
      })
      expect(await recoverPendingOutlineGenerationAdoptionsV1(fixture.scope.projectId))
        .toEqual({ recoveredRunIds: [], failed: [] })
      const events = await db.agentEvents
        .where('conversationId')
        .equals(candidate.conversationId)
        .toArray()
      expect(events.filter(event => event.kind === 'candidate')).toHaveLength(1)
      expect(events.filter(event => event.kind === 'confirmation')).toHaveLength(1)
      expect(run).toHaveBeenCalledOnce()
    }
  })

  it('冻结采纳计划被篡改时拒绝恢复，且不向业务表写入篡改内容', async () => {
    const fixture = await createWorkspace()
    const { candidate, run } = await persistOutlineCandidate(
      fixture,
      { kind: 'chapters', volumeId: fixture.outlineNodeId },
      '计划篡改候选',
    )
    await expect(beginOutlineGenerationAdoptionV1(candidate, {
      version: 1,
      kind: 'single-volume',
      targetId: fixture.outlineNodeId,
      summary: '越权改写卷纲',
    })).rejects.toThrow('采纳计划与候选生成目标不匹配')
    expect((await db.agentEvents
      .where('conversationId')
      .equals(candidate.conversationId)
      .toArray())
      .filter(event => event.kind === 'plan')).toEqual([])
    await beginOutlineGenerationAdoptionV1(candidate, {
      version: 1,
      kind: 'chapters',
      destinationVolumeId: fixture.outlineNodeId,
      items: [{ title: '第一章', summary: '作者确认的摘要' }],
      startingOrder: 0,
      baseExistingTitles: [],
    })
    const planEvent = (await db.agentEvents
      .where('conversationId')
      .equals(candidate.conversationId)
      .toArray())
      .find(event => event.kind === 'plan')
    const payload = JSON.parse(planEvent!.payload)
    expect(payload.type).toBe(OUTLINE_GENERATION_ADOPTION_INTENT_PAYLOAD_TYPE)
    payload.intent.items[0].summary = '被篡改的摘要'
    await db.agentEvents.update(planEvent!.id!, { payload: JSON.stringify(payload) })

    const recovered = await recoverPendingOutlineGenerationAdoptionsV1(fixture.scope.projectId)

    expect(recovered.recoveredRunIds).toEqual([])
    expect(recovered.failed).toEqual([{
      runId: candidate.runId,
      reason: '已确认运行缺少哈希匹配的采纳计划',
    }])
    expect((await db.outlineNodes
      .where('projectId')
      .equals(fixture.scope.projectId)
      .toArray())
      .filter(row => row.type === 'chapter')).toEqual([])
    expect(run).toHaveBeenCalledOnce()
  })

  it('单卷摘要在确认后中断时通过既有受治理采纳入口恢复', async () => {
    const fixture = await createWorkspace()
    const { candidate } = await persistOutlineCandidate(
      fixture,
      { kind: 'single-volume', volumeId: fixture.outlineNodeId },
      '单卷摘要候选',
    )
    await beginOutlineGenerationAdoptionV1(candidate, {
      version: 1,
      kind: 'single-volume',
      targetId: fixture.outlineNodeId,
      summary: '潮城在七日倒计时中被迫迁徙。',
    })

    expect(await recoverPendingOutlineGenerationAdoptionsV1(fixture.scope.projectId))
      .toEqual({ recoveredRunIds: [candidate.runId], failed: [] })
    expect(await db.outlineNodes.get(fixture.outlineNodeId)).toMatchObject({
      summary: '潮城在七日倒计时中被迫迁徙。',
    })
  })

  it('批量卷恢复遵循基线与候选内标题去重，并保留原采纳序位', async () => {
    const fixture = await createWorkspace()
    const { candidate } = await persistOutlineCandidate(fixture, { kind: 'volumes' }, '批量卷候选')
    const items = [
      { title: '第一卷', summary: '与基线重复，不应覆盖' },
      { title: '第二卷', summary: '潮城离岸' },
      { title: ' 第二卷 ', summary: '候选内重复，不应覆盖' },
      { title: '第三卷', summary: '新大陆登陆' },
    ]
    await beginOutlineGenerationAdoptionV1(candidate, {
      version: 1,
      kind: 'volumes',
      items,
      startingOrder: 1,
      baseExistingTitles: ['第一卷'],
    })

    expect(await recoverPendingOutlineGenerationAdoptionsV1(fixture.scope.projectId))
      .toEqual({ recoveredRunIds: [candidate.runId], failed: [] })
    const volumes = (await db.outlineNodes
      .where('projectId')
      .equals(fixture.scope.projectId)
      .toArray())
      .filter(row => row.type === 'volume')
      .sort((left, right) => left.order - right.order)
      .map(row => ({ title: row.title, summary: row.summary, order: row.order }))
    expect(volumes).toEqual([
      { title: '第一卷', summary: '', order: 0 },
      { title: '第二卷', summary: '潮城离岸', order: 2 },
      { title: '第三卷', summary: '新大陆登陆', order: 4 },
    ])
  })

  it('关闭 durable 开关时保持原 shadow 行为且不写运行表', async () => {
    const fixture = await createWorkspace()
    const assembled = assembly()
    const run = vi.fn(async () => '候选')
    const generationNode = node(run)
    const trace = await createOutlineGenerationTraceV1({
      projectId: fixture.scope.projectId,
      worldGroupId: fixture.worldGroupId,
      request: { kind: 'chapters', volumeId: fixture.outlineNodeId },
      assembled,
      durable: false,
    })

    await runGenerationNode(
      generationNode,
      prepareGenerationNode(generationNode, assembled),
      { shadowTrace: trace },
    )

    expect(trace.mode).toBe('shadow-only')
    expect(run).toHaveBeenCalledOnce()
    expect(await db.agentRuns.count()).toBe(0)
  })

  it('本机回滚开关默认启用，显式 disabled 后关闭 durable 接入', () => {
    expect(isOutlineDurableHarnessEnabledV1()).toBe(true)
    localStorage.setItem(OUTLINE_DURABLE_HARNESS_STORAGE_KEY, 'disabled')
    expect(isOutlineDurableHarnessEnabledV1()).toBe(false)
  })

  it('模型失败继续抛出原错误，并把失败步骤写入 durable ledger', async () => {
    const fixture = await createWorkspace()
    const assembled = assembly()
    const providerError = new Error('provider unavailable')
    const run = vi.fn(async () => { throw providerError })
    const generationNode = node(run)
    const trace = await createOutlineGenerationTraceV1({
      projectId: fixture.scope.projectId,
      worldGroupId: fixture.worldGroupId,
      request: { kind: 'chapters', volumeId: fixture.outlineNodeId },
      assembled,
      durable: true,
    })

    await expect(runGenerationNode(
      generationNode,
      prepareGenerationNode(generationNode, assembled),
      { shadowTrace: trace },
    )).rejects.toBe(providerError)

    expect(run).toHaveBeenCalledOnce()
    const snapshot = await readAgentRunV1(fixture.scope, trace.durable!.runId)
    expect(snapshot.projection.steps[`outline.chapter:batch:${fixture.outlineNodeId}`]).toMatchObject({
      status: 'failed',
      failureCode: 'generation_model_failed',
    })
  })

  it('durable 账本在执行前损坏时降级为 shadow，不能改变模型结果或调用数', async () => {
    const fixture = await createWorkspace()
    const assembled = assembly()
    const run = vi.fn(async () => '仍然返回原候选')
    const generationNode = node(run)
    const trace = await createOutlineGenerationTraceV1({
      projectId: fixture.scope.projectId,
      worldGroupId: fixture.worldGroupId,
      request: { kind: 'chapters', volumeId: fixture.outlineNodeId },
      assembled,
      durable: true,
    })
    await db.agentRuns.update(trace.durable!.runId, { projectionHash: 'f'.repeat(64) })

    const result = await runGenerationNode(
      generationNode,
      prepareGenerationNode(generationNode, assembled),
      { shadowTrace: trace },
    )

    expect(result.output).toBe('仍然返回原候选')
    expect(run).toHaveBeenCalledOnce()
    expect(trace.shadow.projection().steps[`outline.chapter:batch:${fixture.outlineNodeId}`].status).toBe('succeeded')
    expect(trace.traceErrors.some(error => error.includes('物化投影与事件重放结果不一致'))).toBe(true)
  })
})
