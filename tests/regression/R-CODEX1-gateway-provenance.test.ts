import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope } from '../../src/lib/types'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import {
  adoptCodexExtractionCandidateV1,
  generateCodexEnrichmentCandidateV1,
  generateCodexExtractionCandidateV1,
} from '../../src/lib/agent/run/codex-extraction-durable'
import { CANON_RESOURCE_PROVIDER_V1 } from '../../src/lib/context-gateway/canon-provider'
import { backfillResourceUidsV1 } from '../../src/lib/context-gateway/resource-identity'

const NOW = 1_788_500_000_000

async function seed(): Promise<{
  scope: WorkspaceScope
  categoryId: number
  worldGroupId: number
}> {
  const projectId = await db.projects.add({
    name: '雾港族谱', genre: 'fantasy', genres: ['fantasy'], description: '', status: 'drafting',
    targetWordCount: 300_000,
    enableMultiWorld: true, createdAt: NOW, updatedAt: NOW,
  } as never) as number
  const worldId = await db.worlds.add({
    projectId, code: 'codex1-world', name: '雾港世界', description: '', currentVersion: 1,
    createdAt: NOW, updatedAt: NOW,
  }) as number
  const workId = await db.works.add({
    projectId, worldId, title: '雾港族谱', description: '', genres: ['fantasy'], status: 'drafting',
    targetWordCount: 300_000, createdAt: NOW, updatedAt: NOW,
  } as never) as number
  await db.projects.update(projectId, { activeWorldId: worldId, activeWorkId: workId, ownershipSchemaVersion: 1 })
  const worldGroupId = await db.worldGroups.add({
    projectId, worldId, name: '主雾港', order: 0, createdAt: NOW, updatedAt: NOW,
  } as never) as number
  await db.worldviews.add({
    projectId, worldId, worldGroupId,
    races: '潮裔以雾铃记录成年誓言，港民则以航图继承家名。',
    createdAt: NOW, updatedAt: NOW,
  } as never)
  const categoryId = await db.codexCategories.add({
    projectId, worldId, domain: 'humanity', parentId: null, name: '种族民族', icon: '🧬',
    builtInKey: 'race', fieldSchema: JSON.stringify([{ key: 'rite', label: '成年礼', type: 'text' }]),
    hidden: false, order: 0, worldGroupId: null, createdAt: NOW, updatedAt: NOW,
  } as never) as number
  await backfillResourceUidsV1(projectId)
  return { scope: { projectId, worldId, workId }, categoryId, worldGroupId }
}

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(async () => { await db.delete() })

describe.sequential('CODEX-1 · Gateway resources and adopted provenance', () => {
  it('提取与补全只声明 Gateway 目录，不保留世界观/角色固定来源大包', () => {
    expect(getAgentSkillV1('world-origin.codex-extract')).toMatchObject({
      contextSourceKeys: ['manualText', 'ragSelection'],
      contextGateway: { rollout: 'required', allowedResourceKinds: ['codex-entry'] },
    })
    expect(getAgentSkillV1('world-origin.codex-enrich')).toMatchObject({
      contextSourceKeys: ['ragSelection'],
      contextGateway: { rollout: 'required' },
    })
  })

  it('分类在多世界 scope 可见，采纳词条和自定义字段拥有稳定资源地址', async () => {
    const fixture = await seed()
    const extracted = await generateCodexExtractionCandidateV1({
      scope: fixture.scope,
      request: {
        categoryId: fixture.categoryId, worldGroupId: fixture.worldGroupId,
        sourceText: '潮裔以雾铃记录成年誓言。', supplementTags: false,
      },
      runAI: async () => JSON.stringify([{
        name: '潮裔', icon: '🔔', summary: '以雾铃记录誓言的民族。',
        description: '潮裔以雾铃记录成年誓言。', fields: { rite: '雾铃誓言' },
        tags: [], importance: 4, evidenceQuotes: ['潮裔以雾铃记录成年誓言'],
        provenance: 'verbatim-extraction',
      }]),
    })
    await adoptCodexExtractionCandidateV1({
      scope: fixture.scope, runId: extracted.snapshot.run.id, selectedIndexes: [0],
    })

    const scope = { ...fixture.scope, worldGroupId: fixture.worldGroupId }
    const page = await CANON_RESOURCE_PROVIDER_V1.listMetadata({ scope, kinds: ['codex-entry'], limit: 100 })
    expect(page.items.some(item => item.title.includes('词条分类') && item.title.includes('种族民族'))).toBe(true)
    const custom = page.items.find(item => item.resourceKey.includes(':field:custom.rite'))
    expect(custom?.title).toContain('成年礼')
    expect(custom?.authority).toBe('author-canon')
  })

  it('逐字抽取和 AI 补全分两次确认，正式词条保留不同来源与冻结 Run/候选证据', async () => {
    const fixture = await seed()
    const extraction = await generateCodexExtractionCandidateV1({
      scope: fixture.scope,
      request: {
        categoryId: fixture.categoryId, worldGroupId: fixture.worldGroupId,
        sourceText: '潮裔以雾铃记录成年誓言。', supplementTags: false,
      },
      runAI: async () => JSON.stringify([{
        name: '潮裔', icon: '🔔', summary: '雾铃民族。', description: '潮裔以雾铃记录成年誓言。',
        fields: { rite: '雾铃誓言' }, tags: [], importance: 4,
        evidenceQuotes: ['潮裔以雾铃记录成年誓言'], provenance: 'verbatim-extraction',
      }]),
    })
    await adoptCodexExtractionCandidateV1({
      scope: fixture.scope, runId: extraction.snapshot.run.id, selectedIndexes: [0],
    })

    const enrichment = await generateCodexEnrichmentCandidateV1({
      scope: fixture.scope,
      request: {
        categoryId: fixture.categoryId, worldGroupId: fixture.worldGroupId,
        authorRequest: '增加一个负责见证两族盟约的新群体。', supplementTags: false,
      },
      runAI: async messages => {
        expect(messages.map(message => message.content).join('\n')).toContain('潮裔以雾铃记录成年誓言')
        return JSON.stringify([{
          name: '雾誓官', icon: '📜', summary: '见证盟约的中立群体。',
          description: '雾誓官保管双方盟约并主持公开复核。', fields: { rite: '双铃复核' },
          tags: [], importance: 3, evidenceQuotes: [], provenance: 'ai-created-suggestion',
        }])
      },
    })
    await adoptCodexExtractionCandidateV1({
      scope: fixture.scope, runId: enrichment.snapshot.run.id, selectedIndexes: [0],
    })

    const rows = await db.codexEntries.orderBy('order').toArray()
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      name: '潮裔', origin: 'verbatim-extraction',
      sourceEvidenceQuotes: JSON.stringify(['潮裔以雾铃记录成年誓言']),
      producerRunId: extraction.snapshot.run.id,
      producerCandidateHash: extraction.candidate.candidateHash,
    })
    expect(rows[0].sourceContentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(rows[1]).toMatchObject({
      name: '雾誓官', origin: 'ai-created-suggestion', sourceEvidenceQuotes: '[]',
      producerRunId: enrichment.snapshot.run.id,
      producerCandidateHash: enrichment.candidate.candidateHash,
    })
    expect(rows[1].sourceContentHash).toBe(enrichment.candidate.plan.gatewayPacket.contentHash)
  })
})
