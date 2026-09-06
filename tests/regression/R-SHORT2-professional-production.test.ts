import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import {
  adoptShortNovelCandidateV1,
  generateShortNovelCandidateV1,
} from '../../src/lib/agent/run/short-novel-durable'
import {
  buildShortNovelManuscriptSnapshotV1,
  ensureShortNovelProductionV1,
  inspectShortNovelCompletionV1,
  publishShortNovelReleaseV1,
  readShortNovelReleaseManifestV1,
  renderShortNovelReleaseMarkdownV1,
  reopenShortNovelProductionV1,
} from '../../src/lib/short-novel/service'
import {
  parseShortNovelBriefV1,
  parseShortNovelReviewV1,
} from '../../src/lib/short-novel/contracts'
import { buildShortNovelPromptV1 } from '../../src/lib/short-novel/prompts'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import type {
  ShortNovelBriefV1,
  ShortNovelChapterDraftV1,
  ShortNovelChapterPlanV1,
  ShortNovelReviewV1,
  ShortNovelStoryDesignV1,
  WorkspaceScope,
} from '../../src/lib/types'

const brief: ShortNovelBriefV1 = {
  version: 1,
  premise: '守灯人必须在风暴夜决定是否熄灭引来亡者的灯。',
  coreChange: '她从替过去守候，变为主动选择仍然活着的人。',
  dominantEmotion: '克制的哀伤逐渐转为清醒',
  pointOfView: 'third-limited',
  tense: 'past',
  audience: '中文幻想短篇读者',
  storyPromise: '灯是否熄灭以及她是否告别亡者必须在结尾兑现。',
  mustKeep: ['风暴夜', '守灯人', '熄灯选择'],
  forbidden: ['梦醒式结局'],
  targetWordCount: 5_000,
  chapterCount: 3,
}

const design: ShortNovelStoryDesignV1 = {
  version: 1,
  protagonist: '守灯人阿遥，因愧疚独守海岬旧灯。',
  desire: '再见溺亡的弟弟一次。',
  pressure: '风暴将船队推向灯火制造的幻礁。',
  escalation: ['亡者开始回应她', '活人船队误把幻灯当作航标', '弟弟请求她不要熄灯'],
  irreversibleTurn: '阿遥发现每次点灯都在让新的船员加入亡者。',
  climaxChoice: '她必须亲手熄灯并失去弟弟最后的回声，或让船队撞礁。',
  endingImage: '黎明里冷却的灯芯旁出现第一束自然天光。',
  aftertaste: '告别不是背叛，而是停止让伤痛继续索取。',
  thematicQuestion: '纪念逝者的界限在哪里。',
}

const plan: ShortNovelChapterPlanV1[] = [
  { stableKey: 'chapter-1', order: 0, title: '逆风的灯', purpose: '建立阿遥、幻灯与逼近船队', viewpoint: '阿遥限知', openingPressure: '风暴提前抵达', conflict: '她既盼弟弟回应又必须纠正航标', turn: '海面传来弟弟声音', exitState: '阿遥决定把灯烧得更亮', targetWordCount: 1_667 },
  { stableKey: 'chapter-2', order: 1, title: '礁石上的名字', purpose: '揭示幻灯以新亡者维持', viewpoint: '阿遥限知', openingPressure: '船队改变航向靠近幻礁', conflict: '弟弟阻止她检查灯室账册', turn: '账册出现昨夜新死者名字', exitState: '阿遥拿起熄灯钳走上塔顶', targetWordCount: 1_667 },
  { stableKey: 'chapter-3', order: 2, title: '天亮以前', purpose: '迫使阿遥作出熄灯选择并兑现承诺', viewpoint: '阿遥限知', openingPressure: '头船即将撞礁', conflict: '弟弟以最后一次相见诱她放弃船队', turn: '阿遥承认自己守的是愧疚而非弟弟', exitState: '灯灭船回航，阿遥迎接自然天光', targetWordCount: 1_666 },
]

const review: ShortNovelReviewV1 = {
  version: 1,
  summary: '主线因果闭合，视角一致，开篇承诺在熄灯选择中兑现。',
  strengths: ['三章压力连续升级', '结尾画面回应开场灯火'],
  issues: [],
}

const reviewWithIssue: ShortNovelReviewV1 = {
  version: 1,
  summary: '主线成立，但第一章的离场决定缺少可见动作。',
  strengths: ['压力建立清楚'],
  issues: [{
    stableKey: 'issue-chapter-1-action', severity: 'major', category: 'causality', chapterKeys: ['chapter-1'],
    evidence: '结尾只有“她决定把灯烧得更亮”', problem: '决定没有通过动作落地，第二章开场会显得跳跃。',
    suggestion: '增加她加油、剪灯芯并锁上灯室门的动作。', status: 'open',
  }],
}

function chapterDraft(chapterKey: string, title: string, marker: string): ShortNovelChapterDraftV1 {
  const paragraph = `${marker}风暴压住海岬，阿遥握紧栏杆，看见灯火在雨幕里一明一灭。她记得自己的选择，也看见远处仍然活着的人。`
  return { version: 1, chapterKey, title, content: Array.from({ length: 36 }, () => paragraph).join('\n') }
}

async function candidateAndAdopt(scope: WorkspaceScope, artifactKind: Parameters<typeof generateShortNovelCandidateV1>[0]['artifactKind'], payload: unknown, options: { chapterKey?: string; issueKey?: string } = {}) {
  const generated = await generateShortNovelCandidateV1({
    scope,
    artifactKind,
    chapterKey: options.chapterKey,
    issueKey: options.issueKey,
    runAI: async () => JSON.stringify(payload),
  })
  expect(generated.snapshot.projection.state).toBe('awaiting_confirmation')
  return adoptShortNovelCandidateV1({ scope, runId: generated.snapshot.run.id, authorPayload: payload as never })
}

describe('R-SHORT2 · 专业短篇独立生产闭环', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('六个阶段使用独立 Skill、闭集 schema 与作者确认写回', async () => {
    const ids = ['short.intent-brief', 'short.story-design', 'short.scene-plan', 'short.chapter-draft', 'short.continuity-review', 'short.targeted-rewrite']
    expect(ids.map(id => getAgentSkillV1(id).executionMode)).toEqual([
      'short-intent-brief', 'short-story-design', 'short-scene-plan', 'short-chapter-draft', 'short-continuity-review', 'short-targeted-rewrite',
    ])
    expect(() => parseShortNovelBriefV1({ ...brief, hiddenInstruction: '越权' })).toThrow('字段不在允许闭集')
    expect(() => parseShortNovelReviewV1({ ...review, issues: [{ stableKey: 'issue-1', severity: 'critical', category: 'causality', chapterKeys: ['chapter-1'], evidence: '无证据', problem: '问题', suggestion: '建议', status: 'resolved' }] })).toThrow('只能以 open 状态')

    const created = await seedCurrentWorkspace('风暴灯', { targetWordCount: 5_000, novelProfile: 'short' })
    const root = await ensureShortNovelProductionV1(created.scope)
    expect(root).toMatchObject({ phase: 'intent', revision: 1, brief: null })
    expect(await db.shortNovelProductions.where('workId').equals(created.scope.workId).count()).toBe(1)
    expect((await buildShortNovelManuscriptSnapshotV1(created.scope)).chapters).toHaveLength(3)

    await candidateAndAdopt(created.scope, 'brief', brief)
    expect(await ensureShortNovelProductionV1(created.scope)).toMatchObject({ phase: 'design', revision: 2, brief })
    await candidateAndAdopt(created.scope, 'story-design', design)
    await candidateAndAdopt(created.scope, 'scene-plan', plan)

    for (const item of plan) {
      await candidateAndAdopt(created.scope, 'chapter-draft', chapterDraft(item.stableKey, item.title, item.stableKey), { chapterKey: item.stableKey })
    }
    expect((await inspectShortNovelCompletionV1(created.scope)).blockers).toContain('当前手稿尚未完成有效的全篇审校')

    await candidateAndAdopt(created.scope, 'continuity-review', reviewWithIssue)
    await candidateAndAdopt(created.scope, 'targeted-rewrite', chapterDraft('chapter-1', '逆风的灯', '她剪短灯芯并锁门'), { chapterKey: 'chapter-1', issueKey: 'issue-chapter-1-action' })
    await candidateAndAdopt(created.scope, 'continuity-review', review)
    const ready = await inspectShortNovelCompletionV1(created.scope)
    expect(ready.ready).toBe(true)
    expect(ready.wordCount).toBeGreaterThanOrEqual(5_000)
    expect(ready.wordCount).toBeLessThanOrEqual(25_000)

    const beforePublish = await ensureShortNovelProductionV1(created.scope)
    const release = await publishShortNovelReleaseV1({ scope: created.scope, expectedRevision: beforePublish.revision })
    const manifest = await readShortNovelReleaseManifestV1(created.scope, release.id)
    const originalJson = release.manifestJson
    expect(manifest.chapters).toHaveLength(3)
    expect(renderShortNovelReleaseMarkdownV1(manifest)).toContain('# 风暴灯')

    const complete = await ensureShortNovelProductionV1(created.scope)
    await reopenShortNovelProductionV1({ scope: created.scope, expectedRevision: complete.revision })
    const reopened = await ensureShortNovelProductionV1(created.scope)
    await candidateAndAdopt(created.scope, 'chapter-draft', chapterDraft('chapter-1', '逆风的灯（修订）', '新版'), { chapterKey: 'chapter-1' })
    expect((await ensureShortNovelProductionV1(created.scope)).revision).toBe(reopened.revision + 1)
    expect((await db.creationReleases.get(release.id))?.manifestJson).toBe(originalJson)
    expect((await readShortNovelReleaseManifestV1(created.scope, release.id)).chapters[0].title).toBe('逆风的灯')
    await candidateAndAdopt(created.scope, 'continuity-review', review)
    const revised = await ensureShortNovelProductionV1(created.scope)
    const secondRelease = await publishShortNovelReleaseV1({ scope: created.scope, expectedRevision: revised.revision })
    expect(secondRelease).toMatchObject({ version: 2, parentReleaseId: release.id })

    const backup = await exportProjectJSON(created.scope.projectId)
    expect(backup.shortNovelProductions).toHaveLength(1)
    expect(backup.creationReleases).toHaveLength(2)
    const importedProjectId = await importProjectJSON(structuredClone(backup))
    const importedReleases = await db.creationReleases.where('projectId').equals(importedProjectId).sortBy('version')
    const importedRelease = importedReleases[0]
    const importedWork = await db.works.where('projectId').equals(importedProjectId).first()
    const importedWorld = await db.worlds.where('projectId').equals(importedProjectId).first()
    expect(importedReleases).toHaveLength(2)
    expect(importedReleases[1].parentReleaseId).toBe(importedReleases[0].id)
    expect((await db.shortNovelProductions.where('projectId').equals(importedProjectId).first())?.currentReleaseId).toBe(importedReleases[1].id)
    expect(await readShortNovelReleaseManifestV1({ projectId: importedProjectId, worldId: importedWorld!.id!, workId: importedWork!.id! }, importedRelease!.id!)).toMatchObject({ manuscriptHash: manifest.manuscriptHash })
  })

  it('把数字类型与英文枚举写入 provider 可执行协议，不依赖模型自行猜测合同', () => {
    const [system, objective] = buildShortNovelPromptV1({
      kind: 'brief',
      context: '目标字数：5000\n章节数：3',
      authorInstruction: '',
    })
    expect(system.content).toContain('version 的字段必须使用 JSON 数字 1')
    expect(system.content).toContain('英文枚举标识必须逐字照抄')
    expect(objective.content).toContain('first-person、third-limited、third-omniscient')
    expect(objective.content).toContain('past、present')
    expect(objective.content).toContain('targetWordCount 和 chapterCount 必须是 JSON 数字')
  })

  it('手稿变化后拒绝 stale 候选，且不能跨 Work 采纳', async () => {
    const first = await seedCurrentWorkspace('第一篇', { targetWordCount: 5_000, novelProfile: 'short' })
    const generated = await generateShortNovelCandidateV1({ scope: first.scope, artifactKind: 'brief', runAI: async () => JSON.stringify(brief) })
    await db.works.update(first.scope.workId, { description: '作者已修改故事前提', updatedAt: Date.now() })
    await expect(adoptShortNovelCandidateV1({ scope: first.scope, runId: generated.snapshot.run.id })).rejects.toThrow('手稿已变化')
    expect((await ensureShortNovelProductionV1(first.scope)).brief).toBeNull()

    const second = await seedCurrentWorkspace('第二篇', { targetWordCount: 5_000, novelProfile: 'short' })
    await expect(adoptShortNovelCandidateV1({ scope: second.scope, runId: generated.snapshot.run.id })).rejects.toThrow()
    expect((await ensureShortNovelProductionV1(second.scope)).brief).toBeNull()
  })

  it('导入前验证冻结发布 hash，损坏备份不会产生半个项目', async () => {
    const created = await seedCurrentWorkspace('损坏发布样例', { targetWordCount: 5_000, novelProfile: 'short' })
    const backup = await exportProjectJSON(created.scope.projectId)
    backup.creationReleases.push({
      _exportId: 0,
      _worldExportId: 0,
      _workExportId: 0,
      _parentExportId: null,
      productKind: 'short-novel',
      version: 1,
      label: '伪造发布',
      sourceRevision: 1,
      manifestJson: JSON.stringify({ schema: 'storyforge.short-novel-release', version: 1, productKind: 'short-novel', work: { code: backup.works[0].code } }),
      contentHash: '0'.repeat(64),
      createdAt: 1,
    })
    const before = await db.projects.count()
    await expect(importProjectJSON(backup)).rejects.toThrow('manifest 身份或 hash 校验失败')
    expect(await db.projects.count()).toBe(before)
  })
})
