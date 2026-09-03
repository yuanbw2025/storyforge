import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope } from '../../src/lib/types'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import {
  adoptEmotionBeatCandidateV1,
  type EmotionBeatAdoptionBoundaryV1,
  generateEmotionBeatCandidateV1,
  parseEmotionBeatCandidateDraftV1,
  readPendingEmotionBeatCandidateV1,
  rejectEmotionBeatCandidateV1,
} from '../../src/lib/agent/run/emotion-beat-durable'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'

async function seed() {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: '情绪节拍', genre: 'fantasy', genres: ['fantasy'], status: 'drafting', description: '',
    targetWordCount: 80_000,createdAt: now, updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({
    projectId, code: `beat-${now}`, name: '潮钟世界', description: '', currentVersion: 1,
    createdAt: now, updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId, worldId, title: '情绪节拍', description: '', genres: ['fantasy'], status: 'drafting',
    targetWordCount: 80_000, createdAt: now, updatedAt: now,
  } as any) as number
  await db.projects.update(projectId, { activeWorldId: worldId, activeWorkId: workId, ownershipSchemaVersion: 1 })
  const worldGroupId = await db.worldGroups.add({
    projectId, worldId, name: '主世界', order: 0, createdAt: now, updatedAt: now,
  }) as number
  const previousOutlineNodeId = await db.outlineNodes.add({
    projectId, workId, worldGroupId, parentId: null, type: 'chapter', title: '前章·旧港交钥',
    summary: '阿澜从潮门逃出并拿到钥匙。', order: 0, createdAt: now, updatedAt: now,
  } as any) as number
  const outlineNodeId = await db.outlineNodes.add({
    projectId, workId, worldGroupId, parentId: null, type: 'chapter', title: '第二章·钟楼投票',
    summary: '阿澜在钟楼公开钥匙，并说服钟叔承担真相的代价。',
    order: 1, createdAt: now, updatedAt: now,
  } as any) as number
  await db.chapters.add({
    projectId, workId, outlineNodeId: previousOutlineNodeId, title: '前章·旧港交钥',
    content: '<p>钟声第七次落下。阿澜把湿透的钥匙放在钟叔掌心：“明日让全城看见它。”</p>',
    wordCount: 42, status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now,
  } as any)
  const chapterId = await db.chapters.add({
    projectId, workId, outlineNodeId, title: '第二章·钟楼投票', content: '', wordCount: 0,
    status: 'outline', order: 1, notes: '', createdAt: now, updatedAt: now,
  } as any) as number
  await db.detailedOutlines.add({
    projectId, workId, outlineNodeId,
    openingHook: '阿澜带着湿钥匙踏入钟楼。',
    endingCliffhanger: '投票钟即将敲响时，钥匙自行转动。',
    scenes: [{
      sceneId: 'scene-vote', title: '质疑与投票', summary: '钟叔先质疑阿澜，后决定公开支持她。',
      characterIds: [], location: '钟楼议事厅', conflict: '个人亲情与公共责任冲突', pace: 'climax',
      estimatedWords: 1800, notes: '结论不能靠说教得出。',
    }],
    createdAt: now, updatedAt: now,
  } as any)
  await db.worldviews.add({
    projectId, worldId, worldGroupId, worldOrigin: '潮钟只能在众人见证下转移记忆。',
    createdAt: now, updatedAt: now,
  } as any)
  await db.storyCores.add({
    projectId, workId, theme: '真相与责任', centralConflict: '救一个人与救一座城不可兼得。',
    createdAt: now, updatedAt: now,
  } as any)
  await db.creativeRules.add({
    projectId, workId, writingStyle: '克制、具体，以行动代替解释。', narrativePOV: 'third-limited',
    toneAndMood: '', atmosphere: '冷峻中保留微弱希望。', prohibitions: JSON.stringify(['不得使用现代网络用语']),
    consistencyRules: JSON.stringify(['记忆转移必须经潮钟见证']), specialRequirements: '', referenceWorks: '[]',
    createdAt: now, updatedAt: now,
  } as any)
  await db.characters.add({
    projectId, worldId, workId: null, homeWorldGroupId: worldGroupId, name: '阿澜', roleWeight: 'protagonist',
    moralAxis: 'neutral', orderAxis: 'neutral', shortDescription: '必须公开钥匙的守门人', relationships: '',
    createdAt: now, updatedAt: now,
  } as any)
  await db.characters.add({
    projectId, worldId, workId: null, homeWorldGroupId: worldGroupId, name: '钟叔', roleWeight: 'supporting',
    moralAxis: 'good', orderAxis: 'lawful', shortDescription: '在亲情与公共责任间犹疑的老钟匠', relationships: '',
    createdAt: now, updatedAt: now,
  } as any)
  return {
    scope: { projectId, worldId, workId } satisfies WorkspaceScope,
    projectId, worldId, workId, worldGroupId, outlineNodeId, chapterId,
  }
}

function beat(label: string, index: number) {
  return {
    label,
    sceneGoal: `完成叙事任务 ${index}`,
    emotionTone: ['紧张', '犹疑', '震撼'][index - 1] ?? '平静',
    readerFeeling: `读者感受 ${index}`,
    characterGrowth: `角色变化 ${index}`,
  }
}

function response() {
  return JSON.stringify({
    overallArc: '从对质的紧绷逐步转向承担责任的震撼。',
    beats: [beat('入钟楼', 1), beat('公开对质', 2), beat('投票转向', 3)],
  })
}

describe.sequential('R-HARNESS61 · 情感节拍 durable 候选与采纳', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('Skill 只读登记上下文，模型生成后正式节拍卡零写入', async () => {
    const fixture = await seed()
    expect(getAgentSkillV1('prose.emotion-beats')).toMatchObject({
      agentId: 'prose', executionMode: 'emotion-beats',
      contextSourceKeys: [
        'chapterOutline', 'detailedOutline', 'previousChapterEnding',
        'worldview', 'storyCore', 'characters', 'creativeRules',
      ],
      writeTargets: [{ table: 'emotionBeatCards', fields: ['chapterId', 'chapterTitle', 'overallArc', 'beats', 'source'] }],
    })
    const generated = await generateEmotionBeatCandidateV1({
      scope: fixture.scope, chapterId: fixture.chapterId, worldGroupId: fixture.worldGroupId,
      runAI: async messages => {
        const prompt = messages.map(message => message.content).join('\n')
        expect(prompt).toContain('阿澜在钟楼公开钥匙')
        expect(prompt).toContain('质疑与投票')
        expect(prompt).toContain('明日让全城看见它')
        expect(prompt).toContain('潮钟只能在众人见证下')
        expect(prompt).toContain('真相与责任')
        expect(prompt).toContain('钟叔')
        expect(prompt).toContain('以行动代替解释')
        return response()
      },
    })
    expect(generated.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(generated.candidate.chapterTitle).toBe('第二章·钟楼投票')
    expect(generated.candidate.beats).toHaveLength(3)
    expect(await db.emotionBeatCards.count()).toBe(0)
    expect(generated.snapshot.events.some(event => event.type === 'model.requested')).toBe(true)
    expect(generated.snapshot.events.some(event => event.type === 'adoption.committed')).toBe(false)
  })

  it('刷新恢复同一候选，作者确认后只经 adopt() 写入并签发 terminal receipt', async () => {
    const fixture = await seed()
    const generated = await generateEmotionBeatCandidateV1({
      scope: fixture.scope, chapterId: fixture.chapterId, worldGroupId: fixture.worldGroupId,
      runAI: async () => response(),
    })
    const recovered = await readPendingEmotionBeatCandidateV1({
      scope: fixture.scope, chapterId: fixture.chapterId, worldGroupId: fixture.worldGroupId,
    })
    expect(recovered?.snapshot.run.id).toBe(generated.snapshot.run.id)
    expect(recovered?.candidate).toEqual(generated.candidate)
    const adopted = await adoptEmotionBeatCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id })
    expect(adopted.snapshot.projection.state).toBe('completed')
    expect(adopted.receiptHash).toHaveLength(64)
    const card = await db.emotionBeatCards.get(adopted.recordId)
    expect(card).toMatchObject({
      projectId: fixture.projectId, workId: fixture.workId, chapterId: fixture.chapterId,
      chapterTitle: '第二章·钟楼投票', source: 'ai',
    })
    expect(JSON.parse(card!.beats as unknown as string)).toEqual(generated.candidate.beats)
    expect(adopted.snapshot.events.some(event => event.type === 'adoption.committed')).toBe(true)
    await expect(readPendingEmotionBeatCandidateV1({
      scope: fixture.scope, chapterId: fixture.chapterId, worldGroupId: fixture.worldGroupId,
    })).resolves.toBeNull()
  })

  it('严格 parser 拒绝额外字段、节拍数量、空字段、重名和非 JSON', () => {
    const valid = JSON.parse(response())
    expect(() => parseEmotionBeatCandidateDraftV1(JSON.stringify({ ...valid, extra: true }))).toThrow('字段不在允许闭集')
    expect(() => parseEmotionBeatCandidateDraftV1(JSON.stringify({ ...valid, beats: valid.beats.slice(0, 2) }))).toThrow('3–6')
    expect(() => parseEmotionBeatCandidateDraftV1(JSON.stringify({
      ...valid, beats: valid.beats.map((row: any, index: number) => index ? row : { ...row, sceneGoal: '' }),
    }))).toThrow('非空字符串')
    expect(() => parseEmotionBeatCandidateDraftV1(JSON.stringify({
      ...valid, beats: valid.beats.map((row: any, index: number) => index === 1 ? { ...row, label: valid.beats[0].label } : row),
    }))).toThrow('名称不得重复')
    expect(() => parseEmotionBeatCandidateDraftV1('节拍建议')).toThrow('不是有效 JSON')
  })

  it('章纲或现有正式卡改变会使候选 stale，不覆盖当前状态', async () => {
    const fixture = await seed()
    const generated = await generateEmotionBeatCandidateV1({
      scope: fixture.scope, chapterId: fixture.chapterId, worldGroupId: fixture.worldGroupId,
      runAI: async () => response(),
    })
    await db.outlineNodes.update(fixture.outlineNodeId, {
      summary: '作者已改为钟叔拒绝投票。', updatedAt: Date.now() + 1,
    })
    await expect(adoptEmotionBeatCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id,
    })).rejects.toThrow('已变化')
    expect(await db.emotionBeatCards.count()).toBe(0)
    expect((await db.agentRuns.get(generated.snapshot.run.id))?.status).toBe('paused')
  })

  it('作者拒绝后候选不再恢复，也不写正式卡', async () => {
    const fixture = await seed()
    const generated = await generateEmotionBeatCandidateV1({
      scope: fixture.scope, chapterId: fixture.chapterId, worldGroupId: fixture.worldGroupId,
      runAI: async () => response(),
    })
    const rejected = await rejectEmotionBeatCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id })
    expect(rejected.projection.state).toBe('cancelled')
    await expect(readPendingEmotionBeatCandidateV1({
      scope: fixture.scope, chapterId: fixture.chapterId, worldGroupId: fixture.worldGroupId,
    })).resolves.toBeNull()
    expect(await db.emotionBeatCards.count()).toBe(0)
  })

  it('采纳开始后、正式写入前崩溃仍会二次 CAS，不写入期间已过期的候选', async () => {
    const fixture = await seed()
    const generated = await generateEmotionBeatCandidateV1({
      scope: fixture.scope, chapterId: fixture.chapterId, worldGroupId: fixture.worldGroupId,
      runAI: async () => response(),
    })
    await expect(adoptEmotionBeatCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id,
      onDurableBoundary: boundary => {
        if (boundary === 'adoption.started') throw new Error('interrupt:adoption.started')
      },
    })).rejects.toThrow('interrupt:adoption.started')
    await db.outlineNodes.update(fixture.outlineNodeId, {
      summary: '采纳间隔中作者已改变章纲。', updatedAt: Date.now() + 1,
    })
    await expect(adoptEmotionBeatCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id,
    })).rejects.toThrow('已变化')
    expect(await db.emotionBeatCards.count()).toBe(0)
    expect((await db.agentRuns.get(generated.snapshot.run.id))?.status).toBe('paused')
  })

  it('正式写入后崩溃时若上游改变，保留已写卡的审计证据但拒绝签发 fresh receipt', async () => {
    const fixture = await seed()
    const generated = await generateEmotionBeatCandidateV1({
      scope: fixture.scope, chapterId: fixture.chapterId, worldGroupId: fixture.worldGroupId,
      runAI: async () => response(),
    })
    await expect(adoptEmotionBeatCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id,
      onDurableBoundary: boundary => {
        if (boundary === 'formal.written') throw new Error('interrupt:formal.written')
      },
    })).rejects.toThrow('interrupt:formal.written')
    expect(await db.emotionBeatCards.count()).toBe(1)
    await db.outlineNodes.update(fixture.outlineNodeId, {
      summary: '正式写入后作者改变了上游章纲。', updatedAt: Date.now() + 1,
    })
    await expect(adoptEmotionBeatCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id,
    })).rejects.toThrow('不会通过终验')
    const run = await db.agentRuns.get(generated.snapshot.run.id)
    expect(run?.status).toBe('paused')
    expect(run?.terminalReceiptHash).toBeNull()
    const events = await db.agentRunEvents.where('runId').equals(generated.snapshot.run.id).toArray()
    expect(events.some(event => event.type === 'adoption.committed')).toBe(true)
  })

  it('adoption.committed 后、terminal 前正式卡漂移会明确暂停 Run', async () => {
    const fixture = await seed()
    const generated = await generateEmotionBeatCandidateV1({
      scope: fixture.scope, chapterId: fixture.chapterId, worldGroupId: fixture.worldGroupId,
      runAI: async () => response(),
    })
    await expect(adoptEmotionBeatCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id,
      onDurableBoundary: boundary => {
        if (boundary === 'adoption.committed') throw new Error('interrupt:adoption.committed')
      },
    })).rejects.toThrow('interrupt:adoption.committed')
    const card = await db.emotionBeatCards.where('projectId').equals(fixture.projectId).first()
    await db.emotionBeatCards.update(card!.id!, { overallArc: '终验前人工改写', updatedAt: Date.now() + 1 })
    await expect(adoptEmotionBeatCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id,
    })).rejects.toThrow('终验前发生变化')
    const run = await db.agentRuns.get(generated.snapshot.run.id)
    expect(run?.status).toBe('paused')
    expect(run?.terminalReceiptHash).toBeNull()
  })

  it('采纳八个持久化边界逐一中断均恢复同一 Run，且只保留一张正式卡', async () => {
    const boundaries: EmotionBeatAdoptionBoundaryV1[] = [
      'intent.checkpoint', 'confirmation.recorded', 'adoption.started', 'formal.written',
      'adoption.committed', 'step.succeeded', 'verification.started', 'verification.accepted',
    ]
    for (const boundary of boundaries) {
      await db.delete()
      await db.open()
      const fixture = await seed()
      const generated = await generateEmotionBeatCandidateV1({
        scope: fixture.scope, chapterId: fixture.chapterId, worldGroupId: fixture.worldGroupId,
        runAI: async () => response(),
      })
      await expect(adoptEmotionBeatCandidateV1({
        scope: fixture.scope, runId: generated.snapshot.run.id,
        onDurableBoundary: reached => {
          if (reached === boundary) throw new Error(`interrupt:${boundary}`)
        },
      })).rejects.toThrow(`interrupt:${boundary}`)
      const recovered = await readPendingEmotionBeatCandidateV1({
        scope: fixture.scope, chapterId: fixture.chapterId, worldGroupId: fixture.worldGroupId,
      })
      if (boundary === 'verification.accepted') expect(recovered).toBeNull()
      else expect(recovered?.snapshot.run.id).toBe(generated.snapshot.run.id)
      const completed = await adoptEmotionBeatCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id })
      expect(completed.snapshot.projection.state, boundary).toBe('completed')
      expect(await db.emotionBeatCards.count(), boundary).toBe(1)
      expect((await db.agentRuns.where('projectId').equals(fixture.projectId).toArray())
        .filter(run => run.contractJson.includes('prose.emotion-beats')), boundary).toHaveLength(1)
    }
  })

  it('未完成物理 ID 候选在项目导入后明确取消，不在新工作区复活', async () => {
    const fixture = await seed()
    await generateEmotionBeatCandidateV1({
      scope: fixture.scope, chapterId: fixture.chapterId, worldGroupId: fixture.worldGroupId,
      runAI: async () => response(),
    })
    const importedId = await importProjectJSON(await exportProjectJSON(fixture.projectId))
    const imported = (await db.agentRuns.where('projectId').equals(importedId).toArray())
      .find(run => run.contractJson.includes('prose.emotion-beats'))!
    expect(imported.status).toBe('cancelled')
    expect(imported.terminalReceiptHash).toBeNull()
  })

  it('终验后正式卡被人工修改时旧 receipt 立即 stale，不冒充当前完成', async () => {
    const fixture = await seed()
    const generated = await generateEmotionBeatCandidateV1({
      scope: fixture.scope, chapterId: fixture.chapterId, worldGroupId: fixture.worldGroupId,
      runAI: async () => response(),
    })
    const adopted = await adoptEmotionBeatCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id })
    await db.emotionBeatCards.update(adopted.recordId, { overallArc: '作者已重写情感弧线', updatedAt: Date.now() + 1 })
    await expect(adoptEmotionBeatCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id,
    })).rejects.toThrow('完成回执已过期')
    const run = await db.agentRuns.get(generated.snapshot.run.id)
    expect(run?.status).toBe('paused')
    expect(run?.terminalReceiptHash).toBeNull()
  })

  it('终验后上游章纲改变也会撤销旧 receipt，不只监视正式卡本身', async () => {
    const fixture = await seed()
    const generated = await generateEmotionBeatCandidateV1({
      scope: fixture.scope, chapterId: fixture.chapterId, worldGroupId: fixture.worldGroupId,
      runAI: async () => response(),
    })
    await adoptEmotionBeatCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id })
    await db.outlineNodes.update(fixture.outlineNodeId, {
      summary: '终验后作者把本章改为不投票。', updatedAt: Date.now() + 1,
    })
    await expect(adoptEmotionBeatCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id,
    })).rejects.toThrow('上游上下文')
    const run = await db.agentRuns.get(generated.snapshot.run.id)
    expect(run?.status).toBe('paused')
    expect(run?.terminalReceiptHash).toBeNull()
  })

  it('目标章必须属于当前 Work 且章纲属于当前世界', async () => {
    const fixture = await seed()
    await expect(generateEmotionBeatCandidateV1({
      scope: fixture.scope, chapterId: fixture.chapterId, worldGroupId: null,
      runAI: async () => response(),
    })).rejects.toThrow('世界不匹配')
    expect(await db.agentRuns.count()).toBe(0)
  })

  it('旧组件直调、手拼上下文和宽松 parser 已下线，人工 CRUD 仍保留', () => {
    const source = readFileSync('src/components/editor/EmotionBeatCard.tsx', 'utf8')
    const adapter = readFileSync('src/lib/ai/adapters/emotion-beat-adapter.ts', 'utf8')
    const editor = readFileSync('src/components/editor/ChapterEditor.tsx', 'utf8')
    expect(source).not.toContain('useAIStream')
    expect(source).not.toContain('buildEmotionBeatPrompt')
    expect(source).not.toContain('parseEmotionBeats')
    expect(source).toContain('generateEmotionBeatCandidateV1')
    expect(source).toContain('adoptEmotionBeatCandidateV1')
    expect(source).toContain('await saveCard')
    expect(source).toContain('await updateCard')
    expect(adapter).not.toContain('export function parseEmotionBeats')
    expect(editor).not.toContain('chapterSummary={outlineNode.summary')
    expect(editor).not.toContain('prevChapterEnding=')
  })
})
