import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { createAdaptation, listActiveSourceUnits } from '../../src/lib/adaptation/source-manifest'
import { reopenAdaptationProductionV1 } from '../../src/lib/adaptation/completion'
import { db } from '../../src/lib/db/schema'
import type { AdaptationBriefV1, ChatMessage, ScreenplayTargetSpecV1, WorkspaceScope } from '../../src/lib/types'
import {
  adoptScreenplayProfessionalCandidateV1,
  generateScreenplayProfessionalCandidateV1,
  parseScreenplayProfessionalPayloadV1,
  type ScreenplayProfessionalPayloadV1,
  type ScreenplayProfessionalStageV1,
} from '../../src/lib/screenplay/durable-production'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import {
  inspectScreenplayCompletionV1,
  startScreenplayProductionV1,
  updateScreenplayReviewIssueStatusV1,
} from '../../src/lib/screenplay/production'
import { updateScreenplayScene } from '../../src/lib/screenplay/service'
import {
  listScreenplayReleasesV1,
  publishScreenplayReleaseV1,
  readScreenplayReleaseManifestV1,
} from '../../src/lib/screenplay/release'
import {
  parseStoryForgeFdxV1,
  parseStoryForgeFountainV1,
  renderScreenplayFdxV1,
  renderScreenplayFountainV1,
  screenplayRenderDocumentFromReleaseV1,
} from '../../src/lib/screenplay/renderers'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import { stampNewRecord } from '../../src/lib/workspace/scope'

const targetSpec: ScreenplayTargetSpecV1 = {
  format: 'film', language: 'zh-CN', episodeCount: null, targetMinutesPerEpisode: 2,
  rating: 'PG-13', dialogueDensity: 'balanced', productionScale: 'contained', preserveVoiceOver: false,
  titlePage: { creditLine: '改编', authorDisplayName: '测试作者', contactText: '', copyrightNotice: '测试版权', draftLabel: '专业流程稿' },
  exportDefaults: ['fountain', 'fdx', 'pdf'],
}

const brief: AdaptationBriefV1 = {
  version: 1, coreTheme: '选择需要付出代价', dominantEmotion: '克制与紧迫', mustKeep: ['主角最后停下'],
  mayCut: ['说明性旁白'], mayMerge: [], mayReorder: [], allowedAdditions: ['用车站广播外化时间压力'],
  audience: '成年观众', rating: 'PG-13', targetScale: '两分钟电影短片', narrativePerspective: '跟随林岚',
  timeBudget: '两分钟', costLimit: '单一车站场景', deviationNotes: '不改变最终选择', unresolvedQuestions: [], assumptions: [],
}

async function fixture() {
  const source = await createWorkspace({
    name: '专业剧本来源', genres: ['drama'], status: 'drafting', description: '林岚在末班车前作出选择。',
    targetWordCount: 5_000, enableMultiWorld: false,
  }, { kind: 'novel', novelProfile: 'short' })
  const chapters = await db.chapters.where('projectId').equals(source.scope.projectId).sortBy('order')
  await db.chapters.update(chapters[0].id!, {
    content: '<p>雨夜，林岚赶到旧车站。广播催促末班车，她在车门前停下，没有登车。</p>',
    summary: '林岚在末班车前停下', updatedAt: Date.now(),
  })
  const created = await createAdaptation({
    sourceScope: source.scope, sourceWorkId: source.scope.workId, title: '没有登上的末班车',
    sourceSelection: { mode: 'entire-work' }, medium: 'screenplay', targetSpec,
  })
  const unit = (await listActiveSourceUnits(created.adaptation.id!)).find(row => row.sourceKind === 'chapter')!
  return { ...created, source, unit }
}

async function runStage(input: {
  scope: WorkspaceScope
  adaptationProjectId: number
  stage: ScreenplayProfessionalStageV1
  payload: ScreenplayProfessionalPayloadV1
  sourceUnitKeys?: string[]
  targetSceneKeys?: string[]
  targetIssueKeys?: string[]
  prompts: Map<string, string>
}) {
  const generated = await generateScreenplayProfessionalCandidateV1({
    scope: input.scope, adaptationProjectId: input.adaptationProjectId, stage: input.stage,
    sourceUnitKeys: input.sourceUnitKeys, targetSceneKeys: input.targetSceneKeys, targetIssueKeys: input.targetIssueKeys,
    runAI: async (messages: ChatMessage[]) => {
      input.prompts.set(input.stage, messages.map(message => message.content).join('\n'))
      return JSON.stringify(input.payload)
    },
  })
  expect(generated.snapshot.projection.state).toBe('awaiting_confirmation')
  const adopted = await adoptScreenplayProfessionalCandidateV1({ scope: input.scope, runId: generated.snapshot.run.id })
  expect(adopted.snapshot.projection.state).toBe('completed')
  expect(adopted.receiptHash).toMatch(/^[a-f0-9]{64}$/)
  return adopted
}

describe('SCREEN-2 · professional novel-to-screenplay pipeline', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('十个职业 Skill 各自绑定阶段、上下文和正式写入边界', () => {
    const ids = [
      'adaptation.source-analysis', 'adaptation.causal-graph', 'screenplay.adaptation-brief', 'screenplay.decision-pass',
      'screenplay.beat-sheet', 'screenplay.scene-card', 'screenplay.scene-draft', 'screenplay.grounding-review',
      'screenplay.dramaturgy-review', 'screenplay.targeted-rewrite',
    ] as const
    for (const id of ids) {
      const skill = getAgentSkillV1(id)
      expect(skill.version).toBe(1)
      expect(skill.contextSourceKeys).toContain('adaptation.sourceContent')
      expect(skill.writeTargets.length).toBeGreaterThan(0)
      expect(skill.promptVersion).toMatch(/screenplay|adaptation/)
    }
    expect(() => parseScreenplayProfessionalPayloadV1('scene-card', [{ stableKey: 'card.bad', systemId: 1 }] as never)).toThrow('字段不在闭集')
  })

  it('来源事实提示明确闭集形状和 kind 枚举，避免兼容模型返回近义字段', async () => {
    const item = await fixture()
    let systemPrompt = ''
    await generateScreenplayProfessionalCandidateV1({
      scope: item.scope,
      adaptationProjectId: item.adaptation.id!,
      stage: 'source-analysis',
      sourceUnitKeys: [item.unit.sourceUnitKey],
      runAI: async messages => {
        systemPrompt = messages.map(message => message.content).join('\n')
        return JSON.stringify([{ stableKey: 'fact.arrival', kind: 'event', statement: '林岚赶到旧车站。', subjectKeys: ['character.linlan'], sourceUnitKeys: [item.unit.sourceUnitKey], confidence: 1 }])
      },
    })
    expect(systemPrompt).toContain('kind 只能是 event、character-state、relationship、location、object、motif 之一')
    expect(systemPrompt).toContain('不得增加 evidence、quote、reasoning、category、id 等字段')
    expect(systemPrompt).toContain('{"stableKey":"fact.key","kind":"event"')
    expect(systemPrompt).toContain('stableKey 必须匹配 ^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$')
    expect(systemPrompt).toContain('数组内每个 stableKey 必须唯一')
    expect(systemPrompt).toContain('场景 blocks 内每个 id 也必须唯一')
  })

  it('领域事务提交后事件写入中断可以恢复，且不会重复采纳', async () => {
    const item = await fixture()
    const payload = [
      { stableKey: 'fact.arrival', kind: 'event' as const, statement: '林岚赶到旧车站。', subjectKeys: ['character.linlan'], sourceUnitKeys: [item.unit.sourceUnitKey], confidence: 1 },
      { stableKey: 'fact.choice', kind: 'event' as const, statement: '林岚没有登车。', subjectKeys: ['character.linlan'], sourceUnitKeys: [item.unit.sourceUnitKey], confidence: 1 },
    ]
    const generated = await generateScreenplayProfessionalCandidateV1({
      scope: item.scope, adaptationProjectId: item.adaptation.id!, stage: 'source-analysis', sourceUnitKeys: [item.unit.sourceUnitKey],
      runAI: async () => JSON.stringify(payload),
    })
    await expect(adoptScreenplayProfessionalCandidateV1({
      scope: item.scope, runId: generated.snapshot.run.id,
      onDurableBoundary: boundary => { if (boundary === 'formal.written') throw new Error('模拟事件账本写入前掉电') },
    })).rejects.toThrow('模拟事件账本写入前掉电')
    expect(await db.adaptationSourceFacts.where('adaptationProjectId').equals(item.adaptation.id!).count()).toBe(2)
    expect((await db.adaptationProjects.get(item.adaptation.id!))?.revision).toBe(2)
    const resumed = await adoptScreenplayProfessionalCandidateV1({ scope: item.scope, runId: generated.snapshot.run.id })
    expect(resumed.snapshot.projection.state).toBe('completed')
    expect(await db.adaptationSourceFacts.where('adaptationProjectId').equals(item.adaptation.id!).count()).toBe(2)
    expect((await db.adaptationProjects.get(item.adaptation.id!))?.revision).toBe(2)
  })

  it('100K+ 来源按选定单元渐进读取，不把整部小说塞进单次 Prompt', async () => {
    const source = await createWorkspace({
      name: '长来源剧本验证', genres: ['drama'], status: 'drafting', description: '四章长来源。',
      targetWordCount: 200_000, enableMultiWorld: false,
    }, { kind: 'novel', novelProfile: 'long' })
    const now = Date.now()
    const volumeId = await db.outlineNodes.add(stampNewRecord(source.scope, 'outlineNodes', {
      projectId: source.scope.projectId, parentId: null, type: 'volume', title: '第一卷', summary: '四个阶段逐步逼近最终选择。', order: 0, createdAt: now, updatedAt: now,
    }, { owner: 'work' })) as number
    for (let index = 0; index < 4; index += 1) {
      const outlineNodeId = await db.outlineNodes.add(stampNewRecord(source.scope, 'outlineNodes', {
        projectId: source.scope.projectId, parentId: volumeId, type: 'chapter', title: `第${index + 1}章`, summary: `阶段 ${index + 1}`, order: index, createdAt: now, updatedAt: now,
      }, { owner: 'work' })) as number
      const marker = index === 0 ? 'FIRST-UNIT-ONLY' : index === 3 ? 'LAST-UNIT-ONLY' : `MIDDLE-${index}`
      const content = `<p>${'潮声逼近，人物必须行动。'.repeat(1_500)}${marker}${'潮声逼近，人物必须行动。'.repeat(1_500)}</p>`
      await db.chapters.add(stampNewRecord(source.scope, 'chapters', {
        projectId: source.scope.projectId, outlineNodeId, title: `第${index + 1}章`, content, wordCount: content.length,
        status: 'draft', order: index, notes: '', createdAt: now, updatedAt: now,
      }, { owner: 'work' }))
    }
    const created = await createAdaptation({
      sourceScope: source.scope, sourceWorkId: source.scope.workId, title: '长来源剧本', sourceSelection: { mode: 'entire-work' }, medium: 'screenplay', targetSpec,
    })
    const units = (await listActiveSourceUnits(created.adaptation.id!)).filter(unit => unit.sourceKind === 'chapter')
    expect(units.reduce((sum, unit) => sum + unit.wordCount, 0)).toBeGreaterThan(100_000)
    let promptText = ''
    const selected = units[units.length - 1]
    const generated = await generateScreenplayProfessionalCandidateV1({
      scope: created.scope, adaptationProjectId: created.adaptation.id!, stage: 'source-analysis', sourceUnitKeys: [selected.sourceUnitKey],
      runAI: async messages => {
        promptText = messages.map(message => message.content).join('\n')
        return JSON.stringify([{ stableKey: 'fact.last-unit', kind: 'event', statement: '最后一章中潮声逼近，人物必须行动。', subjectKeys: ['character.protagonist'], sourceUnitKeys: [selected.sourceUnitKey], confidence: 1 }])
      },
    })
    expect(generated.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(promptText).toContain('LAST-UNIT-ONLY')
    expect(promptText).not.toContain('FIRST-UNIT-ONLY')
    expect(promptText.length).toBeLessThan(80_000)
  })

  it('从来源事实逐步生成、审查、定点修订、发布并完成备份往返', async () => {
    const item = await fixture()
    const prompts = new Map<string, string>()
    const common = { scope: item.scope, adaptationProjectId: item.adaptation.id!, prompts }
    const unitKey = item.unit.sourceUnitKey

    await runStage({ ...common, stage: 'source-analysis', sourceUnitKeys: [unitKey], payload: [
      { stableKey: 'fact.arrival', kind: 'event', statement: '雨夜，林岚赶到旧车站。', subjectKeys: ['character.linlan'], sourceUnitKeys: [unitKey], confidence: 1 },
      { stableKey: 'fact.choice', kind: 'event', statement: '林岚在车门前停下，没有登车。', subjectKeys: ['character.linlan'], sourceUnitKeys: [unitKey], confidence: 1 },
    ] })
    await runStage({ ...common, stage: 'causal-graph', payload: [
      { stableKey: 'edge.arrival-choice', fromFactKey: 'fact.arrival', toFactKey: 'fact.choice', relation: 'enables', rationale: '到达车站使登车选择发生。', sourceUnitKeys: [unitKey] },
    ] })
    await runStage({ ...common, stage: 'adaptation-brief', payload: brief })
    await runStage({ ...common, stage: 'decision-pass', payload: [
      { stableKey: 'decision.externalize-clock', action: 'externalize', sourceFactKeys: ['fact.arrival', 'fact.choice'], targetKeys: ['beat.choice'], rationale: '用广播和车门动作把时限与选择外化。' },
    ] })
    await runStage({ ...common, stage: 'beat-sheet', payload: [
      { stableKey: 'beat.choice', sectionKey: 'act-one', sectionTitle: '唯一段落', scope: 'act', episodeNumber: 1, order: 0, objective: '林岚必须决定是否登车。', conflict: '广播倒计时逼迫她行动。', turn: '她伸手后又停下。', outcome: '列车离站，她留在站台。', causalFactKeys: ['fact.arrival', 'fact.choice'], decisionKeys: ['decision.externalize-clock'], sourceUnitKeys: [unitKey], estimatedSeconds: 120 },
    ] })
    await runStage({ ...common, stage: 'scene-card', payload: [
      { stableKey: 'scene.choice', beatKey: 'beat.choice', episodeNumber: 1, sceneNumber: 1, order: 0, purpose: '把是否登车变成可见选择。', conflict: '末班车即将关门。', entryState: '林岚冲入站台。', exitState: '林岚留在空站台。', visibleAction: '林岚伸手挡门，最终收回手。', informationReveal: '她主动选择留下。', sourceUnitKeys: [unitKey], estimatedSeconds: 120 },
    ] })

    let root = (await db.adaptationProjects.get(item.adaptation.id!))!
    await startScreenplayProductionV1({ scope: item.scope, expectedAdaptationRevision: root.revision })
    await runStage({ ...common, stage: 'scene-draft', targetSceneKeys: ['scene.choice'], payload: {
      stableKey: 'scene.choice', planSectionKey: 'act-one', episodeNumber: 1, sceneNumber: 1, intExt: 'EXT',
      location: '旧车站站台', timeOfDay: '雨夜', summary: '林岚冲向末班车并作出选择。', estimatedSeconds: 120,
      sourceUnitKeys: [unitKey], blocks: [
        { id: 'block.clock', type: 'action', text: '广播倒数。林岚冲到车门前，径直跨上列车。' },
      ],
    } })
    await runStage({ ...common, stage: 'grounding-review', targetSceneKeys: ['scene.choice'], payload: [
      { stableKey: 'issue.boarding', category: 'grounding', severity: 'major', sceneKey: 'scene.choice', blockId: 'block.clock', evidence: '原文写她在车门前停下，没有登车。', problem: '场景把结局改成登车，违背已确认事实。', suggestion: '改为她伸手后收回，并留在站台。', sourceUnitKeys: [unitKey] },
    ] })
    await runStage({ ...common, stage: 'targeted-rewrite', targetSceneKeys: ['scene.choice'], targetIssueKeys: ['issue.boarding'], payload: {
      sceneKey: 'scene.choice', expectedSceneRevision: 1, issueKeys: ['issue.boarding'], summary: '林岚在末班车前选择留下。',
      blocks: [{ id: 'block.clock', type: 'action', text: '广播倒数。林岚伸手挡住车门，又慢慢收回手。车门在她面前合拢。' }],
    } })
    await runStage({ ...common, stage: 'grounding-review', targetSceneKeys: ['scene.choice'], payload: [] })
    await runStage({ ...common, stage: 'dramaturgy-review', targetSceneKeys: ['scene.choice'], payload: [
      { stableKey: 'issue.pause', category: 'dramaturgy', severity: 'minor', sceneKey: 'scene.choice', blockId: 'block.clock', evidence: '动作集中在一个长句中。', problem: '决定瞬间可以留出更清晰的节奏停顿。', suggestion: '后续表演排练时强化停顿。', sourceUnitKeys: [] },
    ] })
    const minor = await db.screenplayReviewIssues.where('adaptationProjectId').equals(item.adaptation.id!).filter(issue => issue.stableKey === 'issue.pause').first()
    await updateScreenplayReviewIssueStatusV1({ scope: item.scope, issueId: minor!.id!, status: 'dismissed' })
    let scene = (await db.screenplayScenes.where('adaptationProjectId').equals(item.adaptation.id!).first())!
    scene = await updateScreenplayScene({ scope: item.scope, sceneId: scene.id!, expectedRevision: scene.revision, patch: { status: 'reviewed' } })
    expect(scene).toMatchObject({ groundingReviewRevision: scene.revision, dramaturgyReviewRevision: scene.revision })

    const completion = await inspectScreenplayCompletionV1(item.scope)
    expect(completion).toMatchObject({ ready: true, blockers: [], totalEstimatedSeconds: 120, targetEstimatedSeconds: 120 })
    root = (await db.adaptationProjects.get(item.adaptation.id!))!
    const release1 = await publishScreenplayReleaseV1({ scope: item.scope, expectedAdaptationRevision: root.revision })
    const manifest1 = await readScreenplayReleaseManifestV1(item.scope, release1.id)
    expect(manifest1).toMatchObject({ productKind: 'screenplay', scenes: [{ stableKey: 'scene.choice', status: 'reviewed' }] })
    expect(manifest1.reviewIssues.map(issue => [issue.stableKey, issue.status])).toEqual(expect.arrayContaining([['issue.boarding', 'resolved'], ['issue.pause', 'dismissed']]))
    const document1 = screenplayRenderDocumentFromReleaseV1(manifest1)
    const fountain = renderScreenplayFountainV1(document1)
    const fdx = renderScreenplayFdxV1(document1)
    expect(parseStoryForgeFountainV1(fountain).headings).toEqual(['EXT. 旧车站站台 - 雨夜'])
    expect(parseStoryForgeFdxV1(fdx).headings).toEqual(['EXT. 旧车站站台 - 雨夜'])

    const reopened = await reopenAdaptationProductionV1({ scope: item.scope, expectedRevision: (await db.adaptationProjects.get(item.adaptation.id!))!.revision })
    scene = await updateScreenplayScene({ scope: item.scope, sceneId: scene.id!, expectedRevision: scene.revision, patch: { summary: '第二版：林岚留下。' } })
    expect((await inspectScreenplayCompletionV1(item.scope)).ready).toBe(false)
    await runStage({ ...common, stage: 'grounding-review', targetSceneKeys: ['scene.choice'], payload: [] })
    await runStage({ ...common, stage: 'dramaturgy-review', targetSceneKeys: ['scene.choice'], payload: [] })
    scene = (await db.screenplayScenes.get(scene.id!))!
    await updateScreenplayScene({ scope: item.scope, sceneId: scene.id!, expectedRevision: scene.revision, patch: { status: 'reviewed' } })
    const release2 = await publishScreenplayReleaseV1({ scope: item.scope, expectedAdaptationRevision: (await db.adaptationProjects.get(item.adaptation.id!))!.revision })
    expect(reopened.status).toBe('review')
    expect(release2).toMatchObject({ version: 2, parentReleaseId: release1.id })
    expect((await readScreenplayReleaseManifestV1(item.scope, release1.id)).scenes[0].summary).toBe('林岚在末班车前选择留下。')
    expect((await readScreenplayReleaseManifestV1(item.scope, release2.id)).scenes[0].summary).toContain('第二版')

    expect(new Set(prompts.values()).size).toBe(10)
    expect(prompts.get('adaptation-brief')).toContain('version 必须是 JSON 数字 1，不是字符串')
    expect(prompts.get('adaptation-brief')).toContain('mustKeep、mayCut、mayMerge、mayReorder、allowedAdditions、unresolvedQuestions、assumptions 必须是字符串数组')
    expect(prompts.get('decision-pass')).toContain('sourceFactKeys 与 targetKeys 必须始终是无重复的字符串数组')
    expect(prompts.get('decision-pass')).toContain('4～8 项高价值改编决定')
    expect(prompts.get('beat-sheet')).toContain('scope 只能是 act、sequence、episode')
    expect(prompts.get('scene-card')).toContain('不得增加 heading、location、characters、shots、id 等字段')
    expect(prompts.get('scene-draft')).toContain('每个 dialogue 前必须先有 character')
    expect(prompts.get('grounding-review')).toContain('来源忠实度与连续性审查')
    expect(prompts.get('grounding-review')).toContain('blockId 必须是目标场景已有 block id 或 null')
    expect(prompts.get('dramaturgy-review')).toContain('sourceUnitKeys 必须是数组且允许 []')
    expect(prompts.get('targeted-rewrite')).toContain('只修复作者选中的开放问题')
    expect(prompts.get('targeted-rewrite')).toContain('blocks 必须给出修订后的整场合法 AST')
    expect(prompts.get('targeted-rewrite')).toContain('expectedSceneRevision 必须是大于 0 的 JSON 整数')

    const backup = await exportProjectJSON(item.source.scope.projectId)
    expect(backup).toMatchObject({ version: 14 })
    expect(backup.screenplayBeats).toHaveLength(1)
    expect(backup.screenplaySceneCards).toHaveLength(1)
    expect(backup.screenplayReviewIssues.length).toBeGreaterThanOrEqual(2)
    const importedProjectId = await importProjectJSON(structuredClone(backup))
    expect(await db.screenplayBeats.where('projectId').equals(importedProjectId).count()).toBe(1)
    expect(await db.screenplaySceneCards.where('projectId').equals(importedProjectId).count()).toBe(1)
    expect(await db.creationReleases.where('projectId').equals(importedProjectId).filter(release => release.productKind === 'screenplay').count()).toBe(2)

    await deleteWork(item.scope.workId)
    expect(await db.screenplayBeats.where('adaptationProjectId').equals(item.adaptation.id!).count()).toBe(0)
    expect(await db.screenplaySceneCards.where('adaptationProjectId').equals(item.adaptation.id!).count()).toBe(0)
    expect(await db.screenplayReviewIssues.where('adaptationProjectId').equals(item.adaptation.id!).count()).toBe(0)
    await expect(listScreenplayReleasesV1(item.scope)).rejects.toThrow()
  })
})
