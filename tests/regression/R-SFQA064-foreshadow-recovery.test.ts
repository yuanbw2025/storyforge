import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { adoptForeshadowSuggestionCandidateV1, generateForeshadowSuggestionCandidateV1 } from '../../src/lib/agent/run/foreshadow-suggestions-durable'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import type { WorkspaceScope } from '../../src/lib/types'
import { stampCurrentFixtureResourceUidsV1 } from '../helpers/current-resource-identity'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

async function seed(suffix = '') {
  const now = Date.now()
  const created = await seedCurrentWorkspace(`镜城伏笔${suffix}`, { enableMultiWorld: true })
  const { projectId, worldId, workId } = created.scope
  const worldGroupId = await db.worldGroups.add({
    projectId, worldId, name: '镜城', description: '', type: 'primary', icon: '🪞', order: 0,
    createdAt: now, updatedAt: now,
  } as any) as number
  await db.worldviews.add({
    projectId, worldId, worldGroupId, worldOrigin: '镜海退潮时，被典当的记忆凝成盐晶。',
    factionLayout: '镜税署与拾忆行会争夺盐晶解释权。', createdAt: now, updatedAt: now,
  } as any)
  const storyCoreId = await db.storyCores.add({
    projectId, workId, theme: '记忆与责任', centralConflict: '守灯人必须公开镜税真相。',
    plotPattern: '线性调查', mainPlot: '', createdAt: now, updatedAt: now,
  } as any) as number
  const characterId = await db.characters.add({
    projectId, worldId, homeWorldGroupId: worldGroupId, isCrossWorld: false, name: '沈砚',
    roleWeight: 'main', moralAxis: 'good', orderAxis: 'lawful',
    shortDescription: '能听见盐晶中的遗言。', createdAt: now, updatedAt: now,
  } as any) as number
  const existingId = await db.foreshadows.add({
    projectId, workId, name: '无主盐晶', type: 'chekhov', status: 'planned',
    description: '盐晶没有登记主人，最终指向被抹去的第一任镜税官。',
    plantChapterId: null, echoChapterIds: '[]', resolveChapterId: null, notes: '',
    createdAt: now, updatedAt: now,
  } as any) as number
  await stampCurrentFixtureResourceUidsV1(projectId)
  return {
    scope: { projectId, worldId, workId } satisfies WorkspaceScope,
    projectId, worldId, workId, worldGroupId, storyCoreId, characterId, existingId,
  }
}

function suggestion(name: string, type = 'symbol') {
  return {
    name,
    type,
    description: `${name}在前段以不起眼细节出现，中段改变含义，结尾兑现为主角必须承担的选择。`,
  }
}

function response(...items: ReturnType<typeof suggestion>[]) {
  return JSON.stringify({ foreshadows: items })
}


beforeEach(async () => {
  await db.delete()
  await db.open()
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network') }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  db.close()
})

it.each(['unchanged', 'stale'] as const)('H72 recovery with %s character after the intent', async mode => {
  const f = await seed(mode)
  const model = vi.fn(async () => response(suggestion('审查探针伏笔')))
  const generated = await generateForeshadowSuggestionCandidateV1({ scope: f.scope, worldGroupId: f.worldGroupId, runAI: model })
  const ref = { scope: f.scope, runId: generated.snapshot.run.id, selectedIndexes: [0] }
  await expect(adoptForeshadowSuggestionCandidateV1({
    ...ref, onDurableBoundary: boundary => {
      if (boundary === 'adoption.started') throw new Error('Interrupted before Canon')
    },
  })).rejects.toThrow('Interrupted before Canon')
  const before = await db.foreshadows.toArray()
  expect(before).toHaveLength(1)
  if (mode === 'unchanged') {
    const adopted = await adoptForeshadowSuggestionCandidateV1(ref)
    expect((await adoptForeshadowSuggestionCandidateV1(ref)).receiptHash).toBe(adopted.receiptHash)
    expect(await db.foreshadows.count()).toBe(2)
  } else {
    const shortDescription = '作者已改为听不见盐晶遗言。'
    await db.characters.update(f.characterId, { shortDescription })
    await expect(adoptForeshadowSuggestionCandidateV1(ref)).rejects.toThrow(/过期|漂移|不一致/)
    expect(await db.foreshadows.toArray()).toEqual(before)
    expect((await db.characters.get(f.characterId))?.shortDescription).toBe(shortDescription)
    expect((await readAgentRunV1(f.scope, ref.runId)).projection.terminalReceiptHash).toBeFalsy()
  }
  expect(model).toHaveBeenCalledTimes(1)
  expect(fetch).not.toHaveBeenCalled()
})

it.each(['receipt-only', 'receipt-stale'] as const)('H72 preserves the written rows in %s recovery', async mode => {
  const f = await seed(mode)
  const model = vi.fn(async () => response(suggestion('实际已写的伏笔')))
  const generated = await generateForeshadowSuggestionCandidateV1({ scope: f.scope, worldGroupId: f.worldGroupId, runAI: model })
  const ref = { scope: f.scope, runId: generated.snapshot.run.id, selectedIndexes: [0] }
  await expect(adoptForeshadowSuggestionCandidateV1({
    ...ref, onDurableBoundary: boundary => {
      if (boundary === 'formal.written') throw new Error('Interrupted before receipt')
    },
  })).rejects.toThrow('Interrupted before receipt')
  const before = await db.foreshadows.toArray()
  expect(before).toHaveLength(2)
  if (mode === 'receipt-stale') {
    await db.storyCores.update(f.storyCoreId, { centralConflict: '作者改变故事核心。' })
    await expect(adoptForeshadowSuggestionCandidateV1(ref)).rejects.toThrow(/漂移/)
    expect((await readAgentRunV1(f.scope, ref.runId)).projection.terminalReceiptHash).toBeFalsy()
  } else {
    const receipt = await adoptForeshadowSuggestionCandidateV1(ref)
    expect((await adoptForeshadowSuggestionCandidateV1(ref)).receiptHash).toBe(receipt.receiptHash)
    expect(receipt.snapshot.events.filter(event => event.type === 'adoption.committed')).toHaveLength(1)
  }
  expect(await db.foreshadows.toArray()).toEqual(before)
  expect(model).toHaveBeenCalledTimes(1)
  expect(fetch).not.toHaveBeenCalled()
})
