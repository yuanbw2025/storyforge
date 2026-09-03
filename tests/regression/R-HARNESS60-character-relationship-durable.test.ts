import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope } from '../../src/lib/types'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import {
  adoptCharacterRelationshipCandidateV1,
  type CharacterRelationshipAdoptionBoundaryV1,
  generateCharacterRelationshipCandidateV1,
  parseCharacterRelationshipCandidateDraftV1,
  readPendingCharacterRelationshipCandidateV1,
  rejectCharacterRelationshipCandidateV1,
} from '../../src/lib/agent/run/character-relationship-durable'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { assembleContext } from '../../src/lib/registry/assemble-context'

async function seed() {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: '关系提取', genre: 'fantasy', genres: ['fantasy'], status: 'drafting', description: '',
    targetWordCount: 80_000,createdAt: now, updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({
    projectId, code: `rel-${now}`, name: '潮钟世界', description: '', currentVersion: 1, createdAt: now, updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId, worldId, title: '关系提取', description: '', genres: ['fantasy'], status: 'drafting',
    targetWordCount: 80_000, createdAt: now, updatedAt: now,
  } as any) as number
  await db.projects.update(projectId, { activeWorldId: worldId, activeWorkId: workId, ownershipSchemaVersion: 1 })
  const worldGroupId = await db.worldGroups.add({ projectId, worldId, name: '主世界', order: 0, createdAt: now, updatedAt: now }) as number
  const outlineNodeId = await db.outlineNodes.add({
    projectId, workId, worldGroupId, parentId: null, type: 'chapter', title: '第一章',
    summary: '阿澜与钟叔在旧港结盟。', order: 0, createdAt: now, updatedAt: now,
  } as any) as number
  await db.chapters.add({
    projectId, workId, outlineNodeId, title: '第一章',
    content: '<p>阿澜把钥匙交给钟叔。钟叔答应与她共同守住潮门。</p>', wordCount: 24,
    status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now,
  } as any)
  const firstId = await db.characters.add({
    projectId, worldId, workId: null, homeWorldGroupId: worldGroupId, name: '阿澜', roleWeight: 'protagonist',
    moralAxis: 'neutral', orderAxis: 'neutral', shortDescription: '守门人', relationships: '', createdAt: now, updatedAt: now,
  } as any) as number
  const secondId = await db.characters.add({
    projectId, worldId, workId: null, homeWorldGroupId: worldGroupId, name: '钟叔', roleWeight: 'supporting',
    moralAxis: 'good', orderAxis: 'lawful', shortDescription: '老钟匠', relationships: '', createdAt: now, updatedAt: now,
  } as any) as number
  return {
    scope: { projectId, worldId, workId } satisfies WorkspaceScope,
    projectId, worldGroupId, firstId, secondId,
  }
}

function response(extra = '') {
  return JSON.stringify([{
    char1: '阿澜', char2: '钟叔', type: 'ally', label: '守门盟友',
    description: '两人共同守住潮门。', bidirectional: true, ...(extra ? { [extra]: true } : {}),
  }])
}

describe.sequential('R-HARNESS60 · 角色关系 durable 提取与采纳', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('Skill 只读登记上下文，生成候选后正式关系与角色字段均零写入', async () => {
    const fixture = await seed()
    expect(getAgentSkillV1('character.relationships')).toMatchObject({
      agentId: 'character', executionMode: 'relationships',
      contextSourceKeys: ['characters', 'characterRelations', 'outlineSummaries', 'writtenChapters'],
      writeTargets: expect.arrayContaining([expect.objectContaining({ table: 'characterRelations' })]),
    })
    const assembled = await assembleContext({
      projectId: fixture.projectId, scope: fixture.scope, worldGroupId: fixture.worldGroupId,
      sourceKeys: ['characters', 'characterRelations', 'outlineSummaries', 'writtenChapters'],
    })
    expect(assembled.text).toContain('阿澜')
    expect(assembled.text).toContain('旧港结盟')
    expect(assembled.text).toContain('共同守住潮门')
    const generated = await generateCharacterRelationshipCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, runAI: async () => response(),
    })
    expect(generated.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(generated.candidate.relations).toMatchObject([{ fromCharacterId: fixture.firstId, toCharacterId: fixture.secondId }])
    expect(await db.characterRelations.count()).toBe(0)
    expect((await db.characters.get(fixture.firstId))?.relationships).toBe('')
    expect(generated.snapshot.events.some(event => event.type === 'model.requested')).toBe(true)
    expect(generated.snapshot.events.some(event => event.type === 'adoption.committed')).toBe(false)
  })

  it('刷新恢复同一候选，作者确认后只经正式表写入并签发 terminal receipt', async () => {
    const fixture = await seed()
    const generated = await generateCharacterRelationshipCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, runAI: async () => response(),
    })
    const recovered = await readPendingCharacterRelationshipCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId,
    })
    expect(recovered?.snapshot.run.id).toBe(generated.snapshot.run.id)
    expect(recovered?.candidate).toEqual(generated.candidate)
    const adopted = await adoptCharacterRelationshipCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0],
    })
    expect(adopted.snapshot.projection.state).toBe('completed')
    expect(adopted.receiptHash).toHaveLength(64)
    expect(adopted.written).toBe(1)
    expect(await db.characterRelations.count()).toBe(1)
    expect((await db.characters.get(fixture.firstId))?.relationships).toContain('钟叔')
    expect((await db.characters.get(fixture.secondId))?.relationships).toContain('阿澜')
    await expect(readPendingCharacterRelationshipCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId,
    })).resolves.toBeNull()
  })

  it('角色或关系基线变化使候选 stale，不能覆盖当前正式状态', async () => {
    const fixture = await seed()
    const generated = await generateCharacterRelationshipCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, runAI: async () => response(),
    })
    await db.characters.update(fixture.firstId, { name: '阿澜·改', updatedAt: Date.now() + 1 })
    await expect(adoptCharacterRelationshipCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0],
    })).rejects.toThrow('基线已变化')
    expect(await db.characterRelations.count()).toBe(0)
    expect((await db.agentRuns.get(generated.snapshot.run.id))?.status).toBe('paused')
  })

  it('严格 parser 拒绝额外字段、非法枚举和非 JSON，不静默过滤协议错误', () => {
    expect(() => parseCharacterRelationshipCandidateDraftV1(response('extra'))).toThrow('字段不在允许闭集')
    expect(() => parseCharacterRelationshipCandidateDraftV1(response().replace('ally', 'unknown'))).toThrow('字段类型或枚举无效')
    expect(() => parseCharacterRelationshipCandidateDraftV1('这里是关系建议')).toThrow('不是有效 JSON')
  })

  it('只接受唯一精确角色名，不沿用姓氏截断或包含匹配猜测实体身份', async () => {
    const fixture = await seed()
    await expect(generateCharacterRelationshipCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId,
      runAI: async () => response().replace('阿澜', '澜'),
    })).rejects.toThrow('无法唯一精确匹配')
    expect(await db.characterRelations.count()).toBe(0)
  })

  it('作者放弃候选后不再恢复，也不写任何正式数据', async () => {
    const fixture = await seed()
    const generated = await generateCharacterRelationshipCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, runAI: async () => response(),
    })
    const rejected = await rejectCharacterRelationshipCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id })
    expect(rejected.projection.state).toBe('cancelled')
    expect(rejected.projection.steps['character:relationships'].status).toBe('failed')
    await expect(readPendingCharacterRelationshipCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId,
    })).resolves.toBeNull()
    expect(await db.characterRelations.count()).toBe(0)
  })

  it('旧面板直调与逐条写入旁路已下线，人工 CRUD 仍保留', () => {
    const source = readFileSync('src/components/relations/CharacterRelationPanel.tsx', 'utf8')
    expect(source).not.toContain('useAIStream')
    expect(source).not.toContain('createAISessionKey')
    expect(source).not.toContain('buildRelationExtractPrompt')
    expect(source).not.toContain('syncRelationToCharacterFields')
    expect(source).toContain('generateCharacterRelationshipCandidateV1')
    expect(source).toContain('adoptCharacterRelationshipCandidateV1')
    expect(source).toContain('await addRelation(relation)')
  })

  it('采纳八个持久化边界逐一中断均恢复同一 Run，且只产生一条正式关系', async () => {
    const boundaries: CharacterRelationshipAdoptionBoundaryV1[] = [
      'intent.checkpoint', 'confirmation.recorded', 'adoption.started', 'formal.written',
      'adoption.committed', 'step.succeeded', 'verification.started', 'verification.accepted',
    ]
    for (const boundary of boundaries) {
      await db.delete()
      await db.open()
      const fixture = await seed()
      const generated = await generateCharacterRelationshipCandidateV1({
        scope: fixture.scope, worldGroupId: fixture.worldGroupId, runAI: async () => response(),
      })
      await expect(adoptCharacterRelationshipCandidateV1({
        scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0],
        onDurableBoundary: reached => {
          if (reached === boundary) throw new Error(`interrupt:${boundary}`)
        },
      })).rejects.toThrow(`interrupt:${boundary}`)

      const recovered = await readPendingCharacterRelationshipCandidateV1({
        scope: fixture.scope, worldGroupId: fixture.worldGroupId,
      })
      if (boundary === 'verification.accepted') expect(recovered).toBeNull()
      else expect(recovered?.snapshot.run.id).toBe(generated.snapshot.run.id)
      const completed = await adoptCharacterRelationshipCandidateV1({
        scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0],
      })
      expect(completed.snapshot.projection.state, boundary).toBe('completed')
      expect(await db.characterRelations.count(), boundary).toBe(1)
      expect((await db.agentRuns.where('projectId').equals(fixture.projectId).toArray())
        .filter(run => run.contractJson.includes('character.relationships')), boundary).toHaveLength(1)
    }
  })

  it('未完成物理 ID 候选在项目导入后明确取消，不在新工作区复活', async () => {
    const fixture = await seed()
    await generateCharacterRelationshipCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, runAI: async () => response(),
    })
    const importedId = await importProjectJSON(await exportProjectJSON(fixture.projectId))
    const importedRuns = await db.agentRuns.where('projectId').equals(importedId).toArray()
    const imported = importedRuns.find(run => run.contractJson.includes('character.relationships'))!
    expect(imported.status).toBe('cancelled')
    expect(imported.terminalReceiptHash).toBeNull()
  })

  it('多世界候选只读取、匹配并写回当前世界组', async () => {
    const fixture = await seed()
    const otherGroupId = await db.worldGroups.add({
      projectId: fixture.projectId, worldId: fixture.scope.worldId, name: '支线世界', order: 1,
      createdAt: Date.now(), updatedAt: Date.now(),
    }) as number
    await db.characters.add({
      projectId: fixture.projectId, worldId: fixture.scope.worldId, workId: null,
      homeWorldGroupId: otherGroupId, name: '异界阿澜', roleWeight: 'supporting',
      moralAxis: 'neutral', orderAxis: 'neutral', shortDescription: '', relationships: '',
      createdAt: Date.now(), updatedAt: Date.now(),
    } as any)
    const otherOutlineNodeId = await db.outlineNodes.add({
      projectId: fixture.projectId, workId: fixture.scope.workId, worldGroupId: otherGroupId,
      parentId: null, type: 'chapter', title: '异界章', summary: '异界阿澜单独行动。', order: 1,
      createdAt: Date.now(), updatedAt: Date.now(),
    } as any) as number
    await db.chapters.add({
      projectId: fixture.projectId, workId: fixture.scope.workId, outlineNodeId: otherOutlineNodeId,
      title: '异界章', content: '<p>异界阿澜进入了不应泄漏的另一个世界。</p>', wordCount: 22,
      status: 'draft', order: 1, notes: '', createdAt: Date.now(), updatedAt: Date.now(),
    } as any)
    const generated = await generateCharacterRelationshipCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId,
      runAI: async messages => {
        const prompt = messages.map(message => message.content).join('\n')
        expect(prompt).not.toContain('异界阿澜')
        expect(prompt).not.toContain('不应泄漏')
        return response()
      },
    })
    await adoptCharacterRelationshipCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0],
    })
    expect((await db.characterRelations.toArray())).toHaveLength(1)
    expect((await db.characterRelations.toArray())[0].worldId).toBe(fixture.scope.worldId)
  })
})
