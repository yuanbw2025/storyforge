import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  buildCharacterRevisionSnapshot,
  effectiveProtectedThrough,
  formatCharacterRevisionScope,
  parseCharacterRevisionOutput,
  type CharacterRevisionScopeInput,
} from '../../src/lib/story-planning/character-revision'
import { prepareCharacterRevisionCopilotV1 } from '../../src/lib/agent/character-revision-copilot'

const now = 1_800_000_000_000

async function seedProject(chapterCount = 6, writtenCount = 2) {
  const projectId = await db.projects.add({
    name: '中途重规划测试',
    genre: 'xuanhuan',
    genres: ['xuanhuan'],
    status: 'ongoing',
    description: '',
    targetWordCount: 1_000_000,
    createdAt: now,
    updatedAt: now,
  } as any)
  const volumeId = await db.outlineNodes.add({
    projectId,
    parentId: null,
    type: 'volume',
    title: '第一卷',
    summary: '守城主线',
    order: 0,
    createdAt: now,
    updatedAt: now,
  } as any)
  const nodeIds: number[] = []
  const chapterIds: number[] = []
  for (let index = 0; index < chapterCount; index++) {
    const ordinal = index + 1
    const nodeId = await db.outlineNodes.add({
      projectId,
      parentId: volumeId,
      type: 'chapter',
      title: `第${ordinal}章`,
      summary: `原摘要${ordinal}`,
      order: index,
      createdAt: now,
      updatedAt: now + ordinal,
    } as any)
    nodeIds.push(nodeId)
    if (index < writtenCount || index === writtenCount) {
      const written = index < writtenCount
      chapterIds.push(await db.chapters.add({
        projectId,
        outlineNodeId: nodeId,
        title: `第${ordinal}章`,
        content: written ? `<p>第${ordinal}章不可覆盖的正文</p>` : '',
        wordCount: written ? 12 : 0,
        status: written ? 'draft' : 'outline',
        order: index,
        notes: '',
        ...(ordinal === 2 ? {
          summary: '主角已经立誓守城',
          summarySourceTextHash: 'verified-for-test',
        } : {}),
        createdAt: now,
        updatedAt: now,
      } as any))
    }
  }
  return { projectId, volumeId, nodeIds, chapterIds }
}

function scope(overrides: Partial<CharacterRevisionScopeInput> = {}): CharacterRevisionScopeInput {
  return {
    changeType: 'add-character',
    characterId: null,
    characterName: '沈砚',
    changeDescription: '新增谋士沈砚，在守城中途加入主线',
    protectedThroughOrdinal: 2,
    transitionChapterCount: 1,
    strategy: 'balanced',
    anchorNodeIds: [],
    extraRequirements: '不得推翻主角已立下的守城誓言',
    ...overrides,
  }
}

function aiPlan(nodeIds: number[]) {
  return JSON.stringify({
    changeSummary: '沈砚从第三章进入守城主线',
    scopeSummary: '前两章保护，第三章过渡，之后可调整',
    affectedWrittenChapters: [{
      ordinal: 2,
      title: '第2章',
      severity: 'medium',
      reason: '守城誓言构成新角色切入边界',
      evidenceQuotes: ['第2章不可覆盖的正文'],
      recommendation: 'protect',
    }],
    immutableFacts: [{
      statement: '主角已经决定守城',
      sourceChapterOrdinal: 2,
      evidenceQuote: '第2章不可覆盖的正文',
    }],
    conflicts: [{
      severity: 'low',
      source: '大纲',
      title: '谋士尚未铺垫',
      reason: '第三章需要自然切入',
      evidenceQuote: '',
    }],
    foreshadowSuggestions: [{
      chapterOrdinal: 2,
      title: '第2章',
      suggestion: '人工考虑补一句远方来信，不自动改正文',
    }],
    mainPlotSuggestion: '无需修改主线，只补充沈砚的参与方式',
    options: [
      {
        id: 'light',
        intensity: 'light',
        label: '轻量融入',
        summary: '只在第四章增加会面',
        risks: ['戏份偏少'],
        patches: [{
          outlineNodeId: nodeIds[3],
          proposedTitle: '第4章',
          proposedSummary: '沈砚与主角首次会面',
          reason: '低成本切入',
        }],
      },
      {
        id: 'balanced',
        intensity: 'balanced',
        label: '中度改线',
        summary: '第三章铺垫，第四章加入',
        risks: ['需要两章过渡'],
        patches: [
          {
            outlineNodeId: nodeIds[0],
            proposedTitle: '篡改已写章',
            proposedSummary: '不应采纳',
            reason: '越界 patch',
          },
          {
            outlineNodeId: nodeIds[2],
            proposedTitle: '第3章 新的来客',
            proposedSummary: '城外传来沈砚将至的消息',
            reason: '近期过渡',
          },
        ],
      },
      {
        id: 'deep',
        intensity: 'deep',
        label: '深度重构',
        summary: '重排后续谋略线',
        risks: ['改动较大'],
        patches: [{
          outlineNodeId: nodeIds[4],
          proposedTitle: '锚点被改名',
          proposedSummary: '保留事件但调整参与者',
          reason: '扩大角色作用',
        }],
      },
    ],
    warnings: [],
  })
}

describe('R-CF12 · 角色变化影响分析与受控大纲 patch', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    db.close()
  })

  it('按规范章序划分已写保护区、近期过渡区和未写规划区', async () => {
    const { projectId, nodeIds } = await seedProject()
    const snapshot = await buildCharacterRevisionSnapshot(projectId)
    expect(snapshot).toMatchObject({
      writtenChapterCount: 2,
      plannedChapterCount: 6,
      lastWrittenOrdinal: 2,
      hasChapterMemory: true,
    })
    expect(snapshot.chapters.map(chapter => chapter.outlineNodeId)).toEqual(nodeIds)
    expect(effectiveProtectedThrough(snapshot, 1)).toBe(2)

    const formatted = formatCharacterRevisionScope(snapshot, scope({
      protectedThroughOrdinal: 1,
      anchorNodeIds: [nodeIds[4]],
    }))
    expect(formatted).toContain('硬保护区：第 1-2 章')
    expect(formatted).toContain('近期过渡区：第 3-3 章')
    expect(formatted).toContain(`[node:${nodeIds[4]}]`)
    expect(formatted).toContain('必保留锚点')
  })

  it('解析边界拒绝已写章 patch 和锚点改名，并保留三档方案与警告', async () => {
    const { projectId, nodeIds } = await seedProject()
    const snapshot = await buildCharacterRevisionSnapshot(projectId)
    const input = scope({ anchorNodeIds: [nodeIds[4]] })
    const parsed = parseCharacterRevisionOutput(aiPlan(nodeIds), snapshot, input)
    expect(parsed?.options).toHaveLength(3)
    expect(parsed?.options[0].patches).toHaveLength(1)
    expect(parsed?.options[1].patches.map(patch => patch.outlineNodeId)).toEqual([nodeIds[2]])
    expect(parsed?.options[2].patches).toHaveLength(0)
    expect(parsed?.warnings.join('\n')).toContain('已写保护区')
    expect(parsed?.warnings.join('\n')).toContain('锚点')
    expect(parsed?.foreshadowSuggestions[0].writtenRegion).toBe(true)
  })

  it('AI 请求通过 CONTEXT_SOURCES 装配真实进度和作者边界，不读取平行事实系统', async () => {
    const { projectId, nodeIds } = await seedProject()
    await db.storyCores.add({
      projectId,
      mainPlot: '主角守住孤城',
      createdAt: now,
      updatedAt: now,
    } as any)
    const prepared = await prepareCharacterRevisionCopilotV1({
      projectId,
      worldGroupId: null,
      request: {
        planId: null,
        ...scope({ anchorNodeIds: [nodeIds[5]] }),
      },
      authorRequest: '分析角色变更并生成三档可审查方案',
    })
    const user = prepared.prepared.messages.find(message => message.role === 'user')?.content ?? ''
    expect(prepared.contextSources).toContain('manualText')
    expect(prepared.contextSources).toContain('storyCore')
    expect(user).toContain('主角守住孤城')
    expect(user).toContain('硬保护区：第 1-2 章')
    expect(user).toContain(`[node:${nodeIds[5]}]`)
    expect(user).toContain('三档方案都必须存在')
  })
})
