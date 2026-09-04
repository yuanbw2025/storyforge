import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  abandonStyleLearningRunV1,
  adoptStyleLearningCandidateV1,
  generateStyleLearningCandidateV1,
  readPendingStyleLearningCandidateV1,
  readRecoverableStyleLearningRunV1,
  rejectStyleLearningCandidateV1,
  type StyleLearningAdoptionBoundaryV1,
  type StyleLearningBoundaryV1,
} from '../../src/lib/agent/run/style-learning-durable'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { FIELD_BY_TARGET } from '../../src/lib/registry/field-registry'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { parseStyleLearningResultStrictV1 } from '../../src/lib/style/learning-agent'
import type { WorkspaceScope } from '../../src/lib/types'
import { generateWorkCode } from '../../src/lib/memory/identity'
import { stampCurrentFixtureResourceUidsV1 } from '../helpers/current-resource-identity'
import { currentWorkFixtureRecordV1, seedCurrentWorkspace } from '../helpers/current-workspace'

async function seed(suffix = '', withProfile = true) {
  const now = Date.now()
  const created = await seedCurrentWorkspace(`纸灯小说${suffix}`)
  const { projectId, worldId, workId } = created.scope
  const chapterId = await db.chapters.add({
    projectId, worldId, workId, title: '雨落纸灯', order: 1, status: 'polished',
    content: '<p>雨落下来。灯没有灭。阿棠把伞收在门外，只带进一身潮湿。</p><p>她不解释。旧钟又响了一次。</p>',
    summary: '', wordCount: 36, createdAt: now, updatedAt: now,
  } as any) as number
  let profileId: number | null = null
  if (withProfile) {
    profileId = await db.userStyleProfiles.add({
      projectId, worldId, workId, profile: '作者旧画像', enabled: false,
      sourceChapterIds: '[]', sampleCount: 0, sampleWords: 0,
      revisionPairs: JSON.stringify([{
        id: 'pair-1', chapterTitle: '第一章', beforeText: '雨很大，她很害怕。',
        afterText: '雨压低屋檐。她没有回头。', authorNote: '少解释情绪。', capturedAt: now,
      }]),
      calibrationFeedback: JSON.stringify([{
        id: 'feedback-1', verdict: 'closer', note: '短句方向对。',
        sourceExcerpt: '原句', resultExcerpt: '改句', createdAt: now,
      }]),
      createdAt: now, updatedAt: now,
    } as any) as number
  }
  await stampCurrentFixtureResourceUidsV1(projectId)
  return {
    scope: { projectId, worldId, workId } satisfies WorkspaceScope,
    projectId, worldId, workId, chapterId, profileId,
  }
}

function styleResult(tag = '克制') {
  return `## 用词习惯
- ${tag}，偏好具体名词和轻动作动词，少用抽象评价。

## 句式与节奏
- 短句为骨架，关键动作后单独断句，段落控制在两到三句。

## 对话风格
- 对话稀疏，常用动作承接，不直接解释人物情绪。

## 描写与画面
- 以雨、灯、钟声等感官细节承载氛围，但不得照搬样本实体。

## 标志性表达
- 转折处常以一个克制动作收束，不追加总结句。

## 倾向与禁忌
- 保持冷静留白；避免连续形容词、情绪直说和全知式解释。`
}

describe.sequential('R-HARNESS76 · 文风学习 durable 候选与校准风险裁决', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })

  it('三注册表闭合，登记样本/改稿/反馈进入一次模型调用，确认前画像零写入', async () => {
    expect(CONTEXT_SOURCE_BY_KEY.get('styleLearningBaseline')).toMatchObject({ ownerFrom: 'work', protectedFromTrim: true })
    expect(PROJECT_TABLES.find(item => item.name === 'userStyleProfiles')).toMatchObject({ exportable: true })
    expect(FIELD_BY_TARGET.get('userStyleProfiles')?.map(field => field.field)).toEqual([
      'profile', 'enabled', 'sourceChapterIds', 'sampleCount', 'sampleWords',
    ])
    expect(getAgentSkillV1('prose.style-learn')).toMatchObject({ agentId: 'prose', executionMode: 'style-learn' })
    const fixture = await seed()
    const before = await db.userStyleProfiles.get(fixture.profileId!)
    let calls = 0
    const generated = await generateStyleLearningCandidateV1({
      scope: fixture.scope,
      chapterIds: [fixture.chapterId],
      runAI: async messages => {
        calls++
        const prompt = messages.map(message => message.content).join('\n')
        expect(prompt).toContain('雨落下来。灯没有灭。')
        expect(prompt).toContain('少解释情绪。')
        expect(prompt).toContain('短句方向对。')
        expect(prompt).toContain('HARNESS-76 严格输出协议')
        expect(prompt.split('【文风学习正式输入基线】')).toHaveLength(2)
        return styleResult()
      },
    })
    expect(calls).toBe(1)
    expect(generated.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(await db.userStyleProfiles.get(fixture.profileId!)).toEqual(before)

    const source = readFileSync('src/components/style/StyleLearningPanel.tsx', 'utf8')
    expect(source).not.toContain('chat(')
    expect(source).not.toContain('saveProfile(')
    expect(source).not.toContain('assembleContext(')
    expect(source).toContain('useStyleLearningAI')
    expect(readFileSync('src/components/style/useStyleLearningAI.ts', 'utf8')).toContain('generateStyleLearningCandidateV1')
  })

  it('严格六节协议拒绝围栏、重复/缺失/乱序标题和过短输出', () => {
    expect(parseStyleLearningResultStrictV1(styleResult())).toBe(styleResult())
    expect(() => parseStyleLearningResultStrictV1(`\`\`\`md\n${styleResult()}\n\`\`\``)).toThrow('代码围栏')
    expect(() => parseStyleLearningResultStrictV1('只有一句风格说明')).toThrow('过短')
    expect(() => parseStyleLearningResultStrictV1(styleResult().replace('## 对话风格', '## 用词习惯'))).toThrow('重复')
    const reordered = styleResult().replace('## 用词习惯', '## 临时').replace('## 句式与节奏', '## 用词习惯').replace('## 临时', '## 句式与节奏')
    expect(() => parseStyleLearningResultStrictV1(reordered)).toThrow('打乱')
  })

  it('模型未知窗口不自动重试；候选 checkpoint 后可恢复且不重复调用模型', async () => {
    for (const boundary of ['model.requested', 'model.responded'] satisfies StyleLearningBoundaryV1[]) {
      const fixture = await seed(boundary)
      let calls = 0
      await expect(generateStyleLearningCandidateV1({
        scope: fixture.scope,
        chapterIds: [fixture.chapterId],
        runAI: async () => { calls++; return styleResult(boundary) },
        onDurableBoundary: current => { if (current === boundary) throw new Error(`interrupt:${boundary}`) },
      })).rejects.toThrow(`interrupt:${boundary}`)
      expect(calls).toBe(boundary === 'model.requested' ? 0 : 1)
      expect((await readRecoverableStyleLearningRunV1({ scope: fixture.scope }))?.safeToResume).toBe(false)
    }

    const fixture = await seed('checkpoint')
    let calls = 0
    await expect(generateStyleLearningCandidateV1({
      scope: fixture.scope,
      chapterIds: [fixture.chapterId],
      runAI: async () => { calls++; return styleResult('恢复') },
      onDurableBoundary: boundary => { if (boundary === 'candidate.checkpoint') throw new Error('interrupt:checkpoint') },
    })).rejects.toThrow('interrupt:checkpoint')
    const pending = await readPendingStyleLearningCandidateV1({ scope: fixture.scope })
    expect(pending?.candidate.result).toBe(styleResult('恢复'))
    expect(calls).toBe(1)
  })

  it('作者确认后经注册表写五个字段并保留显式样本/反馈/关闭选择；首次画像默认开启', async () => {
    const existing = await seed('existing')
    const before = await db.userStyleProfiles.get(existing.profileId!)
    const generated = await generateStyleLearningCandidateV1({
      scope: existing.scope, chapterIds: [existing.chapterId], runAI: async () => styleResult('已有'),
    })
    const accepted = await adoptStyleLearningCandidateV1({ scope: existing.scope, runId: generated.snapshot.run.id })
    expect(accepted.snapshot.projection.state).toBe('completed')
    expect(await db.userStyleProfiles.get(existing.profileId!)).toMatchObject({
      profile: styleResult('已有'), enabled: false, sourceChapterIds: JSON.stringify([existing.chapterId]),
      sampleCount: 1, revisionPairs: before?.revisionPairs, calibrationFeedback: before?.calibrationFeedback,
    })

    const first = await seed('first', false)
    const firstRun = await generateStyleLearningCandidateV1({
      scope: first.scope, chapterIds: [first.chapterId], runAI: async () => styleResult('首次'),
    })
    await adoptStyleLearningCandidateV1({ scope: first.scope, runId: firstRun.snapshot.run.id })
    expect((await db.userStyleProfiles.where('projectId').equals(first.projectId).first())).toMatchObject({
      profile: styleResult('首次'), enabled: true, sourceChapterIds: JSON.stringify([first.chapterId]), sampleCount: 1,
    })
  })

  it.each([
    ['章节正文', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      await db.chapters.update(fixture.chapterId, { content: '<p>作者重新改写了用于学习的开头。</p>' })
    }],
    ['章节状态', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      await db.chapters.update(fixture.chapterId, { status: 'draft' })
    }],
    ['改稿样本', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      await db.userStyleProfiles.update(fixture.profileId!, { revisionPairs: '[]' })
    }],
    ['校准反馈', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      await db.userStyleProfiles.update(fixture.profileId!, { calibrationFeedback: '[]' })
    }],
    ['正式画像', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      await db.userStyleProfiles.update(fixture.profileId!, { profile: '作者在确认前手改的新画像' })
    }],
    ['注入开关', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      await db.userStyleProfiles.update(fixture.profileId!, { enabled: true })
    }],
  ] as const)('%s 漂移使候选 stale，不覆盖作者状态', async (_label, mutate) => {
    const fixture = await seed(_label)
    const generated = await generateStyleLearningCandidateV1({
      scope: fixture.scope, chapterIds: [fixture.chapterId], runAI: async () => styleResult(),
    })
    await mutate(fixture)
    await expect(adoptStyleLearningCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id }))
      .rejects.toThrow()
    expect((await db.userStyleProfiles.get(fixture.profileId!))?.profile).not.toBe(styleResult())
  })

  it.each<StyleLearningAdoptionBoundaryV1>([
    'intent.checkpoint', 'confirmation.recorded', 'adoption.started', 'formal.written',
    'adoption.committed', 'step.succeeded', 'verification.started', 'verification.accepted',
  ])('采纳在 %s 中断后沿冻结意图幂等收敛', async boundary => {
    const fixture = await seed(boundary)
    const generated = await generateStyleLearningCandidateV1({
      scope: fixture.scope, chapterIds: [fixture.chapterId], runAI: async () => styleResult(boundary),
    })
    await expect(adoptStyleLearningCandidateV1({
      scope: fixture.scope,
      runId: generated.snapshot.run.id,
      onDurableBoundary: current => { if (current === boundary) throw new Error(`interrupt:${boundary}`) },
    })).rejects.toThrow(`interrupt:${boundary}`)
    const completed = await adoptStyleLearningCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id })
    expect(completed.snapshot.projection.state).toBe('completed')
    expect((await db.userStyleProfiles.get(fixture.profileId!))?.profile).toBe(styleResult(boundary))
    expect(completed.snapshot.events.filter(event => event.type === 'adoption.committed')).toHaveLength(1)
  })

  it('拒绝、画像删除/新增竞争、导入取消、Work 隔离与终态过期均 fail-closed', async () => {
    const rejected = await seed('reject')
    const rejectedRun = await generateStyleLearningCandidateV1({
      scope: rejected.scope, chapterIds: [rejected.chapterId], runAI: async () => styleResult(),
    })
    expect((await rejectStyleLearningCandidateV1({
      scope: rejected.scope, runId: rejectedRun.snapshot.run.id,
    })).projection.state).toBe('cancelled')

    const deleted = await seed('deleted')
    const deletedRun = await generateStyleLearningCandidateV1({
      scope: deleted.scope, chapterIds: [deleted.chapterId], runAI: async () => styleResult(),
    })
    await db.userStyleProfiles.delete(deleted.profileId!)
    await expect(adoptStyleLearningCandidateV1({ scope: deleted.scope, runId: deletedRun.snapshot.run.id })).rejects.toThrow()

    const inserted = await seed('inserted', false)
    const insertedRun = await generateStyleLearningCandidateV1({
      scope: inserted.scope, chapterIds: [inserted.chapterId], runAI: async () => styleResult(),
    })
    await db.userStyleProfiles.add({
      projectId: inserted.projectId, worldId: inserted.worldId, workId: inserted.workId,
      profile: '作者竞争画像', enabled: true, sourceChapterIds: '[]', sampleCount: 0, sampleWords: 0,
      createdAt: Date.now(), updatedAt: Date.now(),
    } as any)
    await expect(adoptStyleLearningCandidateV1({ scope: inserted.scope, runId: insertedRun.snapshot.run.id })).rejects.toThrow()

    const terminal = await seed('terminal')
    const terminalRun = await generateStyleLearningCandidateV1({
      scope: terminal.scope, chapterIds: [terminal.chapterId], runAI: async () => styleResult(),
    })
    await adoptStyleLearningCandidateV1({ scope: terminal.scope, runId: terminalRun.snapshot.run.id })
    await db.userStyleProfiles.update(terminal.profileId!, { profile: '作者覆盖终态' })
    await expect(adoptStyleLearningCandidateV1({ scope: terminal.scope, runId: terminalRun.snapshot.run.id }))
      .rejects.toThrow('完成回执已过期')

    const pending = await seed('import')
    await generateStyleLearningCandidateV1({
      scope: pending.scope, chapterIds: [pending.chapterId], runAI: async () => styleResult(),
    })
    const importedId = await importProjectJSON(await exportProjectJSON(pending.projectId))
    expect((await db.agentRuns.where('projectId').equals(importedId).toArray())
      .find(run => run.contractJson.includes('prose.style-learn'))?.status).toBe('cancelled')

    const now = Date.now()
    const otherWorkId = await db.works.add(currentWorkFixtureRecordV1({
      projectId: pending.projectId, worldId: pending.worldId, code: generateWorkCode(), title: '另一作品', description: '',
      genres: ['fantasy'], status: 'drafting', targetWordCount: 1_000,
      kind: 'novel', novelProfile: 'long', createdAt: now, updatedAt: now,
    })) as number
    expect(await readPendingStyleLearningCandidateV1({
      scope: { ...pending.scope, workId: otherWorkId },
    })).toBeNull()
  })

  it('结果不可判定运行可显式放弃，但冻结采纳意图后不可取消', async () => {
    const unsafe = await seed('unsafe')
    await expect(generateStyleLearningCandidateV1({
      scope: unsafe.scope, chapterIds: [unsafe.chapterId], runAI: async () => styleResult(),
      onDurableBoundary: boundary => { if (boundary === 'model.requested') throw new Error('interrupt') },
    })).rejects.toThrow('interrupt')
    const recoverable = await readRecoverableStyleLearningRunV1({ scope: unsafe.scope })
    expect((await abandonStyleLearningRunV1({
      scope: unsafe.scope, runId: recoverable!.snapshot.run.id,
    })).projection.state).toBe('cancelled')

    const frozen = await seed('frozen')
    const generated = await generateStyleLearningCandidateV1({
      scope: frozen.scope, chapterIds: [frozen.chapterId], runAI: async () => styleResult(),
    })
    await expect(adoptStyleLearningCandidateV1({
      scope: frozen.scope,
      runId: generated.snapshot.run.id,
      onDurableBoundary: boundary => { if (boundary === 'intent.checkpoint') throw new Error('interrupt:intent') },
    })).rejects.toThrow('interrupt:intent')
    await expect(abandonStyleLearningRunV1({ scope: frozen.scope, runId: generated.snapshot.run.id }))
      .rejects.toThrow('意图已冻结')
  })
})
