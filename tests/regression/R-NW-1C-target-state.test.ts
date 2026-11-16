import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { db } from '../../src/lib/db/schema'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { makeRagEntryKey } from '../../src/lib/retrieval/rag-library'
import { matchesSavedNarrativeBaselineV1, prepareNarrativeCandidateV1 } from '../../src/lib/world-engine/narrative-domain-candidate'
import { generateNarrativeAnnotationCandidateV1, readNarrativeAnnotationRunV1, reviseNarrativeAnnotationCandidateV1,
  adoptNarrativeAnnotationCandidateV1 } from '../../src/lib/agent/run/narrative-annotation-durable'
import { deriveExportProjectJSON } from '../../src/lib/export/registry-export'
import { deriveImportProjectJSON } from '../../src/lib/export/registry-import'
import { seedConfirmedNarrativeDomainV1 } from '../helpers/narrative-domain-fixture'
import type { ChatMessage } from '../../src/lib/types'
import { CANON_RESOURCE_PROVIDER_V1 } from '../../src/lib/context-gateway/canon-provider'

const legacyPath = 'tests/acceptance/narrative-world/target-state-legacy-candidate-20261015-v1.json'

describe('NW-1C · 既有子记录的目标状态交接', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_900_000_000_000)
    await db.delete(); await db.open()
  })
  afterEach(() => { db.close(); vi.restoreAllMocks(); vi.useRealTimers() })

  async function setup(multiple = false) {
    const fixture = await seedConfirmedNarrativeDomainV1()
    const actor = (await db.characters.get(fixture.ids.a))!
    if (multiple) await fixture.confirm('foreshadows', fixture.foreshadow.id!, { narrativeDevelopmentsV1: [
      fixture.development, { ...fixture.development, semanticSubKey: 'sub:v1:00000000-0000-4000-8000-000000000088', statement: '测试作者的另一条独立计划' },
    ] })
    const row = (await db.foreshadows.get(fixture.foreshadow.id!))!
    const selection = { table: 'foreshadows', sourceUid: row.ragDocumentId!, owner: fixture.input.owner,
      entryKeys: [makeRagEntryKey(row.ragDocumentId!, 'description'), makeRagEntryKey(actor.ragDocumentId!, 'name')] }
    return { fixture, actor, row, selection }
  }

  it('真实旧版 v3 候选备份仍可回读、审核和采纳；不重造旧 hash', async () => {
    if (process.env.NW_CAPTURE_LEGACY_TARGET_STATE === '1') {
      const { fixture, actor, selection } = await setup()
      const proposal = { annotations: { narrativeDevelopmentsV1: [{ ...fixture.development,
        owners: [{ characterId: null, sourceUid: actor.ragDocumentId }], state: 'advancing' }] }, clearFields: [] }
      const generated = await generateNarrativeAnnotationCandidateV1({ scope: fixture.scope, selection,
        instruction: '保留这条既有计划的身份。', modelIdentity: { provider: 'fixture', model: 'legacy-capture-only' },
        runAI: async () => ({ output: JSON.stringify(proposal), durationMs: 1 }) })
      const loaded = await readNarrativeAnnotationRunV1(fixture.scope, generated.snapshot.run.id)
      expect(loaded.state.promptVersion).toBe('narrative-annotation-extract-v3')
      expect(loaded.state.baseline).not.toHaveProperty('targetState')
      const sources = ['src/lib/agent/run/narrative-annotation-durable.ts', 'src/lib/world-engine/narrative-domain-candidate.ts',
        'src/lib/retrieval/rag-library.ts', 'src/lib/agent/skill-registry.ts']
      writeFileSync(legacyPath, JSON.stringify({ schema: 'storyforge.narrative-legacy-target-candidate', version: 1,
        boundary: 'Actual prior-v3 durable run with a fixture model, exported before implementation changes; no real model or author acceptance.',
        sourceHashes: Object.fromEntries(sources.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])),
        candidateHash: generated.candidate.candidateHash, baselineHash: loaded.state.baselineHash,
        promptVersion: loaded.state.promptVersion, sourceUid: selection.sourceUid,
        project: await deriveExportProjectJSON(fixture.scope.projectId),
      }, null, 2) + '\n', { flag: 'wx' })
    }
    const legacy = JSON.parse(readFileSync(legacyPath, 'utf8'))
    const projectId = await deriveImportProjectJSON(legacy.project)
    const work = (await db.works.where('projectId').equals(projectId).toArray())[0]
    const scope = { projectId, workId: work.id!, worldId: work.worldId }
    const run = (await db.agentRuns.where('projectId').equals(projectId).toArray())[0]
    const loaded = await readNarrativeAnnotationRunV1(scope, run.id!)
    const restored = await deriveExportProjectJSON(projectId)
    const detached = legacy.project.chapters[4]
    const chapter = restored.chapters.find(row => row.ragDocumentId === detached.ragDocumentId)!
    expect(chapter.content).toBe(detached.content)
    const outline = restored.outlineNodes.find(row => row._exportId === chapter._outlineExportId)!
    expect(outline.title).toBe('【恢复占位·原章纲待确认】' + detached.title)
    const review = restored.notes.find(note => note.content.includes('来源 v16'))!
    expect(review.content).toContain(detached.ragDocumentId)
    expect(loaded.state.promptVersion).toBe('narrative-annotation-extract-v3')
    expect(loaded.state.baselineHash).toBe(legacy.baselineHash)
    expect(loaded.candidate!.candidateHash).toBe(legacy.candidateHash)
    expect(loaded.state.baseline).not.toHaveProperty('targetState')
    const checked = await prepareNarrativeCandidateV1({ scope, selection: loaded.state.selection, includeTargetState: false })
    expect(checked.baselineHash).not.toBe(legacy.baselineHash)
    expect(await matchesSavedNarrativeBaselineV1(checked, '0'.repeat(64))).toBe(false)
    const proposal = structuredClone(loaded.candidate!.proposal!)
    const children = proposal.annotations.narrativeDevelopmentsV1 as Array<Record<string, unknown>>
    children[0].state = 'open'
    const revised = await reviseNarrativeAnnotationCandidateV1({ scope, runId: run.id!,
      expectedCandidateHash: legacy.candidateHash, draft: JSON.stringify(proposal) })
    await adoptNarrativeAnnotationCandidateV1({ scope, runId: run.id!, candidateHash: revised.candidate.candidateHash })
    expect((await readNarrativeAnnotationRunV1(scope, run.id!)).staleReason).toBeNull()
    const row = (await db.foreshadows.where('projectId').equals(projectId).toArray()).find(item => item.ragDocumentId === legacy.sourceUid)!
    expect(row.narrativeDevelopmentsV1![0].semanticSubKey).toBe(children[0].semanticSubKey)
    expect(row.narrativeDevelopmentsV1![0].state).toBe('open')
  })

  it('登记源提供唯一目标的既有注释，原文与注释分开，FK 只保留便携身份', async () => {
    const { fixture, row, selection } = await setup(true)
    const prepared = await prepareNarrativeCandidateV1({ scope: fixture.scope, selection })
    const payload = JSON.parse(prepared.assembled.text)
    expect(payload.targetState).toMatchObject({ version: 1, table: 'foreshadows', sourceUid: row.ragDocumentId })
    expect(payload.targetState.annotations.narrativeDevelopmentsV1.map((child: { semanticSubKey: string }) => child.semanticSubKey))
      .toEqual(row.narrativeDevelopmentsV1!.map(child => child.semanticSubKey))
    expect(payload.targetState.annotations.narrativeDevelopmentsV1[1].statement).toBe('测试作者的另一条独立计划')
    expect(payload.fields.map((field: { text: string }) => field.text)).not.toContain('测试作者的另一条独立计划')
    expect(prepared.baseline.targetState).toEqual(payload.targetState)
    expect(JSON.stringify(payload.targetState)).not.toMatch(/"(?:characterId|chapterId|factId)":\d/)
    expect(payload.targetState).not.toHaveProperty('narrativeAuthorityV1')
    expect(prepared.assembled.sourceEvidence![0].delivery).toBe('full')
  })

  it('模型从实际输入取得多个子身份；重排候选、刷新、便携恢复后仍只更新对应子记录', async () => {
    const { fixture, row, selection } = await setup(true)
    const runAI = vi.fn(async (messages: ChatMessage[]) => {
      const material = JSON.parse(messages[1].content.split('\n登记原文与修改前状态：\n')[1])
      const children = material.targetState.annotations.narrativeDevelopmentsV1 as Array<Record<string, unknown>>
      expect(children).toHaveLength(2)
      return { output: JSON.stringify({ annotations: { narrativeDevelopmentsV1: children.map((child, at) => ({
        ...child, state: at === 1 ? 'advancing' : 'open',
      })).reverse() }, clearFields: [] }), durationMs: 1 }
    })
    const generated = await generateNarrativeAnnotationCandidateV1({ scope: fixture.scope, selection,
      instruction: '核对两条既有计划，保留各自身份。', modelIdentity: { provider: 'fixture', model: 'input-driven-test' }, runAI })
    expect(generated.candidate.artifact.status).toBe('ready')
    expect(await db.foreshadows.get(row.id!)).toEqual(row)
    db.close(); await db.open()
    const loaded = await readNarrativeAnnotationRunV1(fixture.scope, generated.snapshot.run.id)
    expect(loaded.state.promptVersion).toBe('narrative-annotation-extract-v4')
    expect(loaded.state.baseline.targetState).toHaveProperty('annotations.narrativeDevelopmentsV1')
    const projectId = await deriveImportProjectJSON(await deriveExportProjectJSON(fixture.scope.projectId))
    const work = (await db.works.where('projectId').equals(projectId).toArray())[0]
    const scope = { projectId, workId: work.id!, worldId: work.worldId }
    const run = (await db.agentRuns.where('projectId').equals(projectId).toArray())[0]
    const restored = await readNarrativeAnnotationRunV1(scope, run.id!)
    expect(restored.candidate!.candidateHash).toBe(generated.candidate.candidateHash)
    expect(restored.state.baseline.targetState).toEqual(loaded.state.baseline.targetState)
    await adoptNarrativeAnnotationCandidateV1({ scope, runId: run.id!, candidateHash: restored.candidate!.candidateHash })
    const after = (await db.foreshadows.where('projectId').equals(projectId).toArray()).find(item => item.ragDocumentId === row.ragDocumentId)!
    expect(after.narrativeDevelopmentsV1!.map(child => [child.semanticSubKey, child.state]).sort())
      .toEqual([[row.narrativeDevelopmentsV1![0].semanticSubKey, 'open'], [row.narrativeDevelopmentsV1![1].semanticSubKey, 'advancing']].sort())
    expect(await db.foreshadows.get(row.id!)).toEqual(row)
    expect(runAI).toHaveBeenCalledTimes(1)
  })

  it('章节揭示使用同一目标状态通道，保留子身份并服从揭示字段自身权限', async () => {
    const { fixture } = await setup()
    const row = (await db.chapters.get(fixture.ids.chapter))!
    const selection = { table: 'chapters', sourceUid: row.ragDocumentId!, owner: fixture.input.owner,
      entryKeys: [makeRagEntryKey(row.ragDocumentId!, 'content')] }
    const prepared = await prepareNarrativeCandidateV1({ scope: fixture.scope, selection })
    const disclosures = prepared.baseline.targetState!.annotations.narrativeDisclosuresV1!
    expect(disclosures.map(child => child.semanticSubKey)).toEqual(row.narrativeDisclosuresV1!.map(child => child.semanticSubKey))
    expect(JSON.stringify(disclosures)).not.toMatch(/"(?:chapterId|factId|storyEventId)":\d/)
    expect(prepared.baseline.originalFields[0].text).toBe(row.content)
    await db.chapters.update(row.id!, { ragPolicy: { fields: { narrativeDisclosuresV1: { enabled: false } } } })
    await expect(prepareNarrativeCandidateV1({ scope: fixture.scope, selection })).rejects.toThrow('注释字段已停用')
  })

  it('读取途中旧注释变化会在请求模型前停止，不把两个版本拼成同一基线', async () => {
    const { fixture, row, selection } = await setup()
    const read = CANON_RESOURCE_PROVIDER_V1.readOriginal.bind(CANON_RESOURCE_PROVIDER_V1)
    vi.spyOn(CANON_RESOURCE_PROVIDER_V1, 'readOriginal').mockImplementationOnce(async input => {
      const result = await read(input)
      await db.foreshadows.update(row.id!, { narrativeDevelopmentsV1: [{ ...row.narrativeDevelopmentsV1![0], statement: '读取期间作者改写了计划' }] })
      return result
    })
    const runAI = vi.fn(async () => ({ output: '{}', durationMs: 1 }))
    await expect(generateNarrativeAnnotationCandidateV1({ scope: fixture.scope, selection,
      instruction: '核对既有计划', modelIdentity: { provider: 'fixture', model: 'test-only' }, runAI })).rejects.toThrow('变化')
    expect(runAI).not.toHaveBeenCalled()
    expect(await db.agentRuns.count()).toBe(0)
  })

  it('候选保存后既有注释改变会使审核过期，旧候选不能覆盖作者的新修改', async () => {
    const { fixture, row, selection } = await setup()
    const generated = await generateNarrativeAnnotationCandidateV1({ scope: fixture.scope, selection,
      instruction: '核对既有计划', modelIdentity: { provider: 'fixture', model: 'test-only' },
      runAI: async messages => ({ output: JSON.stringify({ annotations: JSON.parse(messages[1].content.split('\n登记原文与修改前状态：\n')[1]).targetState.annotations, clearFields: [] }), durationMs: 1 }) })
    expect(generated.candidate.artifact.status).toBe('ready')
    const changed = [{ ...row.narrativeDevelopmentsV1![0], statement: '作者后来重新安排了另一件事' }]
    await db.foreshadows.update(row.id!, { narrativeDevelopmentsV1: changed })
    expect((await readNarrativeAnnotationRunV1(fixture.scope, generated.snapshot.run.id)).staleReason).toContain('变化')
    await expect(adoptNarrativeAnnotationCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id,
      candidateHash: generated.candidate.candidateHash })).rejects.toThrow('变化')
    expect((await db.foreshadows.get(row.id!))!.narrativeDevelopmentsV1).toEqual(changed)
  })

  it('既有注释字段禁读时调用前停止；原文字段可读不会代替该权限', async () => {
    const { fixture, row, selection } = await setup()
    await db.foreshadows.update(row.id!, { ragPolicy: { enabled: true, fields: { narrativeDevelopmentsV1: { enabled: false } } } })
    const runAI = vi.fn(async () => ({ output: '{}', durationMs: 1 }))
    await expect(generateNarrativeAnnotationCandidateV1({ scope: fixture.scope, selection,
      instruction: '核对既有计划', modelIdentity: { provider: 'fixture', model: 'test-only' }, runAI })).rejects.toThrow('注释字段已停用')
    expect(runAI).not.toHaveBeenCalled()
    expect(await db.agentRuns.count()).toBe(0)
  })

  it('目标必须在所选来源闭集中，普通读取与产品运行不能顺带读取注释状态', async () => {
    const { fixture, row, selection } = await setup()
    const input = { projectId: fixture.scope.projectId, scope: fixture.scope, sourceKeys: ['ragSelection'],
      ragEntryKeys: selection.entryKeys, ragAnnotationTarget: { table: selection.table, sourceUid: row.ragDocumentId! } }
    await expect(assembleContext(input)).rejects.toThrow('精确原文模式')
    await expect(assembleContext({ ...input, ragReadMode: 'original-evidence-v1',
      ragEntryKeys: [selection.entryKeys[1]] })).rejects.toThrow('目标必须包含在已选原文')
    await expect(assembleContext({ ...input, ragReadMode: 'original-evidence-v1', ragEntryKeys: [] }))
      .rejects.toThrow('目标必须包含在已选原文')
    await expect(assembleContext({ ...input, ragReadMode: 'original-evidence-v1', productRuntimeSessionId: 987654 }))
      .rejects.toThrow('产品运行只能读取冻结世界')
  })

  it('既有注释也计入完整输入预算，超预算不会截断身份后继续请求模型', async () => {
    const { fixture, row, selection } = await setup()
    await db.foreshadows.update(row.id!, { narrativeDevelopmentsV1: [{ ...row.narrativeDevelopmentsV1![0], statement: '完整的旧计划'.repeat(8000) }] })
    const runAI = vi.fn(async () => ({ output: '{}', durationMs: 1 }))
    await expect(generateNarrativeAnnotationCandidateV1({ scope: fixture.scope, selection,
      instruction: '核对既有计划', modelIdentity: { provider: 'fixture', model: 'test-only' }, runAI })).rejects.toThrow('超过输入预算')
    expect(runAI).not.toHaveBeenCalled()
  })
})
