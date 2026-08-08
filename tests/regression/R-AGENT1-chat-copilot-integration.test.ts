import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prepareWorldOriginCopilot } from '../../src/lib/agent/world-origin-copilot'
import { adoptGenerationNodeOutput } from '../../src/lib/generation/generation-node'
import { db } from '../../src/lib/db/schema'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'

async function projectTableCounts() {
  return Object.fromEntries(await Promise.all(PROJECT_TABLES.map(async spec => (
    [spec.name, await spec.table.count()] as const
  ))))
}

describe('AGENT-1 · ChatCopilot 注册表真实链路', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })
  afterEach(() => db.close())

  it('经只读工具装配上下文，并只通过 adopt 更新当前世界的 worldOrigin', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({
      name: '潮汐纪元',
      genre: 'fantasy',
      genres: ['fantasy'],
      status: 'drafting',
      description: '盐海文明的兴衰',
      targetWordCount: 100_000,
      enableMultiWorld: false,
      createdAt: now,
      updatedAt: now,
    }) as number
    const worldviewId = await db.worldviews.add({
      projectId,
      geography: '',
      history: '',
      society: '',
      culture: '',
      economy: '',
      rules: '',
      summary: '',
      worldOrigin: '旧世界由潮汐孕育。',
      worldGroupId: null,
      createdAt: now,
      updatedAt: now,
    }) as number
    await ensureWorkspaceOwnership(projectId)
    const before = await projectTableCounts()

    const prepared = await prepareWorldOriginCopilot({
      projectId,
      worldGroupId: null,
      authorRequest: '补充盐城文明的起点',
    })

    expect(prepared.contextSources).toContain('projectStatus')
    expect(prepared.contextSources).toContain('worldview')
    expect(prepared.contextEvidence.inputState).toMatchObject({
      state: 'partial',
      handling: 'reference-and-create',
    })
    expect(prepared.prepared.messages.some(message => message.content.includes('partial / reference-and-create'))).toBe(true)
    expect(prepared.prepared.messages.some(message => message.content.includes('旧世界由潮汐孕育'))).toBe(true)

    const adopted = await adoptGenerationNodeOutput(
      prepared.node,
      '潮汐退去后的第一年，盐城先民在海床上建立了最初的观潮塔。',
    )
    expect(adopted.adopted).toBe(true)
    expect((await db.worldviews.get(worldviewId))?.worldOrigin)
      .toBe('潮汐退去后的第一年，盐城先民在海床上建立了最初的观潮塔。')

    const after = await projectTableCounts()
    for (const table of PROJECT_TABLES) {
      expect(after[table.name], table.name).toBe(before[table.name])
    }
  })

  it('多世界项目未选世界时在读取和生成前停止', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({
      name: '多世界项目',
      genre: 'fantasy',
      genres: ['fantasy'],
      status: 'drafting',
      description: '',
      targetWordCount: 100_000,
      enableMultiWorld: true,
      createdAt: now,
      updatedAt: now,
    }) as number

    await expect(prepareWorldOriginCopilot({
      projectId,
      worldGroupId: null,
      authorRequest: '生成世界来源',
    })).rejects.toThrow('必须先选择世界')
  })
})
