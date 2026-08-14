import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope } from '../../src/lib/types'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { parseForeshadowSuggestionsStrictV1 } from '../../src/lib/ai/adapters/foreshadow-adapter'
import {
  abandonForeshadowSuggestionRunV1,
  adoptForeshadowSuggestionCandidateV1,
  generateForeshadowSuggestionCandidateV1,
  readPendingForeshadowSuggestionCandidateV1,
  readRecoverableForeshadowSuggestionRunV1,
  rejectForeshadowSuggestionCandidateV1,
  type ForeshadowSuggestionAdoptionBoundaryV1,
  type ForeshadowSuggestionBoundaryV1,
} from '../../src/lib/agent/run/foreshadow-suggestions-durable'

async function seed(suffix = '') {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: `镜城伏笔${suffix}`, genre: 'suspense', genres: ['suspense'], status: 'drafting',
    description: '守灯人追查一枚不属于任何人的记忆盐晶。', targetWordCount: 90_000,
    worldCode: `foreshadow-${now}-${suffix}`, worldVersion: 1, enableMultiWorld: true,
    createdAt: now, updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({
    projectId, code: `foreshadow-${now}-${suffix}`, name: '镜海世界', description: '',
    currentVersion: 1, createdAt: now, updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId, worldId, title: `无主盐晶${suffix}`, description: '', genres: ['suspense'],
    status: 'drafting', targetWordCount: 90_000, createdAt: now, updatedAt: now,
  } as any) as number
  await db.projects.update(projectId, { activeWorldId: worldId, activeWorkId: workId, ownershipSchemaVersion: 1 })
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
    plotPattern: '线性调查', storyLines: '', createdAt: now, updatedAt: now,
  } as any) as number
  const characterId = await db.characters.add({
    projectId, worldId, homeWorldGroupId: worldGroupId, isCrossWorld: false, name: '沈砚',
    role: 'protagonist', roleWeight: 'main', moralAxis: 'good', orderAxis: 'lawful',
    shortDescription: '能听见盐晶中的遗言。', createdAt: now, updatedAt: now,
  } as any) as number
  const existingId = await db.foreshadows.add({
    projectId, workId, name: '无主盐晶', type: 'chekhov', status: 'planned',
    description: '盐晶没有登记主人，最终指向被抹去的第一任镜税官。',
    plantChapterId: null, echoChapterIds: '[]', resolveChapterId: null, notes: '',
    createdAt: now, updatedAt: now,
  } as any) as number
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

describe.sequential('R-HARNESS72 · 伏笔建议 durable 候选与原子采纳', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })

  it('三注册表闭合，登记 Canon、角色和正式 baseline 实际进入一次模型调用，确认前零写入', async () => {
    expect(CONTEXT_SOURCE_BY_KEY.get('foreshadowSuggestionBaseline')).toMatchObject({ ownerFrom: 'work' })
    expect(PROJECT_TABLES.find(item => item.name === 'foreshadows')).toMatchObject({ exportable: true })
    expect(getAgentSkillV1('outline.foreshadow-suggestions')).toMatchObject({
      agentId: 'outline', executionMode: 'foreshadow-suggestions', writeTargets: [{ table: 'foreshadows' }],
    })
    const fixture = await seed()
    let calls = 0
    const generated = await generateForeshadowSuggestionCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId,
      runAI: async messages => {
        calls++
        const prompt = messages.map(message => message.content).join('\n')
        expect(prompt).toContain('镜海退潮时')
        expect(prompt).toContain('沈砚')
        expect(prompt).toContain('无主盐晶')
        expect(prompt).toContain('严格输出协议')
        expect(prompt.split('【伏笔建议正式基线】')).toHaveLength(2)
        return response(suggestion('反照的空椅'))
      },
    })
    expect(calls).toBe(1)
    expect(generated.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(generated.candidate.suggestions.map(item => item.name)).toEqual(['反照的空椅'])
    expect(await db.foreshadows.where('projectId').equals(fixture.projectId).count()).toBe(1)

    const missingContext = await seed('prompt-omits-context')
    let missingContextCalls = 0
    await expect(generateForeshadowSuggestionCandidateV1({
      scope: missingContext.scope,
      worldGroupId: missingContext.worldGroupId,
      options: { overrides: { userPromptTemplate: '只返回协议要求的 JSON。' } },
      runAI: async () => { missingContextCalls++; return response() },
    })).rejects.toThrow('未实际进入模型 Prompt')
    expect(missingContextCalls).toBe(0)
  })

  it('严格协议拒绝围栏、根额外字段、条目额外字段、枚举修复、空白修剪和重复名称', () => {
    const valid = suggestion('反照的空椅')
    expect(() => parseForeshadowSuggestionsStrictV1(`\`\`\`json\n${response(valid)}\n\`\`\``, [])).toThrow('严格 JSON')
    expect(() => parseForeshadowSuggestionsStrictV1(JSON.stringify({ foreshadows: [valid], note: '' }), [])).toThrow('根字段')
    expect(() => parseForeshadowSuggestionsStrictV1(response({ ...valid, extra: true } as any), [])).toThrow('字段')
    expect(() => parseForeshadowSuggestionsStrictV1(response(suggestion('坏枚举', '物证')), [])).toThrow('枚举')
    expect(() => parseForeshadowSuggestionsStrictV1(response({ ...valid, name: ' 反照的空椅 ' }), [])).toThrow('类型')
    expect(() => parseForeshadowSuggestionsStrictV1(response(valid, valid), [])).toThrow('重复')
    expect(() => parseForeshadowSuggestionsStrictV1(response(valid), ['反照的空椅'])).toThrow('重复')
  })

  it('候选 checkpoint 后崩溃可重建；模型请求或响应未知窗口不会自动重试', async () => {
    for (const boundary of ['model.requested', 'model.responded'] satisfies ForeshadowSuggestionBoundaryV1[]) {
      const fixture = await seed(boundary)
      let calls = 0
      await expect(generateForeshadowSuggestionCandidateV1({
        scope: fixture.scope, worldGroupId: fixture.worldGroupId,
        runAI: async () => { calls++; return response(suggestion(`候选-${boundary}`)) },
        onDurableBoundary: current => { if (current === boundary) throw new Error(`interrupt:${boundary}`) },
      })).rejects.toThrow(`interrupt:${boundary}`)
      expect(calls).toBe(boundary === 'model.requested' ? 0 : 1)
      expect((await readRecoverableForeshadowSuggestionRunV1({ scope: fixture.scope }))?.safeToResume).toBe(false)
    }
    const fixture = await seed('checkpoint')
    await expect(generateForeshadowSuggestionCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId,
      runAI: async () => response(suggestion('镜中缺口')),
      onDurableBoundary: boundary => { if (boundary === 'candidate.checkpoint') throw new Error('interrupt:checkpoint') },
    })).rejects.toThrow('interrupt:checkpoint')
    expect((await readPendingForeshadowSuggestionCandidateV1({ scope: fixture.scope }))?.candidate.suggestions)
      .toEqual([suggestion('镜中缺口')])
  })

  it('刷新恢复候选，作者选择子集后才原子写入，并把状态和章节引用固定为系统默认', async () => {
    const fixture = await seed('adopt')
    const generated = await generateForeshadowSuggestionCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId,
      runAI: async () => response(suggestion('反照的空椅'), suggestion('逆流的钟声', 'timeline')),
    })
    expect((await readPendingForeshadowSuggestionCandidateV1({ scope: fixture.scope }))?.candidate).toEqual(generated.candidate)
    const adopted = await adoptForeshadowSuggestionCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [1],
    })
    expect(adopted.snapshot.projection.state).toBe('completed')
    const rows = await db.foreshadows.where('projectId').equals(fixture.projectId).toArray()
    expect(rows).toHaveLength(2)
    expect(rows.find(row => row.name === '逆流的钟声')).toMatchObject({
      type: 'timeline', status: 'planned', plantChapterId: null, echoChapterIds: '[]',
      resolveChapterId: null, workId: fixture.workId,
    })
  })

  it('空候选可签发零写入终态回执', async () => {
    const fixture = await seed('empty')
    const generated = await generateForeshadowSuggestionCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, runAI: async () => response(),
    })
    const adopted = await adoptForeshadowSuggestionCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [],
    })
    expect(adopted).toMatchObject({ written: 0 })
    expect(adopted.snapshot.projection.state).toBe('completed')
  })

  it.each([
    ['正式伏笔', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      await db.foreshadows.update(fixture.existingId, { description: '作者改写正式伏笔', updatedAt: Date.now() + 1 })
    }],
    ['项目', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      await db.projects.update(fixture.projectId, { description: '作者更新项目简介', updatedAt: Date.now() + 1 })
    }],
    ['故事核心', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      await db.storyCores.update(fixture.storyCoreId, { theme: '被遗忘者的责任', updatedAt: Date.now() + 1 })
    }],
    ['角色', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      await db.characters.update(fixture.characterId, { shortDescription: '拒绝听见遗言', updatedAt: Date.now() + 1 })
    }],
  ] as const)('%s 漂移使候选 stale，正式记录不被覆盖', async (_label, mutate) => {
    const fixture = await seed(_label)
    const generated = await generateForeshadowSuggestionCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, runAI: async () => response(suggestion('反照的空椅')),
    })
    await mutate(fixture)
    await expect(adoptForeshadowSuggestionCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0],
    })).rejects.toThrow('已变化')
    expect(await db.foreshadows.where('projectId').equals(fixture.projectId).count()).toBe(1)
  })

  it.each<ForeshadowSuggestionAdoptionBoundaryV1>([
    'intent.checkpoint', 'confirmation.recorded', 'adoption.started', 'formal.written',
    'adoption.committed', 'step.succeeded', 'verification.started', 'verification.accepted',
  ])('采纳在 %s 中断后沿同一冻结选择幂等收敛', async boundary => {
    const fixture = await seed(boundary)
    const generated = await generateForeshadowSuggestionCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId,
      runAI: async () => response(suggestion('反照的空椅'), suggestion('逆流的钟声', 'timeline')),
    })
    await expect(adoptForeshadowSuggestionCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [1],
      onDurableBoundary: current => { if (current === boundary) throw new Error(`interrupt:${boundary}`) },
    })).rejects.toThrow(`interrupt:${boundary}`)
    const completed = await adoptForeshadowSuggestionCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [1],
    })
    expect(completed.snapshot.projection.state).toBe('completed')
    expect((await db.foreshadows.where('projectId').equals(fixture.projectId).toArray()).map(row => row.name))
      .toEqual(['无主盐晶', '逆流的钟声'])
    expect(completed.snapshot.events.filter(event => event.type === 'adoption.committed')).toHaveLength(1)
  })

  it('拒绝、选择冻结、terminal stale、导入取消、Work 隔离与旧旁路下线均 fail-closed', async () => {
    const rejected = await seed('reject')
    const rejectedRun = await generateForeshadowSuggestionCandidateV1({
      scope: rejected.scope, worldGroupId: rejected.worldGroupId, runAI: async () => response(suggestion('反照的空椅')),
    })
    expect((await rejectForeshadowSuggestionCandidateV1({
      scope: rejected.scope, runId: rejectedRun.snapshot.run.id,
    })).projection.state).toBe('cancelled')

    const fixture = await seed('isolation')
    const generated = await generateForeshadowSuggestionCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId,
      runAI: async () => response(suggestion('反照的空椅'), suggestion('逆流的钟声', 'timeline')),
    })
    await expect(adoptForeshadowSuggestionCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [1],
      onDurableBoundary: boundary => { if (boundary === 'intent.checkpoint') throw new Error('interrupt:intent') },
    })).rejects.toThrow('interrupt:intent')
    await expect(abandonForeshadowSuggestionRunV1({ scope: fixture.scope, runId: generated.snapshot.run.id }))
      .rejects.toThrow('选择已冻结')
    await expect(adoptForeshadowSuggestionCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0],
    })).rejects.toThrow('冻结意图不一致')
    await adoptForeshadowSuggestionCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [1] })
    const written = (await db.foreshadows.where('projectId').equals(fixture.projectId).toArray())
      .find(row => row.name === '逆流的钟声')!
    await db.foreshadows.update(written.id!, { description: '作者覆盖终态', updatedAt: Date.now() + 1 })
    await expect(adoptForeshadowSuggestionCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [1],
    })).rejects.toThrow('完成回执已过期')

    const pending = await seed('import')
    await generateForeshadowSuggestionCandidateV1({
      scope: pending.scope, worldGroupId: pending.worldGroupId, runAI: async () => response(suggestion('镜中缺口')),
    })
    const importedId = await importProjectJSON(await exportProjectJSON(pending.projectId))
    expect((await db.agentRuns.where('projectId').equals(importedId).toArray())
      .find(run => run.contractJson.includes('outline.foreshadow-suggestions'))?.status).toBe('cancelled')

    const now = Date.now()
    const otherWorkId = await db.works.add({
      projectId: pending.projectId, worldId: pending.worldId, title: '另一作品', description: '',
      genres: ['suspense'], status: 'drafting', targetWordCount: 1_000, createdAt: now, updatedAt: now,
    } as any) as number
    await expect(readPendingForeshadowSuggestionCandidateV1({
      scope: { ...pending.scope, workId: otherWorkId },
    })).resolves.toBeNull()

    const panel = readFileSync('src/components/foreshadow/ForeshadowPanel.tsx', 'utf8')
    expect(panel).not.toContain('useAIStream')
    expect(panel).not.toContain('chat(')
    expect(panel).not.toContain('assembleContext(')
    expect(panel).not.toContain("target: 'foreshadows'")
    expect(panel).toContain('generateForeshadowSuggestionCandidateV1')
    expect(panel).toContain('adoptForeshadowSuggestionCandidateV1')
  })
})
