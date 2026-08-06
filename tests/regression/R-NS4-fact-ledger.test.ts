/**
 * R-NS4-fact-ledger · 事实账本写回（NS-4 ②）
 * 守卫：候选写回解析 FK + 去重 + 落 candidate；确认时单值 state 谓词关闭旧权威、event 不被 supersede。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { adoptFactCandidates, confirmFactCandidate, rejectFactCandidate } from '../../src/lib/fact-ledger/fact-ledger'
import type { ExtractedFactCandidate } from '../../src/lib/ai/adapters/fact-extract-adapter'

const now = Date.now()
async function seed() {
  const pid = await db.projects.add({ name: 'P', genre: 'x', description: '', targetWordCount: 0, enableMultiWorld: false, createdAt: now, updatedAt: now } as any) as number
  const charId = await db.characters.add({ projectId: pid, name: '林飞', role: 'protagonist', createdAt: now, updatedAt: now } as any) as number
  const c1 = await db.chapters.add({ projectId: pid, outlineNodeId: null, title: '第1章', content: '', wordCount: 0, status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now } as any) as number
  const c2 = await db.chapters.add({ projectId: pid, outlineNodeId: null, title: '第2章', content: '', wordCount: 0, status: 'draft', order: 1, notes: '', createdAt: now, updatedAt: now } as any) as number
  return { pid, charId, c1, c2 }
}
const cand = (over: Partial<ExtractedFactCandidate>): ExtractedFactCandidate => ({ subjectName: '林飞', predicate: 'location', factKind: 'state', value: '洛阳', sourceQuote: 'q', ...over })

describe('NS-4 · fact-ledger', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('写回:解析角色 FK + 落 candidate', async () => {
    const { pid, charId, c1 } = await seed()
    const r = await adoptFactCandidates({ projectId: pid, sourceChapterId: c1, candidates: [cand({})] })
    expect(r.written).toBe(1)
    const f = (await db.temporalFacts.where('projectId').equals(pid).toArray())[0]
    expect(f.characterId).toBe(charId)        // 主体名 → FK 解析
    expect(f.status).toBe('candidate')        // 落 observation
    expect(f.validFromChapterId).toBe(c1)
  })

  it('去重:同主体+谓词+值的未关闭候选不重复写', async () => {
    const { pid, c1 } = await seed()
    await adoptFactCandidates({ projectId: pid, sourceChapterId: c1, candidates: [cand({})] })
    const r2 = await adoptFactCandidates({ projectId: pid, sourceChapterId: c1, candidates: [cand({}), cand({ value: '北境' })] })
    expect(r2.skippedDuplicate).toBe(1)       // 洛阳重复
    expect(r2.written).toBe(1)                // 北境新增
  })

  it('枚举值写入前归一，非法值拒绝；相同角色名在不同世界不互相去重', async () => {
    const { pid, charId, c1 } = await seed()
    await db.characters.update(charId, { homeWorldGroupId: 7 })
    const otherWorldCharacterId = await db.characters.add({
      projectId: pid, name: '林飞', role: 'supporting',
      homeWorldGroupId: 8, createdAt: now, updatedAt: now,
    } as any) as number
    const death = cand({ predicate: 'aliveStatus', value: '身亡' })
    const invalid = cand({ predicate: 'aliveStatus', value: '半死不活' })
    const first = await adoptFactCandidates({
      projectId: pid, sourceChapterId: c1, worldGroupId: 7,
      candidates: [death, invalid],
    })
    const second = await adoptFactCandidates({
      projectId: pid, sourceChapterId: c1, worldGroupId: 8,
      candidates: [death],
    })
    expect(first).toMatchObject({ written: 1, skippedInvalidValue: 1 })
    expect(second.written).toBe(1)
    const facts = await db.temporalFacts.where('projectId').equals(pid).toArray()
    expect(facts.map(row => row.value)).toEqual(['dead', 'dead'])
    expect(facts.find(row => row.worldGroupId === 7)?.characterId).toBe(charId)
    expect(facts.find(row => row.worldGroupId === 8)?.characterId).toBe(otherWorldCharacterId)
  })

  it('确认单值 state 候选 → 关闭旧权威、自身升 confirmed', async () => {
    const { pid, c1, c2 } = await seed()
    // 旧权威:第1章 location=洛阳(confirmed)
    await db.temporalFacts.add({ projectId: pid, subjectName: '林飞', predicate: 'location', factKind: 'state', value: '洛阳', sourceType: 'chapter', sourceChapterId: c1, validFromChapterId: c1, validToChapterId: null, status: 'confirmed', locked: false, createdAt: now, updatedAt: now } as any)
    // 新候选:第2章 location=北境
    await adoptFactCandidates({ projectId: pid, sourceChapterId: c2, candidates: [cand({ value: '北境' })] })
    const newCand = (await db.temporalFacts.where('projectId').equals(pid).filter(f => f.value === '北境').toArray())[0]
    await confirmFactCandidate(newCand.id!)

    const all = await db.temporalFacts.where('projectId').equals(pid).toArray()
    const old = all.find(f => f.value === '洛阳')!
    const neu = all.find(f => f.value === '北境')!
    expect(neu.status).toBe('confirmed')      // 自身升权威
    expect(old.status).toBe('superseded')     // 旧权威被关闭
    expect(old.validToChapterId).toBe(c2)     // 有效期截止到新事实生效章
  })

  it('逆序确认时保留后章当前状态，前章候选成为有截止点的历史 Canon', async () => {
    const { pid, c1, c2 } = await seed()
    await adoptFactCandidates({
      projectId: pid, sourceChapterId: c2,
      candidates: [cand({ value: '北境' })],
    })
    const later = (await db.temporalFacts.where('projectId').equals(pid)
      .filter(f => f.value === '北境').toArray())[0]
    await confirmFactCandidate(later.id!)

    await adoptFactCandidates({
      projectId: pid, sourceChapterId: c1,
      candidates: [cand({ value: '洛阳' })],
    })
    const earlier = (await db.temporalFacts.where('projectId').equals(pid)
      .filter(f => f.value === '洛阳').toArray())[0]
    await confirmFactCandidate(earlier.id!)

    expect(await db.temporalFacts.get(later.id!)).toMatchObject({
      status: 'confirmed',
      validToChapterId: null,
    })
    expect(await db.temporalFacts.get(earlier.id!)).toMatchObject({
      status: 'superseded',
      validToChapterId: c2,
    })
  })

  it('locked 旧事实不被自动 supersede', async () => {
    const { pid, c1, c2 } = await seed()
    await db.temporalFacts.add({ projectId: pid, subjectName: '林飞', predicate: 'location', factKind: 'state', value: '洛阳', sourceType: 'chapter', sourceChapterId: c1, validFromChapterId: c1, validToChapterId: null, status: 'confirmed', locked: true, createdAt: now, updatedAt: now } as any)
    await adoptFactCandidates({ projectId: pid, sourceChapterId: c2, candidates: [cand({ value: '北境' })] })
    const newCand = (await db.temporalFacts.where('projectId').equals(pid).filter(f => f.value === '北境').toArray())[0]
    await confirmFactCandidate(newCand.id!)
    const old = (await db.temporalFacts.where('projectId').equals(pid).filter(f => f.value === '洛阳').toArray())[0]
    expect(old.status).toBe('confirmed')      // locked 不被动
    expect(old.validToChapterId).toBeNull()
  })

  it('异常状态可由作者重新确认或否决', async () => {
    const { pid, c1 } = await seed()
    const staleId = await db.temporalFacts.add({
      projectId: pid, subjectName: '林飞', predicate: 'location', factKind: 'state', value: '洛阳',
      sourceType: 'chapter', sourceChapterId: c1, validFromChapterId: c1,
      status: 'stale', locked: false, createdAt: now, updatedAt: now,
    } as any) as number
    const missingId = await db.temporalFacts.add({
      projectId: pid, subjectName: '旧角色', predicate: 'location', factKind: 'state', value: '旧城',
      sourceType: 'manual', status: 'source-missing', locked: false, createdAt: now, updatedAt: now,
    } as any) as number

    await confirmFactCandidate(staleId)
    await rejectFactCandidate(missingId)

    expect((await db.temporalFacts.get(staleId))?.status).toBe('confirmed')
    expect((await db.temporalFacts.get(missingId))?.status).toBe('rejected')
  })
})
