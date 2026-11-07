import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { confirmFactCandidate, rejectFactCandidate, replaceConstitutionFactCandidate } from '../../src/lib/fact-ledger/fact-ledger'
import { fingerprintSettingSource } from '../../src/lib/fact-ledger/setting-assertions'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import type { TemporalFact } from '../../src/lib/types/temporal-fact'
import type { Chapter, Character, OutlineNode, WorldGroup } from '../../src/lib/types'
import { currentWorkFixtureRecordV1, seedCurrentWorkspace } from '../helpers/current-workspace'

async function seed() {
  const { scope } = await seedCurrentWorkspace('124 隔离事实')
  const chapters: number[] = []
  for (let order = 0; order < 4; order++) {
    const outlineNodeId = await db.outlineNodes.add(stampNewRecord<OutlineNode>(scope, 'outlineNodes', {
      projectId: scope.projectId, parentId: null, type: 'chapter', title: `章${order + 1}`,
      summary: '', order, createdAt: 1, updatedAt: 1,
    }, { owner: 'work' }))
    chapters.push(await db.chapters.add(stampNewRecord<Chapter>(scope, 'chapters', {
      projectId: scope.projectId, outlineNodeId, title: `章${order + 1}`,
      content: '林飞来到洛阳。随后前往北境。', wordCount: 15, status: 'draft', order,
      notes: '', createdAt: 1, updatedAt: 1,
    }, { owner: 'work' })))
  }
  const candidate = async (index: number | null, value: string, patch: Partial<TemporalFact> = {}) => {
    const chapterId = index == null ? null : chapters[index]
    const targetScope = patch.workId == null ? scope : { ...scope, workId: patch.workId }
    return db.temporalFacts.add(stampNewRecord(targetScope, 'temporalFacts', {
      projectId: scope.projectId, subjectName: '林飞', predicate: 'location', factKind: 'state', value,
      sourceType: chapterId == null ? 'manual' : 'chapter', sourceChapterId: chapterId,
      validFromChapterId: chapterId, validToChapterId: null,
      status: 'candidate', locked: false, createdAt: 1, updatedAt: 1, ...patch,
    }, { owner: 'work' }) as TemporalFact)
  }
  const context = async (index: number) => (await assembleContext({
    scope, projectId: scope.projectId, chapterId: chapters[index], sourceKeys: ['currentFacts'],
  })).text
  return { scope, chapters, candidate, context }
}

describe('SFQA-124 · Canon 确认的事务边界及区间', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })

  it.each([
    { secondChapter: 0, parallel: false }, { secondChapter: 0, parallel: true },
    { secondChapter: 1, parallel: false }, { secondChapter: 1, parallel: true },
  ])('同/异章、顺序/并发确认只留下一个当前值：%j', async ({ secondChapter, parallel }) => {
    const f = await seed()
    const ids = [await f.candidate(0, '洛阳'), await f.candidate(secondChapter, '北境')]
    const results = parallel
      ? await Promise.all(ids.map(confirmFactCandidate))
      : [await confirmFactCandidate(ids[0]), await confirmFactCandidate(ids[1])]
    expect(results.every(row => row.confirmed)).toBe(true)
    const rows = await db.temporalFacts.toArray()
    const current = rows.filter(row => row.status === 'confirmed')
    expect(current).toHaveLength(1)
    const history = rows.find(row => row.status === 'superseded')!
    expect(history.validToChapterId).toBe(current[0].validFromChapterId)
    expect(await f.context(3)).toContain(current[0].value)
    expect(await f.context(3)).not.toContain(history.value)
  })

  it('后章→前章→中章的补确认同时缩短历史区间，不在中章重叠', async () => {
    const f = await seed()
    const later = await f.candidate(2, '北境'), earlier = await f.candidate(0, '洛阳'), middle = await f.candidate(1, '海港')
    for (const id of [later, earlier, middle]) expect((await confirmFactCandidate(id)).confirmed).toBe(true)
    expect(await db.temporalFacts.get(earlier)).toMatchObject({ status: 'superseded', validToChapterId: f.chapters[1] })
    expect(await db.temporalFacts.get(middle)).toMatchObject({ status: 'superseded', validToChapterId: f.chapters[2] })
    expect(await db.temporalFacts.get(later)).toMatchObject({ status: 'confirmed', validToChapterId: null })
    for (const [index, yes, no] of [[0, '洛阳', '海港'], [1, '海港', '洛阳'], [2, '北境', '海港']] as const) {
      const text = await f.context(index)
      expect(text).toContain(yes); expect(text).not.toContain(no)
    }
  })

  it('锁定当前及历史区间阻止重叠确认，早于锁定起点的候选可成为历史', async () => {
    const f = await seed()
    const locked = await f.candidate(1, '洛阳', { status: 'confirmed', locked: true })
    const next = await f.candidate(2, '北境')
    const snapshot = await db.temporalFacts.get(locked)
    expect(await confirmFactCandidate(next)).toMatchObject({ confirmed: false, reason: 'locked-conflict' })
    expect(await db.temporalFacts.get(locked)).toEqual(snapshot)
    expect((await db.temporalFacts.get(next))?.status).toBe('candidate')
    const earlier = await f.candidate(0, '海港')
    expect((await confirmFactCandidate(earlier)).confirmed).toBe(true)
    expect(await db.temporalFacts.get(earlier)).toMatchObject({ status: 'superseded', validToChapterId: f.chapters[1] })
    await db.temporalFacts.update(locked, { status: 'superseded', validToChapterId: f.chapters[3] })
    expect(await confirmFactCandidate(next)).toMatchObject({ confirmed: false, reason: 'locked-conflict' })
  })

  it('独立 Work、主体、世界组及多值谓词互不关闭', async () => {
    const f = await seed()
    const sibling = await db.works.add(currentWorkFixtureRecordV1({ ...f.scope, title: '旁支' }))
    const otherWork = await f.candidate(null, '他作', { workId: sibling, status: 'confirmed' })
    const otherSubject = await f.candidate(0, '海港', { subjectName: '阿雨', status: 'confirmed' })
    const worldGroupId = await db.worldGroups.add(stampNewRecord<WorldGroup>(f.scope, 'worldGroups', {
      projectId: f.scope.projectId, name: '群岛', description: '', type: 'parallel', order: 0, createdAt: 1, updatedAt: 1,
    }, { owner: 'world' }))
    const otherGroup = await f.candidate(0, '群岛', { worldGroupId, status: 'confirmed' })
    const multi = [await f.candidate(0, '剑', { predicate: 'owns' }), await f.candidate(0, '盾', { predicate: 'owns' })]
    const snapshots = await db.temporalFacts.bulkGet([otherWork, otherSubject, otherGroup])
    expect((await confirmFactCandidate(await f.candidate(1, '北境'))).confirmed).toBe(true)
    expect((await Promise.all(multi.map(confirmFactCandidate))).every(row => row.confirmed)).toBe(true)
    expect(await db.temporalFacts.bulkGet([otherWork, otherSubject, otherGroup])).toEqual(snapshots)
    expect((await db.temporalFacts.bulkGet(multi)).every(row => row?.status === 'confirmed')).toBe(true)
    await expect(confirmFactCandidate(otherWork)).rejects.toThrow('当前作品')
  })

  it('同一候选并发重复确认仅提交一次；已确认的重试不改时间戳', async () => {
    const f = await seed(), id = await f.candidate(0, '洛阳')
    const results = await Promise.all([confirmFactCandidate(id), confirmFactCandidate(id)])
    expect(results.filter(row => row.confirmed)).toHaveLength(1)
    expect(results.find(row => !row.confirmed)?.reason).toBe('invalid-status')
    const committed = await db.temporalFacts.get(id)
    expect((await confirmFactCandidate(id)).confirmed).toBe(false)
    expect(await db.temporalFacts.get(id)).toEqual(committed)
  })

  it('确认与否决竞争不能把已确认 Canon 再当候选否决，历史也保持只读', async () => {
    const f = await seed(), id = await f.candidate(0, '洛阳')
    const [confirmation] = await Promise.all([confirmFactCandidate(id), rejectFactCandidate(id)])
    expect((await db.temporalFacts.get(id))?.status).toBe(confirmation.confirmed ? 'confirmed' : 'rejected')
    const historical = await f.candidate(0, '史料', { status: 'superseded', validToChapterId: f.chapters[1] })
    const snapshot = await db.temporalFacts.get(historical)
    await rejectFactCandidate(historical)
    expect(await db.temporalFacts.get(historical)).toEqual(snapshot)
  })

  it('读到候选后它被编辑/否决时，旧确认不能提交新版候选', async () => {
    const f = await seed(), id = await f.candidate(0, '洛阳')
    const get = db.temporalFacts.get.bind(db.temporalFacts)
    vi.spyOn(db.temporalFacts, 'get').mockImplementationOnce(key => get(key).then(async snapshot => {
      await db.temporalFacts.update(id, { value: '北境', status: 'rejected' })
      return snapshot
    }))
    expect((await confirmFactCandidate(id)).confirmed).toBe(false)
    expect(await db.temporalFacts.get(id)).toMatchObject({ value: '北境', status: 'rejected' })
    await db.temporalFacts.update(id, { status: 'candidate' })
    vi.spyOn(db.temporalFacts, 'get').mockImplementationOnce(key => get(key).then(async snapshot => {
      await db.temporalFacts.update(id, { value: '海港' })
      return snapshot
    }))
    expect(await confirmFactCandidate(id)).toMatchObject({ confirmed: false, reason: 'candidate-changed' })
    expect(await db.temporalFacts.get(id)).toMatchObject({ value: '海港', status: 'candidate' })
  })

  it('丢失来源、过期逐字证据和失效/倒置章界均不成为 Canon', async () => {
    const f = await seed()
    const missing = await f.candidate(0, '缺失', { sourceChapterId: 999999 })
    const stale = await f.candidate(0, '过期', { sourceQuote: '正文中已不再存在这句。' })
    const badRange = await f.candidate(2, '倒置', { validToChapterId: f.chapters[1] })
    const missingRange = await f.candidate(0, '未知章', { validFromChapterId: 999999 })
    expect(await confirmFactCandidate(missing)).toMatchObject({ confirmed: false, reason: 'source-missing' })
    expect(await confirmFactCandidate(stale)).toMatchObject({ confirmed: false, reason: 'source-stale' })
    for (const id of [badRange, missingRange]) expect(await confirmFactCandidate(id)).toMatchObject({ confirmed: false, reason: 'invalid-range' })
    expect((await db.temporalFacts.toArray()).some(row => row.status === 'confirmed')).toBe(false)
  })

  it('HTML正文中的合法逐字证据按抽取时同一规范化读取，不因标签和实体误报过期', async () => {
    const f = await seed()
    await db.chapters.update(f.chapters[0], { content: '<p>林飞来到<strong>洛阳</strong> &amp; 海港。</p>' })
    const id = await f.candidate(0, '洛阳', { sourceQuote: '林飞来到洛阳 & 海港。' })
    expect((await confirmFactCandidate(id)).confirmed).toBe(true)
  })

  it('候选写失败时关闭旧区间也整体回滚', async () => {
    const f = await seed()
    const prior = await f.candidate(0, '洛阳', { status: 'confirmed' }), next = await f.candidate(1, '北境')
    const before = await db.temporalFacts.toArray()
    const fail = (_changes: object, key: unknown) => { if (key === next) throw new Error('synthetic fact write failure') }
    db.temporalFacts.hook('updating', fail)
    try { await expect(confirmFactCandidate(next)).rejects.toThrow('synthetic fact write failure') }
    finally { db.temporalFacts.hook('updating').unsubscribe(fail) }
    expect(await db.temporalFacts.toArray()).toEqual(before)
    expect((await db.temporalFacts.get(prior))?.status).toBe('confirmed')
  })

  it('无章界的单值取代保留旧记录，注册上下文仅注入新值', async () => {
    const f = await seed()
    const old = await f.candidate(null, '洛阳'), next = await f.candidate(null, '北境')
    await confirmFactCandidate(old); await confirmFactCandidate(next)
    expect((await db.temporalFacts.get(old))?.status).toBe('superseded')
    expect(await f.context(1)).toContain('北境')
    expect(await f.context(1)).not.toContain('洛阳')
  })

  it('未知截止章界失败关闭；同名但不同稳定角色身份仍各自保留', async () => {
    const f = await seed()
    const bad = await f.candidate(0, '不可投影', { status: 'confirmed', validToChapterId: 999999 })
    expect(await f.context(1)).not.toContain('不可投影')
    const next = await f.candidate(1, '不可覆盖未知区间')
    expect(await confirmFactCandidate(next)).toMatchObject({ confirmed: false, reason: 'invalid-range' })
    await db.temporalFacts.delete(bad)
    const character = async () => db.characters.add(stampNewRecord<Character>(f.scope, 'characters', {
      projectId: f.scope.projectId, name: '林飞', roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral',
      shortDescription: '', appearance: '', personality: '', background: '', motivation: '',
      abilities: '', relationships: '', arc: '', createdAt: 1, updatedAt: 1,
    }, { owner: 'world' }))
    const first = await f.candidate(0, '洛阳', { characterId: await character() })
    const second = await f.candidate(1, '北境', { characterId: await character() })
    expect((await Promise.all([first, second].map(confirmFactCandidate))).every(row => row.confirmed)).toBe(true)
    expect((await db.temporalFacts.bulkGet([first, second])).every(row => row?.status === 'confirmed')).toBe(true)
  })

  it('宪法并发普通确认只能有一方通过；并发明确取代按事务顺序保留一条当前值', async () => {
    const f = await seed()
    const worldviewId = await db.worldviews.add(stampNewRecord(f.scope, 'worldviews', {
      projectId: f.scope.projectId, worldOrigin: '魔法源于月亮潮汐，也有人依赖血脉。', createdAt: 1, updatedAt: 1,
    }, { owner: 'world' }))
    const setting = (value: string) => f.candidate(null, value, {
      predicate: 'magicSource', sourceType: 'setting', sourceRecordTable: 'worldviews', sourceWorldviewId: worldviewId,
      sourceField: 'worldOrigin', sourceFingerprint: fingerprintSettingSource('魔法源于月亮潮汐，也有人依赖血脉。'),
    })
    const first = await setting('月亮潮汐'), second = await setting('血脉')
    const confirmation = await Promise.all([first, second].map(confirmFactCandidate))
    expect(confirmation.filter(row => row.confirmed)).toHaveLength(1)
    expect(confirmation.find(row => !row.confirmed)?.clashes).toHaveLength(1)
    const replacements = [await setting('星光'), await setting('海潮')]
    expect((await Promise.all(replacements.map(replaceConstitutionFactCandidate))).every(row => row.confirmed)).toBe(true)
    const rows = await db.temporalFacts.toArray()
    expect(rows.filter(row => row.status === 'confirmed')).toHaveLength(1)
    const text = await f.context(0)
    expect(text).toContain(rows.find(row => row.status === 'confirmed')!.value)
    for (const old of rows.filter(row => row.status === 'superseded')) expect(text).not.toContain(`：${old.value}`)
    await db.worldviews.update(worldviewId, { worldOrigin: '来源已变。' })
    const pending = confirmation[0].confirmed ? second : first
    expect(await replaceConstitutionFactCandidate(pending)).toMatchObject({ confirmed: false, reason: 'source-stale' })
  })
})
