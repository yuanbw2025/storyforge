import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { CANON_RESOURCE_PROVIDER_V1, canonRowResourceKeysV1 } from '../../src/lib/context-gateway/canon-provider'
import { WORK_AUTHORING_INTENT_PROVIDER_V1, workAuthoringIntentResourceKeyV1 } from '../../src/lib/context-gateway/work-intent-provider'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'

async function seed() {
  const f = await seedCurrentWorkspace('系统文作者意图', { genres: ['urban'] })
  await db.works.update(f.scope.workId, {
    description: '日常签到，与搭档共同经营，不添加惩罚或强敌。',
    customGenre: '轻松经营', writingStyleId: 'luxun', updatedAt: 50,
  })
  const scope = { ...f.scope, worldGroupId: null }
  const metadata = await WORK_AUTHORING_INTENT_PROVIDER_V1.listMetadata({ scope, limit: 10 })
  return { ...f, frozenScope: scope, descriptor: metadata.items[0] }
}

describe('LFQ6 · 登记的作者意图与文风资源', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('普通读取与 Gateway 使用同一 Work 投影，偏好不冒充事实，五项原文可验签', async () => {
    const f = await seed()
    const source = CONTEXT_SOURCE_BY_KEY.get('workAuthoringIntent')!
    expect(source.resources).toBe(WORK_AUTHORING_INTENT_PROVIDER_V1)
    expect(source.ownerFrom).toBe('work')
    const read = await WORK_AUTHORING_INTENT_PROVIDER_V1.read({ scope: f.frozenScope, resourceKey: f.descriptor.resourceKey, depth: 'full', maxTokens: 20_000 })
    expect(await source.read({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null })).toBe(read.content)
    expect(read.content).toContain('轻松经营')
    expect(read.content).toContain('鲁迅式犀利')
    expect(read.content).toContain('不是已发生的故事事实')
    expect(read.content).toContain('不能强制固定情节配比')
    expect(read.contentHash).toBe(await sha256Text(read.content))
    expect(read.sourceRefs.map(ref => ref.field)).toEqual(['title', 'description', 'genres', 'customGenre', 'writingStyleId'])
    for (const ref of read.sourceRefs) {
      expect(ref.table).toBe('works')
      expect(ref.recordId).toBe(f.scope.workId)
      const raw = await WORK_AUTHORING_INTENT_PROVIDER_V1.readOriginal({ scope: f.frozenScope, resourceKey: f.descriptor.resourceKey, sourceRef: ref, maxTokens: 20_000 })
      expect(raw.contentHash).toBe(ref.contentHash)
    }
  })

  it('资源身份由可移植 Work code 决定，改偏好改变内容证据而不改身份', async () => {
    const f = await seed()
    const before = f.descriptor
    const work = (await db.works.get(f.scope.workId))!
    expect(workAuthoringIntentResourceKeyV1(work)).toBe(before.resourceKey)
    expect(workAuthoringIntentResourceKeyV1({ code: work.code })).toBe(before.resourceKey)
    await db.works.update(f.scope.workId, { description: '作者改为安静整理工具，在关灯处停笔。', updatedAt: 51 })
    const after = (await WORK_AUTHORING_INTENT_PROVIDER_V1.listMetadata({ scope: f.frozenScope, limit: 1 })).items[0]
    expect(after.resourceKey).toBe(before.resourceKey)
    expect(after.contentHash).not.toBe(before.contentHash)
    await expect(WORK_AUTHORING_INTENT_PROVIDER_V1.readOriginal({ scope: f.frozenScope, resourceKey: before.resourceKey, sourceRef: before.sourceRefs[1], maxTokens: 20_000 })).rejects.toThrow('已经失效')
  })

  it('跨作品资源或原文、错世界组与错章节不能读取', async () => {
    const f = await seed(); const other = await seedCurrentWorkspace('其它作品')
    await expect(WORK_AUTHORING_INTENT_PROVIDER_V1.read({ scope: { ...other.scope, worldGroupId: null }, resourceKey: f.descriptor.resourceKey, depth: 'full', maxTokens: 20_000 })).rejects.toThrow('越界')
    await expect(WORK_AUTHORING_INTENT_PROVIDER_V1.readOriginal({ scope: { ...other.scope, worldGroupId: null }, resourceKey: workAuthoringIntentResourceKeyV1(other.work), sourceRef: f.descriptor.sourceRefs[0], maxTokens: 20_000 })).rejects.toThrow('越界')
    await expect(WORK_AUTHORING_INTENT_PROVIDER_V1.listMetadata({ scope: { ...f.frozenScope, worldGroupId: 999 }, limit: 1 })).rejects.toThrow('worldGroupId')
    await expect(WORK_AUTHORING_INTENT_PROVIDER_V1.listMetadata({ scope: { ...f.frozenScope, chapterId: 999 }, limit: 1 })).rejects.toThrow('chapterId')
  })

  it('完整资料超过预算明确失败，目录游标和限额不会被默默修正', async () => {
    const f = await seed()
    const probe = await WORK_AUTHORING_INTENT_PROVIDER_V1.read({ scope: f.frozenScope, resourceKey: f.descriptor.resourceKey, depth: 'index', maxTokens: 1 })
    expect(probe.descriptor.contentHash).toBe(f.descriptor.contentHash)
    expect(probe.descriptor.sourceRefs).toEqual(f.descriptor.sourceRefs)
    expect(probe.content).toBe('')
    expect(probe.tokenCount).toBe(0)
    await expect(WORK_AUTHORING_INTENT_PROVIDER_V1.read({ scope: f.frozenScope, resourceKey: f.descriptor.resourceKey, depth: 'full', maxTokens: 1 })).rejects.toThrow('拒绝截断')
    await expect(WORK_AUTHORING_INTENT_PROVIDER_V1.readOriginal({ scope: f.frozenScope, resourceKey: f.descriptor.resourceKey, sourceRef: f.descriptor.sourceRefs[1], maxTokens: 1 })).rejects.toThrow('拒绝截断')
    await expect(WORK_AUTHORING_INTENT_PROVIDER_V1.listMetadata({ scope: f.frozenScope, limit: 0 })).rejects.toThrow('参数无效')
    await expect(WORK_AUTHORING_INTENT_PROVIDER_V1.listMetadata({ scope: f.frozenScope, limit: 1, cursor: 'foreign' })).rejects.toThrow('参数无效')
  })

  it('停用作者文风不进入 Canon 目录、原文或直接读取，原作者数据保留', async () => {
    const f = await seed()
    const id = await db.userStyleProfiles.add(stampNewRecord(f.scope, 'userStyleProfiles', {
      projectId: f.scope.projectId, profile: '【停用画像不可进入请求】', enabled: true,
      sourceChapterIds: '[]', sampleCount: 0, sampleWords: 0, createdAt: 1, updatedAt: 1,
    }, { owner: 'work' }))
    const row = (await db.userStyleProfiles.get(id))!
    const keys = await canonRowResourceKeysV1('userStyleProfiles', row)
    expect(keys.record).toBeTruthy()
    await db.userStyleProfiles.update(id, { enabled: false, updatedAt: 2 })
    expect((await canonRowResourceKeysV1('userStyleProfiles', (await db.userStyleProfiles.get(id))!)).record).toBeNull()
    await expect(CANON_RESOURCE_PROVIDER_V1.read({ scope: f.frozenScope, resourceKey: keys.record!, depth: 'full', maxTokens: 20_000 })).rejects.toThrow()
    const searched = await CANON_RESOURCE_PROVIDER_V1.searchMetadata({ scope: f.frozenScope, query: '停用画像', limit: 100 })
    expect(searched.items.some(item => item.resourceKey.startsWith('user-style:'))).toBe(false)
    expect(await CONTEXT_SOURCE_BY_KEY.get('userStyleProfile')!.read({ projectId: f.scope.projectId, scope: f.scope })).toBe('')
    expect((await db.userStyleProfiles.get(id))!.profile).toBe('【停用画像不可进入请求】')
  })
})
