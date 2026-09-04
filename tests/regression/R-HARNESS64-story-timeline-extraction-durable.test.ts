import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope } from '../../src/lib/types'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { parseStoryEvents } from '../../src/lib/ai/adapters/story-timeline-adapter'
import { usePromptStore } from '../../src/stores/prompt'
import {
  abandonStoryTimelineExtractionV1,
  adoptStoryTimelineExtractionCandidateV1,
  generateStoryTimelineExtractionCandidateV1,
  type StoryTimelineExtractionAdoptionBoundaryV1,
  readPendingStoryTimelineExtractionCandidateV1,
  readRecoverableStoryTimelineExtractionV1,
  resumeStoryTimelineExtractionCandidateV1,
} from '../../src/lib/agent/run/story-timeline-extraction-durable'
import { currentWorkFixtureRecordV1, seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampCurrentFixtureResourceUidsV1 } from '../helpers/current-resource-identity'

async function seed(options: { long?: boolean } = {}) {
  const now = Date.now()
  const created = await seedCurrentWorkspace('故事年表提取')
  const { projectId, worldId, workId } = created.scope
  const worldGroupId = await db.worldGroups.add({
    projectId, worldId, name: '主世界', order: 0, createdAt: now, updatedAt: now,
  }) as number
  const volumeId = await db.outlineNodes.add({
    projectId, workId, worldGroupId, parentId: null, type: 'volume', title: '第一卷', summary: '',
    order: 0, createdAt: now, updatedAt: now,
  } as any) as number
  const chapterIds: number[] = []
  const contents = [
    options.long
      ? `阿澜在旧港敲响潮门钟。${'海潮反复拍击钟楼石阶。'.repeat(650)}钟声最终唤醒沉睡的潮门。`
      : '阿澜在旧港敲响潮门钟，钟声唤醒沉睡的潮门。守钟人确认封印已经破裂，众人决定在天亮前撤离码头，并把这一刻记作远航的起点。',
    '阿澜穿过潮门抵达雾城，议会当众宣布封锁港口。她向众人展示潮汐令，迫使议会暂缓逮捕，并约定三日后在白塔重新谈判。',
    '短章，不进入提取范围。',
  ]
  for (let index = 0; index < contents.length; index++) {
    const outlineId = await db.outlineNodes.add({
      projectId, workId, worldGroupId, parentId: volumeId, type: 'chapter',
      title: `第${index + 1}章`, summary: `第${index + 1}章摘要`, order: index,
      createdAt: now + index, updatedAt: now + index,
    } as any) as number
    chapterIds.push(await db.chapters.add({
      projectId, workId, outlineNodeId: outlineId, title: `第${index + 1}章`,
      content: `<p>${contents[index]}</p>`, wordCount: contents[index].length,
      status: 'draft', order: index, notes: '', createdAt: now + index, updatedAt: now + index,
    } as any) as number)
  }
  const originalIds = [
    await db.storyTimelineEvents.add({
      projectId, workId, title: '旧港旧事件', storyTime: '第一日', importance: 2,
      description: '旧提取结果', chapterId: chapterIds[0], chapterTitle: '第1章', order: 4, createdAt: now,
    } as any) as number,
    await db.storyTimelineEvents.add({
      projectId, workId, title: '雾城旧事件', storyTime: '第二日', importance: 2,
      description: '旧提取结果', chapterId: chapterIds[1], chapterTitle: '第2章', order: 7, createdAt: now + 1,
    } as any) as number,
    await db.storyTimelineEvents.add({
      projectId, workId, title: '短章人工事件', storyTime: '第三日', importance: 1,
      description: '范围外人工记录', chapterId: chapterIds[2], chapterTitle: '第3章', order: 9, createdAt: now + 2,
    } as any) as number,
  ]
  await stampCurrentFixtureResourceUidsV1(projectId)
  return {
    scope: { projectId, worldId, workId } satisfies WorkspaceScope,
    projectId, worldId, workId, worldGroupId, volumeId, chapterIds, originalIds,
  }
}

function event(
  title = '潮门苏醒',
  storyTime = '第一日黎明',
  importance = 3,
  description = '阿澜敲钟后，潮门从沉睡中苏醒。',
) {
  return { title, storyTime, importance, description }
}

function response(...rows: ReturnType<typeof event>[]) {
  return JSON.stringify(rows)
}

describe.sequential('R-HARNESS64 · 故事年表 durable 分块提取与原子替换', () => {
  beforeEach(async () => {
    usePromptStore.setState({ templates: [], loaded: false })
    await db.delete()
    await db.open()
  })
  afterEach(() => {
    usePromptStore.setState({ templates: [], loaded: false })
    db.close()
  })

  it('Skill 与 RunContract 只声明 chapterContent 读取和年表七字段确认写入，Manifest 对应真实模型输入', async () => {
    const fixture = await seed()
    expect(getAgentSkillV1('prose.story-timeline-extraction')).toMatchObject({
      agentId: 'prose', executionMode: 'story-timeline-extraction', contextSourceKeys: ['chapterContent'],
      writeTargets: [{
        table: 'storyTimelineEvents',
        fields: ['title', 'storyTime', 'importance', 'description', 'chapterId', 'chapterTitle', 'order'],
      }],
    })
    const prompts: string[] = []
    const generated = await generateStoryTimelineExtractionCandidateV1({
      scope: fixture.scope,
      runAI: async (messages, callIndex) => {
        const prompt = messages.map(message => message.content).join('\n')
        prompts.push(prompt)
        expect(prompt).not.toContain('旧港旧事件')
        return response(event(callIndex === 0 ? '潮门苏醒' : '议会封港'))
      },
    })
    expect(prompts[0]).toContain('阿澜')
    expect(generated.snapshot.contract.permissions).toEqual({
      contextSourceKeys: ['chapterContent'],
      writeTargets: [{
        table: 'storyTimelineEvents',
        fields: ['title', 'storyTime', 'importance', 'description', 'chapterId', 'chapterTitle', 'order'],
        mode: 'author-confirmed',
      }],
    })
    expect(generated.snapshot.events.filter(row => row.type === 'context.assembled')).toHaveLength(2)
    expect((await db.storyTimelineEvents.toArray()).map(row => row.id)).toEqual(fixture.originalIds)
  })

  it('全部分块完成前正式表零写入；安全中断只从下一个分块继续', async () => {
    const fixture = await seed({ long: true })
    const initialCalls: number[] = []
    await expect(generateStoryTimelineExtractionCandidateV1({
      scope: fixture.scope,
      runAI: async (_messages, callIndex) => {
        initialCalls.push(callIndex)
        return response(event())
      },
      onDurableBoundary: (boundary, _snapshot, callIndex) => {
        if (boundary === 'chunk.checkpoint' && callIndex === 0) throw new Error('interrupt:first-timeline-chunk')
      },
    })).rejects.toThrow('interrupt:first-timeline-chunk')
    expect(initialCalls).toEqual([0])
    expect((await db.storyTimelineEvents.toArray()).map(row => row.id)).toEqual(fixture.originalIds)
    const recovery = await readRecoverableStoryTimelineExtractionV1({ scope: fixture.scope })
    expect(recovery).toMatchObject({ nextCallIndex: 1, safeToResume: true })
    const resumedCalls: number[] = []
    const resumed = await resumeStoryTimelineExtractionCandidateV1({
      scope: fixture.scope, runId: recovery!.snapshot.run.id,
      runAI: async (_messages, callIndex) => {
        resumedCalls.push(callIndex)
        return response(event(callIndex === 1 ? '潮门余波' : '议会封港'))
      },
    })
    expect(resumedCalls).not.toContain(0)
    expect(resumedCalls[0]).toBe(1)
    expect(resumed.snapshot.run.id).toBe(recovery!.snapshot.run.id)
  })

  it('candidate.persisted 与候选 checkpoint 之间崩溃可从完整进度重建同一候选', async () => {
    const fixture = await seed()
    await expect(generateStoryTimelineExtractionCandidateV1({
      scope: fixture.scope, runAI: async (_messages, callIndex) => response(event(callIndex ? '议会封港' : '潮门苏醒')),
      onDurableBoundary: boundary => {
        if (boundary === 'candidate.persisted') throw new Error('interrupt:timeline-candidate-event')
      },
    })).rejects.toThrow('interrupt:timeline-candidate-event')
    const recovered = await readPendingStoryTimelineExtractionCandidateV1({ scope: fixture.scope })
    expect(recovered?.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(recovered?.candidate.candidateHash).toBe(
      recovered?.snapshot.projection.steps['prose:story-timeline-extraction'].candidateHash,
    )
    expect(await db.storyTimelineEvents.count()).toBe(3)
  })

  it('模型结果不可判定时暂停且不自动重试；严格协议错误使整次 Run 失败', async () => {
    const fixture = await seed({ long: true })
    await expect(generateStoryTimelineExtractionCandidateV1({
      scope: fixture.scope, runAI: async () => { throw new Error('network-lost-after-send') },
    })).rejects.toThrow('network-lost-after-send')
    const recovery = await readRecoverableStoryTimelineExtractionV1({ scope: fixture.scope })
    expect(recovery).toMatchObject({ nextCallIndex: 0, safeToResume: false })
    await expect(resumeStoryTimelineExtractionCandidateV1({
      scope: fixture.scope, runId: recovery!.snapshot.run.id, runAI: async () => response(event()),
    })).rejects.toThrow('不会自动重试')
    expect((await abandonStoryTimelineExtractionV1({
      scope: fixture.scope, runId: recovery!.snapshot.run.id,
    })).projection.state).toBe('cancelled')

    await expect(generateStoryTimelineExtractionCandidateV1({
      scope: fixture.scope, runAI: async (_messages, callIndex) => callIndex === 0 ? response(event()) : 'not-json',
    })).rejects.toThrow('不是有效 JSON')
    const runs = (await db.agentRuns.where('projectId').equals(fixture.projectId).toArray())
      .filter(run => run.contractJson.includes('prose.story-timeline-extraction'))
    expect(runs.some(run => run.status === 'failed')).toBe(true)
    expect(await db.storyTimelineEvents.count()).toBe(3)
  })

  it('正文、提示词或正式年表 baseline 漂移时恢复/采纳 fail-closed', async () => {
    for (const drift of ['chapter', 'prompt', 'timeline'] as const) {
      await db.delete()
      await db.open()
      usePromptStore.setState({ templates: [], loaded: false })
      const fixture = await seed({ long: drift === 'chapter' })
      if (drift === 'chapter') {
        await expect(generateStoryTimelineExtractionCandidateV1({
          scope: fixture.scope, runAI: async () => response(event()),
          onDurableBoundary: (boundary, _snapshot, callIndex) => {
            if (boundary === 'chunk.checkpoint' && callIndex === 0) throw new Error('interrupt:timeline-cas')
          },
        })).rejects.toThrow('interrupt:timeline-cas')
        const recovery = await readRecoverableStoryTimelineExtractionV1({ scope: fixture.scope })
        await db.chapters.update(fixture.chapterIds[0], { content: '<p>作者已重写本章并改变关键事件。</p>' })
        await expect(resumeStoryTimelineExtractionCandidateV1({
          scope: fixture.scope, runId: recovery!.snapshot.run.id, runAI: async () => response(event()),
        }), drift).rejects.toThrow('已变化')
        continue
      }
      const generated = await generateStoryTimelineExtractionCandidateV1({
        scope: fixture.scope, runAI: async (_messages, callIndex) => response(event(callIndex ? '议会封港' : '潮门苏醒')),
      })
      if (drift === 'timeline') {
        await db.storyTimelineEvents.update(fixture.originalIds[0], { description: '作者已修改正式年表' })
      } else {
        const active = usePromptStore.getState().getActive('story-timeline.extract')
        usePromptStore.setState({
          templates: [{ ...active, id: 99, scope: 'user', isActive: true, userPromptTemplate: `${active.userPromptTemplate}\n新约束` }],
          loaded: true,
        })
      }
      await expect(adoptStoryTimelineExtractionCandidateV1({
        scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0],
      }), drift).rejects.toThrow('已变化')
    }
  })

  it('候选按 AdoptionSchema 的 chapterId + title 身份去重，采纳前不出现隐式合并', async () => {
    const fixture = await seed({ long: true })
    const generated = await generateStoryTimelineExtractionCandidateV1({
      scope: fixture.scope,
      runAI: async (_messages, callIndex) => callIndex < 2
        ? response(event('潮门苏醒', callIndex ? '第一日正午' : '第一日黎明'))
        : response(event('议会封港')),
    })
    const firstChapter = generated.candidate.events.filter(row => row.chapterId === fixture.chapterIds[0])
    expect(firstChapter).toHaveLength(1)
    expect(new Set(generated.candidate.events.map(row => `${row.chapterId}:${row.title}`)).size)
      .toBe(generated.candidate.events.length)
  })

  it('作者选择后逐章原子替换并把 order 压缩为 0..n-1；范围外正式行保持冻结', async () => {
    const fixture = await seed()
    const generated = await generateStoryTimelineExtractionCandidateV1({
      scope: fixture.scope,
      runAI: async (_messages, callIndex) => callIndex === 0
        ? response(event('潮门苏醒'), event('守钟人撤离', '第一日上午', 2))
        : response(event('议会封港')),
    })
    const adopted = await adoptStoryTimelineExtractionCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [1, 2],
    })
    expect(adopted.snapshot.projection.state).toBe('completed')
    const rows = await db.storyTimelineEvents.where('projectId').equals(fixture.projectId).toArray()
    expect(rows.filter(row => row.chapterId === fixture.chapterIds[0])).toMatchObject([{ title: '守钟人撤离', order: 0 }])
    expect(rows.filter(row => row.chapterId === fixture.chapterIds[1])).toMatchObject([{ title: '议会封港', order: 0 }])
    expect(rows.find(row => row.chapterId === fixture.chapterIds[2])).toMatchObject({
      id: fixture.originalIds[2], title: '短章人工事件', order: 9,
    })
  })

  it('空候选或作者空选择在明确确认后清理所有目标已写章节', async () => {
    for (const mode of ['empty-candidate', 'empty-selection'] as const) {
      await db.delete()
      await db.open()
      const fixture = await seed()
      const generated = await generateStoryTimelineExtractionCandidateV1({
        scope: fixture.scope,
        runAI: async (_messages, callIndex) => mode === 'empty-candidate'
          ? response()
          : response(event(callIndex ? '议会封港' : '潮门苏醒')),
      })
      await adoptStoryTimelineExtractionCandidateV1({
        scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [],
      })
      const rows = await db.storyTimelineEvents.where('projectId').equals(fixture.projectId).toArray()
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ id: fixture.originalIds[2], title: '短章人工事件' })
    }
  })

  it('八个采纳边界中断后均收敛到同一 Run 和冻结结果，正式写入后未 checkpoint 不重复改写', async () => {
    const boundaries: StoryTimelineExtractionAdoptionBoundaryV1[] = [
      'intent.checkpoint', 'confirmation.recorded', 'adoption.started', 'formal.chapter',
      'adoption.committed', 'step.succeeded', 'verification.started', 'verification.accepted',
    ]
    for (const boundary of boundaries) {
      await db.delete()
      await db.open()
      const fixture = await seed()
      const generated = await generateStoryTimelineExtractionCandidateV1({
        scope: fixture.scope,
        runAI: async (_messages, callIndex) => response(event(callIndex ? '议会封港' : '潮门苏醒')),
      })
      await expect(adoptStoryTimelineExtractionCandidateV1({
        scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0, 1],
        onDurableBoundary: (reached, _snapshot, chapterIndex) => {
          if (reached === boundary && (reached !== 'formal.chapter' || chapterIndex === 0)) {
            throw new Error(`interrupt:${boundary}`)
          }
        },
      })).rejects.toThrow(`interrupt:${boundary}`)
      const beforeResume = boundary === 'formal.chapter'
        ? await db.storyTimelineEvents.where('chapterId').equals(fixture.chapterIds[0]).first()
        : null
      const recovered = await readPendingStoryTimelineExtractionCandidateV1({ scope: fixture.scope })
      if (boundary === 'verification.accepted') expect(recovered).toBeNull()
      else expect(recovered?.snapshot.run.id, boundary).toBe(generated.snapshot.run.id)
      const completed = await adoptStoryTimelineExtractionCandidateV1({
        scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0, 1],
      })
      expect(completed.snapshot.projection.state, boundary).toBe('completed')
      const rows = await db.storyTimelineEvents.where('projectId').equals(fixture.projectId).toArray()
      expect(rows.map(row => row.title), boundary).toEqual(['短章人工事件', '潮门苏醒', '议会封港'])
      if (beforeResume) {
        const afterResume = await db.storyTimelineEvents.where('chapterId').equals(fixture.chapterIds[0]).first()
        expect(afterResume?.id).toBe(beforeResume.id)
      }
      expect((await db.agentRuns.where('projectId').equals(fixture.projectId).toArray())
        .filter(run => run.contractJson.includes('prose.story-timeline-extraction')), boundary).toHaveLength(1)
    }
  })

  it('portable:false 的 progress 与 candidate 导入后明确取消', async () => {
    for (const state of ['progress', 'candidate'] as const) {
      await db.delete()
      await db.open()
      const fixture = await seed({ long: state === 'progress' })
      if (state === 'progress') {
        await expect(generateStoryTimelineExtractionCandidateV1({
          scope: fixture.scope, runAI: async () => response(event()),
          onDurableBoundary: (boundary, _snapshot, callIndex) => {
            if (boundary === 'chunk.checkpoint' && callIndex === 0) throw new Error('interrupt:export-timeline-progress')
          },
        })).rejects.toThrow('interrupt:export-timeline-progress')
      } else {
        await generateStoryTimelineExtractionCandidateV1({
          scope: fixture.scope, runAI: async (_messages, callIndex) => response(event(callIndex ? '议会封港' : '潮门苏醒')),
        })
      }
      const importedId = await importProjectJSON(await exportProjectJSON(fixture.projectId))
      const imported = (await db.agentRuns.where('projectId').equals(importedId).toArray())
        .find(run => run.contractJson.includes('prose.story-timeline-extraction'))!
      expect(imported.status, state).toBe('cancelled')
      expect(imported.terminalReceiptHash, state).toBeNull()
    }
  })

  it('只读取当前 Work 的章节与正式年表，隔离同项目其它 Work', async () => {
    const fixture = await seed()
    const now = Date.now()
    const foreignWorkId = await db.works.add(currentWorkFixtureRecordV1({
      projectId: fixture.projectId, worldId: fixture.worldId, title: '同世界外部作品', description: '',
      genres: ['fantasy'], status: 'drafting', targetWordCount: 1_000, createdAt: now, updatedAt: now,
    })) as number
    await db.chapters.add({
      projectId: fixture.projectId, workId: foreignWorkId, outlineNodeId: null, title: '外部章节',
      content: '<p>秘密银门只存在于另一部作品，外部议会在这里宣布了永恒封锁。</p>', wordCount: 60,
      status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now,
    } as any)
    await db.storyTimelineEvents.add({
      projectId: fixture.projectId, workId: foreignWorkId, title: '外部秘密事件', storyTime: '', importance: 3,
      description: '隔离', chapterId: null, chapterTitle: '外部章节', order: 0, createdAt: now,
    } as any)
    await generateStoryTimelineExtractionCandidateV1({
      scope: fixture.scope,
      runAI: async (messages, callIndex) => {
        const prompt = messages.map(message => message.content).join('\n')
        expect(prompt).not.toContain('秘密银门')
        expect(prompt).not.toContain('外部秘密事件')
        return response(event(callIndex ? '议会封港' : '潮门苏醒'))
      },
    })
  })

  it('terminal 后正文、目标章正式行或范围外正式行漂移都会令旧 receipt stale', async () => {
    for (const drift of ['chapter', 'target', 'outside'] as const) {
      await db.delete()
      await db.open()
      const fixture = await seed()
      const generated = await generateStoryTimelineExtractionCandidateV1({
        scope: fixture.scope,
        runAI: async (_messages, callIndex) => response(event(callIndex ? '议会封港' : '潮门苏醒')),
      })
      await adoptStoryTimelineExtractionCandidateV1({
        scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0, 1],
      })
      if (drift === 'chapter') {
        await db.chapters.update(fixture.chapterIds[0], { content: '<p>终验后作者重写了潮门事件。</p>' })
      } else if (drift === 'target') {
        const target = await db.storyTimelineEvents.where('chapterId').equals(fixture.chapterIds[0]).first()
        await db.storyTimelineEvents.update(target!.id!, { description: '作者修改正式年表' })
      } else {
        await db.storyTimelineEvents.update(fixture.originalIds[2], { description: '作者修改范围外人工事件' })
      }
      await expect(adoptStoryTimelineExtractionCandidateV1({
        scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0, 1],
      }), drift).rejects.toThrow('完成回执已过期')
      const run = await db.agentRuns.get(generated.snapshot.run.id)
      expect(run?.status, drift).toBe('paused')
      expect(run?.terminalReceiptHash, drift).toBeNull()
    }
  })

  it('严格 parser 拒绝额外/缺失字段、非 1..3 整数重要度与非 JSON', () => {
    expect(parseStoryEvents(response(event()))).toEqual([event()])
    expect(() => parseStoryEvents(JSON.stringify([{ ...event(), extra: true }]))).toThrow('字段不在允许闭集')
    const { description: _description, ...missing } = event()
    expect(() => parseStoryEvents(JSON.stringify([missing]))).toThrow('字段不在允许闭集')
    expect(() => parseStoryEvents(JSON.stringify([{ ...event(), importance: 1.5 }]))).toThrow('字段类型或重要度无效')
    expect(() => parseStoryEvents(JSON.stringify([{ ...event(), importance: 4 }]))).toThrow('字段类型或重要度无效')
    expect(() => parseStoryEvents('年表建议如下')).toThrow('不是有效 JSON')
  })

  it('旧组件 chat、Context、分块/parser 与先删后写旁路已下线，人工 CRUD 保留', () => {
    const source = readFileSync('src/components/timeline/StoryTimelinePanel.tsx', 'utf8')
    expect(source).not.toContain('buildStoryTimelinePrompt')
    expect(source).not.toContain('parseStoryEvents')
    expect(source).not.toContain('splitExtractionText')
    expect(source).not.toContain('assembleContext')
    expect(source).not.toContain('await chat(')
    expect(source).not.toContain('deleteByChapter')
    expect(source).not.toContain("target: 'storyTimelineEvents'")
    expect(source).toContain('generateStoryTimelineExtractionCandidateV1')
    expect(source).toContain('resumeStoryTimelineExtractionCandidateV1')
    expect(source).toContain('adoptStoryTimelineExtractionCandidateV1')
    expect(source).toContain('addEvent')
    expect(source).toContain('updateEvent')
    expect(source).toContain('deleteEvent')
  })
})
