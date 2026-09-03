import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope } from '../../src/lib/types'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { backfillResourceUidsV1 } from '../../src/lib/context-gateway/resource-identity'
import {
  adoptCodexExtractionCandidateV1,
  generateCodexEnrichmentCandidateV1,
  generateCodexExtractionCandidateV1,
  readPendingCodexExtractionCandidateV1,
} from '../../src/lib/agent/run/codex-extraction-durable'

const NOW = 1_788_400_000_000

async function seed(): Promise<{
  scope: WorkspaceScope
  categoryId: number
  worldGroupId: number
}> {
  const projectId = await db.projects.add({
    name: '潮族志', genre: 'fantasy', genres: ['fantasy'], description: '', status: 'drafting',
    targetWordCount: 300_000,
    enableMultiWorld: true, createdAt: NOW, updatedAt: NOW,
  } as never) as number
  const worldId = await db.worlds.add({
    projectId, code: 'race5-world', name: '潮界', description: '', currentVersion: 1,
    createdAt: NOW, updatedAt: NOW,
  }) as number
  const workId = await db.works.add({
    projectId, worldId, title: '潮族志', description: '', genres: ['fantasy'], status: 'drafting',
    targetWordCount: 300_000, createdAt: NOW, updatedAt: NOW,
  } as never) as number
  await db.projects.update(projectId, { activeWorldId: worldId, activeWorkId: workId, ownershipSchemaVersion: 1 })
  const worldGroupId = await db.worldGroups.add({
    projectId, worldId, name: '主潮界', order: 0, createdAt: NOW, updatedAt: NOW,
  } as never) as number
  await db.worldviews.add({
    projectId, worldId, worldGroupId,
    races: '潮民以七次退潮为成年礼，岸上钟民以师徒谱系继承公民资格。两族共用祭潮港，却因航路继承长期冲突。',
    createdAt: NOW, updatedAt: NOW,
  } as never)
  const categoryId = await db.codexCategories.add({
    projectId, worldId, domain: 'humanity', parentId: null, name: '种族民族', icon: '🧬',
    builtInKey: 'race', fieldSchema: JSON.stringify([{ key: 'custom', label: '风俗', type: 'text' }]),
    hidden: false, order: 0, worldGroupId: null, createdAt: NOW, updatedAt: NOW,
  } as never) as number
  await backfillResourceUidsV1(projectId)
  return { scope: { projectId, worldId, workId }, categoryId, worldGroupId }
}

function extracted(name = '潮民') {
  return {
    name, icon: '🌊', summary: '以退潮次数认定成年的民族。',
    description: '潮民以七次退潮为成年礼。', fields: { custom: '七次退潮成年礼' },
    tags: ['潮民', '成年礼'], importance: 4,
    evidenceQuotes: ['潮民以七次退潮为成年礼'], provenance: 'verbatim-extraction',
  }
}

function enriched() {
  return {
    name: '听潮使', icon: '🐚', summary: '在两族间仲裁航路继承的仪式群体。',
    description: '听潮使将争议航路封存一个潮季，逼使两族在断航代价下谈判。',
    fields: { custom: '断航仲裁' }, tags: ['航路', '仲裁'], importance: 4,
    evidenceQuotes: [], provenance: 'ai-created-suggestion',
  }
}

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(async () => { await db.delete() })

describe.sequential('RACE-5 · Codex extraction/enrichment separation', () => {
  it('抽取必须有原文逐字证据，短文可以合法返回空候选', async () => {
    const fixture = await seed()
    await expect(generateCodexExtractionCandidateV1({
      scope: fixture.scope,
      request: {
        categoryId: fixture.categoryId, worldGroupId: fixture.worldGroupId,
        sourceText: '潮民以七次退潮为成年礼。', supplementTags: true,
      },
      runAI: async () => JSON.stringify([{ ...extracted(), evidenceQuotes: [] }]),
    })).rejects.toThrow('缺少逐字抽取来源')

    const empty = await generateCodexExtractionCandidateV1({
      scope: fixture.scope,
      request: {
        categoryId: fixture.categoryId, worldGroupId: fixture.worldGroupId,
        sourceText: '他们很古老。', supplementTags: true,
      },
      runAI: async () => '[]',
    })
    expect(empty.candidate.entries).toEqual([])
    expect(await db.codexEntries.count()).toBe(0)
  })

  it('补全使用独立 Skill/Prompt/候选，读到世界 Canon 但不伪装成原文抽取', async () => {
    const fixture = await seed()
    expect(getAgentSkillV1('world-origin.codex-enrich')).toMatchObject({
      executionMode: 'codex-enrich',
      contextSourceKeys: ['ragSelection'],
      contextGateway: { rollout: 'required', providerSourceKeys: ['ragSelection'] },
      writeTargets: [{ table: 'codexEntries' }],
    })
    let prompt = ''
    const generated = await generateCodexEnrichmentCandidateV1({
      scope: fixture.scope,
      request: {
        categoryId: fixture.categoryId, worldGroupId: fixture.worldGroupId,
        authorRequest: '补充一个能够推动两族冲突的中立群体。', supplementTags: true,
      },
      runAI: async messages => {
        prompt = messages.map(message => message.content).join('\n')
        return JSON.stringify([enriched()])
      },
    })
    expect(prompt).toContain('潮民以七次退潮为成年礼')
    expect(prompt).toContain('AI 新建建议')
    expect(generated.candidate.plan.request.operation).toBe('enrich')
    expect(generated.candidate.entries[0]).toMatchObject({
      name: '听潮使', provenance: 'ai-created-suggestion', evidenceQuotes: [],
    })
    expect(await db.codexEntries.count()).toBe(0)
    expect((await readPendingCodexExtractionCandidateV1({
      scope: fixture.scope, categoryId: fixture.categoryId,
      worldGroupId: fixture.worldGroupId, operation: 'enrich',
    }))?.candidate.candidateHash).toBe(generated.candidate.candidateHash)
    expect(await readPendingCodexExtractionCandidateV1({
      scope: fixture.scope, categoryId: fixture.categoryId,
      worldGroupId: fixture.worldGroupId, operation: 'extract',
    })).toBeNull()

    const adopted = await adoptCodexExtractionCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0],
    })
    expect(adopted.written).toBe(1)
    expect((await db.codexEntries.toArray()).map(row => row.name)).toEqual(['听潮使'])
  })

  it('补全候选在世界 Canon 变化后 stale，不会覆盖作者的新基线', async () => {
    const fixture = await seed()
    const generated = await generateCodexEnrichmentCandidateV1({
      scope: fixture.scope,
      request: {
        categoryId: fixture.categoryId, worldGroupId: fixture.worldGroupId,
        authorRequest: '补充中立群体。', supplementTags: true,
      },
      runAI: async () => JSON.stringify([enriched()]),
    })
    const worldview = await db.worldviews.where('projectId').equals(fixture.scope.projectId).first()
    await db.worldviews.update(worldview!.id!, {
      races: '作者已改为山民与林民的冲突。', updatedAt: NOW + 1,
    })
    await expect(adoptCodexExtractionCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0],
    })).rejects.toThrow('已变化')
    expect(await db.codexEntries.count()).toBe(0)
  })
})
