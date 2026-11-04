import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useOutlineStore } from '../../src/stores/outline'
import { captureWorkspaceContentRevisionV1 } from '../../src/lib/authoring/content-revision'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { fingerprintSettingSource } from '../../src/lib/fact-ledger/setting-assertions'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { hashConsistencyAgentCandidateV1, isConsistencyAgentCandidateV1, readLatestConsistencyAgentRun } from '../../src/lib/agent/consistency-agent'
import { createAgentRunCheckpointV1, readLatestVerifiedAgentRunCheckpointV1 } from '../../src/lib/agent/run/checkpoint'
import { refreshDurableConsistencyAuditFreshnessV1, runDurableConsistencyAuditV1 } from '../../src/lib/agent/run/consistency-audit-durable'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { generateWorkspaceUid } from '../../src/lib/memory/identity'
import { resolveScopeLike, stampNewRecord } from '../../src/lib/workspace/scope'
import type { Project, TemporalFact, WorkspaceScope } from '../../src/lib/types'
import { putCurrentWorkspaceFixtureV1, seedCurrentWorkspace } from '../helpers/current-workspace'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'

const now = 1_700_000_000_000
const targetText = '林舟再次获得潮汐钥匙。'
const targetHtml = `<p>${targetText}</p>`

async function seedConsistencyProject() {
  const project: Project = {
    id: 92_001,
    name: '记忆收口一致性审计',
    enableMultiWorld: false,
    workspaceUid: generateWorkspaceUid(),
    workspacePurpose: 'independent-work',
    activeWorldId: 92_001,
    activeWorkId: 92_001,
    createdAt: now,
    updatedAt: now,
  }
  await putCurrentWorkspaceFixtureV1(project)
  await db.creativeRules.add({
    projectId: project.id!,
    writingStyle: '',
    narrativePOV: 'third-limited',
    atmosphere: '',
    prohibitions: '[]',
    consistencyRules: JSON.stringify(['潮汐钥匙只能获得一次']),
    specialRequirements: '',
    citedReferenceIds: '[]',
    createdAt: now,
    updatedAt: now,
  })
  const volumeId = await db.outlineNodes.add({
    projectId: project.id!,
    parentId: null,
    type: 'volume',
    title: '第一卷',
    summary: '',
    order: 0,
    createdAt: now,
    updatedAt: now,
  })
  const firstOutlineId = await db.outlineNodes.add({
    projectId: project.id!,
    parentId: volumeId,
    type: 'chapter',
    title: '第一章 得钥',
    summary: '',
    order: 0,
    createdAt: now,
    updatedAt: now,
  })
  const targetOutlineId = await db.outlineNodes.add({
    projectId: project.id!,
    parentId: volumeId,
    type: 'chapter',
    title: '第二章 重逢',
    summary: '',
    order: 1,
    createdAt: now,
    updatedAt: now,
  })
  const firstChapterId = await db.chapters.add({
    projectId: project.id!,
    outlineNodeId: firstOutlineId,
    title: '第一章 得钥',
    content: '<p>林舟拾起潮汐钥匙。</p>',
    wordCount: 10,
    status: 'draft',
    order: 0,
    notes: '',
    createdAt: now,
    updatedAt: now,
  })
  const targetChapterId = await db.chapters.add({
    projectId: project.id!,
    outlineNodeId: targetOutlineId,
    title: '第二章 重逢',
    content: targetHtml,
    wordCount: targetText.length,
    status: 'draft',
    order: 1,
    notes: '',
    createdAt: now,
    updatedAt: now,
  })
  const observationId = await db.itemLedger.add({
    projectId: project.id!,
    itemName: '潮汐钥匙',
    heldByName: '林舟',
    action: 'gain',
    quantity: 1,
    chapterId: firstChapterId,
    chapterTitle: '第一章 得钥',
    note: '',
    createdAt: now,
  })
  await finalizeCurrentFixtureV1(project.id!)
  const scope = await resolveScopeLike(project.id!)
  return { project, scope, targetChapterId, targetOutlineId, observationId }
}

function runInput(
  fixture: Awaited<ReturnType<typeof seedConsistencyProject>>,
  call: Parameters<typeof runDurableConsistencyAuditV1>[0]['call'],
  overrides: Partial<Parameters<typeof runDurableConsistencyAuditV1>[0]> = {},
) {
  return {
    scope: fixture.scope,
    chapterId: fixture.targetChapterId,
    chapterTitle: '第二章 重逢',
    worldGroupId: null,
    outlineNodeId: fixture.targetOutlineId,
    chapterContent: targetHtml,
    mode: 'deep' as const,
    provider: 'openai' as const,
    model: 'test-consistency-model',
    budget: new AgentTeamBudgetTracker('economy'),
    call,
    ...overrides,
  }
}

function modelReport(...evidence: Array<{ sourceType: string; sourceId: number; quote?: string; anchorId?: string }>) {
  return JSON.stringify({ findings: [{ category: '持有物', severity: 'hard', anchorId: 'p1',
    evidence, reason: '作者需要核对已获得的物品。' }] })
}

async function addConfirmedCanon(scope: WorkspaceScope, subjectName: string, value: string) {
  const sourceWorldviewId = await db.worldviews.add(stampNewRecord(scope, 'worldviews', {
    projectId: scope.projectId, worldOrigin: value, createdAt: now, updatedAt: now,
  }, { owner: 'world' }))
  return db.temporalFacts.add(stampNewRecord<TemporalFact>(scope, 'temporalFacts', {
    projectId: scope.projectId, worldGroupId: null, subjectName, predicate: 'magicSource', value,
    factKind: 'state', sourceType: 'setting', sourceWorldviewId, sourceRecordTable: 'worldviews',
    sourceField: 'worldOrigin', sourceFingerprint: fingerprintSettingSource(value),
    status: 'confirmed', locked: false, createdAt: now, updatedAt: now,
  }, { owner: 'work' }))
}

describe('077 · 一致性引文必须属于声明的原来源', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('rejects a nonexistent Canon ID borrowing the delivered creative rules quote', async () => {
    const fixture = await seedConsistencyProject()
    const raw = modelReport({ sourceType: 'canon', sourceId: 999999999, quote: '潮汐钥匙只能获得一次' })
    let calls = 0
    await expect(runDurableConsistencyAuditV1(runInput(fixture, async messages => {
      calls++
      expect(messages[messages.length - 1]?.content).toContain('潮汐钥匙只能获得一次')
      return raw
    }))).rejects.toThrow('引文、证据无效')
    expect(calls).toBe(1)
    const run = await db.agentRuns.orderBy('id').last()
    const snapshot = await readAgentRunV1(fixture.scope, run!.id!)
    expect(snapshot.projection.state).toBe('failed')
    expect(snapshot.projection.terminalReceiptHash).toBeUndefined()
    expect(await readLatestConsistencyAgentRun({ projectId: fixture.project.id!, chapterId: fixture.targetChapterId })).toBeNull()
    const response = (await db.agentRunArtifacts.toArray()).find(row => row.artifactKind === 'raw-response')
    expect(JSON.parse(response!.content!).raw).toBe(raw)
  })

  it('accepts a real chapter#0 anchor and persists the successful public audit', async () => {
    const fixture = await seedConsistencyProject()
    const result = await runDurableConsistencyAuditV1(runInput(fixture,
      async () => modelReport({ sourceType: 'chapter', sourceId: 0, anchorId: 'p1' })))
    expect(result.candidate.findings.find(finding => finding.category === '持有物')).toMatchObject({ severity: 'hard', evidence: [
      { sourceType: 'chapter', sourceId: 0, anchorId: 'p1', quote: targetText },
    ] })
    expect(result.snapshot.projection.state).toBe('completed')
    expect(result.snapshot.projection.terminalReceiptHash).toMatch(/^[a-f0-9]{64}$/)
  })


  it.each([true, false])('移动继承组别的章纲后，一致性报告过期并保留原已付证据（multi=%s）', async enableMultiWorld => {
    const f = await seedConsistencyProject()
    const { scope } = f
    const groupId = await db.worldGroups.add(stampNewRecord(scope, 'worldGroups', {
      projectId: scope.projectId, name: '主世界', description: '', type: 'primary' as const, order: 0, createdAt: now, updatedAt: now,
    }, { owner: 'world' })) as number
    await db.projects.update(scope.projectId, { enableMultiWorld })
    const target = (await db.outlineNodes.get(f.targetOutlineId))!
    const volumeId = target.parentId!
    await db.outlineNodes.update(volumeId, { worldGroupId: groupId })
    const blocks = []
    for (const title of ['原故事块', '目标故事块']) {
      blocks.push(await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
        projectId: scope.projectId, parentId: volumeId, type: 'storyBlock' as const, title, summary: '',
        order: blocks.length, createdAt: now, updatedAt: now,
      }, { owner: 'work' })) as number)
    }
    await db.outlineNodes.update(f.targetOutlineId, { parentId: blocks[0], order: 0 })
    const body = await db.chapters.get(f.targetChapterId)
    const before = await db.outlineNodes.toArray()
    expect(before.find(row => row.id === f.targetOutlineId)?.worldGroupId).toBeUndefined()
    const worldGroupId = enableMultiWorld ? groupId : null
    const source = { scope, worldGroupId }
    const prior = await captureWorkspaceContentRevisionV1(source)
    let calls = 0
    const raw = modelReport({ sourceType: 'chapter', sourceId: 0, anchorId: 'p1' })
    const audit = await runDurableConsistencyAuditV1(runInput(f, async messages => {
      calls++
      expect(messages.map(message => message.content).join('\n')).toContain('第二章 重逢')
      return raw
    }, { worldGroupId }))
    expect(audit.snapshot.projection.state).toBe('completed')
    expect(audit.candidate.context.contentRevisionHash).toBe(prior.vectorHash)
    const originalArtifacts = await db.agentRunArtifacts.toArray()
    const originalCheckpoints = await db.agentRunCheckpoints.toArray()
    expect(JSON.parse(originalArtifacts.find(row => row.artifactKind === 'raw-response')!.content!).raw).toBe(raw)

    const outline = useOutlineStore.getState()
    await outline.loadAll(scope)
    await outline.moveNodeToParent(f.targetOutlineId, blocks[1], 0, scope)
    const after = await db.outlineNodes.toArray()
    expect(after.filter((row, index) => JSON.stringify(row) !== JSON.stringify(before[index])).map(row => row.id))
      .toEqual([f.targetOutlineId])
    expect(after.find(row => row.id === f.targetOutlineId)).toMatchObject({ parentId: blocks[1], order: 0 })
    expect(await db.chapters.get(f.targetChapterId)).toEqual(body)
    const freshness = await refreshDurableConsistencyAuditFreshnessV1({ scope, candidate: audit.candidate })
    expect(freshness.current).toBe(false)
    expect(freshness.snapshot?.events[freshness.snapshot.events.length - 1]?.type).toBe('verification.staled')
    const current = await captureWorkspaceContentRevisionV1(source)
    expect(current.entries.filter((entry, index) => entry.contentHash !== prior.entries[index].contentHash).map(entry => entry.table))
      .toEqual(['outlineNodes'])
    expect(current.entries.find(entry => entry.table === 'outlineNodes')?.rowCount)
      .toBe(prior.entries.find(entry => entry.table === 'outlineNodes')?.rowCount)
    expect(calls).toBe(1)
    expect(await db.agentRunArtifacts.toArray()).toEqual(originalArtifacts)
    expect(await db.agentRunCheckpoints.toArray()).toEqual(originalCheckpoints)
  })

  it('freezes real Canon and observation identities, exact request ranges and versions across reload', async () => {
    const f = await seedConsistencyProject()
    const shared = '封印只能打开一次'
    const left = await addConfirmedCanon(f.scope, '北门', shared)
    const right = await addConfirmedCanon(f.scope, '南门', shared)
    const result = await runDurableConsistencyAuditV1(runInput(f, async messages => {
      expect(messages[1].content).toContain(`[canon#${left}]`)
      expect(messages[1].content).toContain(`[canon#${right}]`)
      expect(messages[1].content).toContain(`[observation#${f.observationId}]`)
      return modelReport(
        { sourceType: 'canon', sourceId: left, quote: shared },
        { sourceType: 'canon', sourceId: right, quote: shared },
        { sourceType: 'observation', sourceId: f.observationId, quote: '获得 潮汐钥匙 ×1' },
      )
    }))
    const finding = result.candidate.findings.find(item => item.category === '持有物')!
    expect(finding.severity).toBe('hard')
    expect(finding.evidence.map(item => [item.sourceType, item.sourceId])).toEqual([
      ['canon', left], ['canon', right], ['observation', f.observationId],
    ])
    expect(finding.evidence[0].position?.start).not.toBe(finding.evidence[1].position?.start)

    db.close(); await db.open()
    const restored = await readLatestConsistencyAgentRun({ projectId: f.scope.projectId, chapterId: f.targetChapterId })
    expect(restored?.candidate).toEqual(result.candidate)
    const stored = (await db.agentRunArtifacts.toArray()).find(row => row.artifactKind === 'rendered-request')
    const request = JSON.parse(stored!.content!) as {
      messages: Array<{ content: string }>
      citationIndex: { segments: Array<{ key: string; start: number; end: number; versionHash: string }> }
      citationIndexHash: string
    }
    expect(request.citationIndexHash).toBe(await hashCanonicalValue(request.citationIndex))
    expect(request.citationIndexHash).toBe(restored?.candidate.context.citationIndexHash)
    for (const item of finding.evidence) {
      const position = item.position!
      const source = request.citationIndex.segments.find(segment => segment.key === position.sourceKey)!
      const bytes = request.messages[1].content.slice(source.start, source.end)
      expect(await sha256Text(bytes)).toBe(source.versionHash)
      expect(position.versionHash).toBe(source.versionHash)
      expect(bytes.slice(position.start, position.end)).toBe(item.quote)
    }
  })

  it.each(['wrong-type', 'borrowed-quote', 'foreign-scope', 'duplicate-text-invalid-id'] as const)('rejects an identity mismatch (%s)', async kind => {
    const f = await seedConsistencyProject()
    const left = await addConfirmedCanon(f.scope, '北门', '潮后开门')
    const right = await addConfirmedCanon(f.scope, '南门', '月落关门')
    const foreign = await seedCurrentWorkspace('077 无关项目')
    const foreignId = await addConfirmedCanon(foreign.scope, '异域城门', '潮后开门')
    const evidence = kind === 'wrong-type' ? { sourceType: 'observation', sourceId: right, quote: '月落关门' }
      : kind === 'borrowed-quote' ? { sourceType: 'canon', sourceId: left, quote: '月落关门' }
      : kind === 'foreign-scope' ? { sourceType: 'canon', sourceId: foreignId, quote: '潮后开门' }
      : { sourceType: 'canon', sourceId: 987654, quote: '潮后开门' }
    let calls = 0
    await expect(runDurableConsistencyAuditV1(runInput(f, async messages => {
      calls++
      expect(messages[1].content).toContain('潮后开门')
      expect(messages[1].content).toContain('月落关门')
      expect(messages[1].content).not.toContain('异域城门')
      return modelReport(evidence)
    }))).rejects.toThrow('引文、证据无效')
    expect(calls).toBe(1)
    expect(await db.agentEvents.count()).toBe(0)
  })

  it('keeps a clipped Canon source out of the eligible citation catalog', async () => {
    const f = await seedConsistencyProject()
    const id = await addConfirmedCanon(f.scope, '巨型资料', '原始章程。' + '条例'.repeat(6000))
    let calls = 0
    await expect(runDurableConsistencyAuditV1(runInput(f, async messages => {
      calls++
      expect(messages[1].content).toContain('原始章程。')
      expect(messages[1].content).toContain('【可引用外部资料目录】observation')
      return modelReport({ sourceType: 'canon', sourceId: id, quote: '原始章程。' })
    }))).rejects.toThrow('引文、证据无效')
    expect(calls).toBe(1)
  })

  it('never signs an earlier checkpoint without the citation index and preserves its exact paid response', async () => {
    const f = await seedConsistencyProject()
    const raw = modelReport({ sourceType: 'chapter', sourceId: 0, anchorId: 'p1' })
    let calls = 0
    const invoke = async () => { calls++; return raw }
    await expect(runDurableConsistencyAuditV1(runInput(f, invoke, {
      onDurableBoundary: (stage) => {
        if (stage === 'candidate.checkpoint') throw new Error('synthetic interruption before verification')
      },
    }))).rejects.toThrow('synthetic interruption before verification')
    const row = (await db.agentRuns.orderBy('id').last())!
    const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(f.scope, row.id!)
    const candidate = checkpoint?.resumePayload
    if (!isConsistencyAgentCandidateV1(candidate) || !candidate.durable) throw new Error('fixture checkpoint missing')
    const { citationIndexHash: _citationIndexHash, ...legacyContext } = candidate.context
    const legacy = { ...candidate, context: legacyContext,
      findings: candidate.findings.map(finding => ({ ...finding, evidence: finding.evidence.map(
        ({ position: _position, ...source }) => source,
      ) })) }
    const legacyCandidate = { ...legacy, durable: {
      ...candidate.durable, candidateHash: await hashConsistencyAgentCandidateV1(legacy),
    } }
    const state = await readAgentRunV1(f.scope, row.id!)
    await createAgentRunCheckpointV1({ scope: f.scope, runId: row.id!, resumePayload: legacyCandidate,
      expectedLastSequence: state.projection.lastSequence })
    db.close(); await db.open()
    await expect(runDurableConsistencyAuditV1(runInput(f, invoke))).rejects.toThrow('旧审计候选未核验引文来源，不能补签')
    const cancelled = await readAgentRunV1(f.scope, row.id!)
    expect(cancelled.projection.state).toBe('cancelled')
    expect(cancelled.projection.terminalReceiptHash).toBeUndefined()
    expect(await db.agentEvents.count()).toBe(0)
    expect(calls).toBe(1)
    const paid = (await db.agentRunArtifacts.toArray()).find(artifact => artifact.artifactKind === 'raw-response')
    expect(JSON.parse(paid!.content!).raw).toBe(raw)
  })
})
