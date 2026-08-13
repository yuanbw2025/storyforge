import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope } from '../../src/lib/types'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { parseCodexEntriesStrictV1 } from '../../src/lib/ai/adapters/structured-extract-adapter'
import * as codexAdapter from '../../src/lib/ai/adapters/structured-extract-adapter'
import {
  abandonCodexExtractionV1,
  adoptCodexExtractionCandidateV1,
  generateCodexExtractionCandidateV1,
  readPendingCodexExtractionCandidateV1,
  readRecoverableCodexExtractionV1,
  resumeCodexExtractionCandidateV1,
  type CodexExtractionAdoptionBoundaryV1,
} from '../../src/lib/agent/run/codex-extraction-durable'

async function seed(suffix = '') {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: `词条拆分${suffix}`, genre: 'fantasy', genres: ['fantasy'], status: 'drafting',
    description: '', targetWordCount: 80_000, worldCode: `codex-${now}-${suffix}`,
    worldVersion: 1, enableMultiWorld: true, createdAt: now, updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({
    projectId, code: `codex-${now}-${suffix}`, name: '曜月世界', description: '', currentVersion: 1,
    createdAt: now, updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId, worldId, title: `潮汐纪${suffix}`, description: '', genres: ['fantasy'], status: 'drafting',
    targetWordCount: 80_000, createdAt: now, updatedAt: now,
  } as any) as number
  await db.projects.update(projectId, { activeWorldId: worldId, activeWorkId: workId, ownershipSchemaVersion: 1 })
  const worldGroupId = await db.worldGroups.add({
    projectId, worldId, name: '曜月界', description: '', type: 'primary', icon: '🌙', order: 0,
    createdAt: now, updatedAt: now,
  } as any) as number
  const categoryId = await db.codexCategories.add({
    projectId, worldId, domain: 'natural', parentId: null, name: '灵植草药', icon: '🌿', builtInKey: 'herb',
    fieldSchema: JSON.stringify([{ key: 'habitat', label: '生境', type: 'text' }]), hidden: false,
    order: 0, worldGroupId: null, createdAt: now, updatedAt: now,
  } as any) as number
  const existingId = await db.codexEntries.add({
    projectId, worldId, worldGroupId, categoryId, name: '旧潮草', icon: '🌿', summary: '旧有词条',
    description: '生于旧港。', fields: JSON.stringify({ habitat: '旧港' }), refs: '{}', tags: '[]',
    importance: 1, order: 0, createdAt: now, updatedAt: now,
  } as any) as number
  return {
    scope: { projectId, worldId, workId } satisfies WorkspaceScope,
    projectId, worldId, workId, worldGroupId, categoryId, existingId,
  }
}

function entry(name: string, habitat = '月潮湿地') {
  return {
    name, icon: '🌱', summary: `${name}会随月潮发光。`, description: `${name}只在退潮后成熟。`,
    fields: { habitat }, tags: ['月潮', '灵植'], importance: 3,
  }
}

function response(...entries: ReturnType<typeof entry>[]) {
  return JSON.stringify(entries)
}

function request(fixture: Awaited<ReturnType<typeof seed>>, sourceText = '月栖花生于月潮湿地，只在退潮后成熟。') {
  return {
    categoryId: fixture.categoryId,
    worldGroupId: fixture.worldGroupId,
    sourceText,
    supplementTags: true,
  }
}

describe.sequential('R-HARNESS70 · Codex 词条 durable 分块抽取与原子采纳', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })

  it('三注册表闭合，登记来源、分类 schema 与既有词条进入模型，候选前零正式写入', async () => {
    expect(CONTEXT_SOURCE_BY_KEY.get('codexExtractionBaseline')).toMatchObject({ scope: 'world', ownerFrom: 'world' })
    expect(PROJECT_TABLES.find(item => item.name === 'codexEntries')).toMatchObject({ exportable: true, worldScoped: true })
    expect(getAgentSkillV1('world-origin.codex-extract')).toMatchObject({
      agentId: 'world-origin', executionMode: 'codex-extract',
      contextSourceKeys: ['manualText', 'codexExtractionBaseline'],
      writeTargets: [{ table: 'codexEntries' }],
    })
    const fixture = await seed()
    const generated = await generateCodexExtractionCandidateV1({
      scope: fixture.scope, request: request(fixture),
      runAI: async messages => {
        const prompt = messages.map(message => message.content).join('\n')
        expect(prompt).toContain('灵植草药')
        expect(prompt).toContain('habitat')
        expect(prompt).toContain('旧潮草')
        expect(prompt).toContain('月栖花生于月潮湿地')
        return response(entry('月栖花'))
      },
    })
    expect(generated.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(generated.candidate.entries.map(item => item.name)).toEqual(['月栖花'])
    expect(await db.codexEntries.where('projectId').equals(fixture.projectId).count()).toBe(1)
  })

  it('长来源安全续跑只调用剩余分块，候选刷新恢复且作者子集确认后才写正式词条', async () => {
    const fixture = await seed()
    const longText = `月栖花生于月潮湿地。${'潮声回旋。'.repeat(1_200)}星露藤只在退潮后成熟。`
    const calls: number[] = []
    await expect(generateCodexExtractionCandidateV1({
      scope: fixture.scope, request: request(fixture, longText),
      runAI: async (_messages, index) => { calls.push(index); return response(entry('月栖花')) },
      onDurableBoundary: (boundary, _snapshot, index) => {
        if (boundary === 'chunk.checkpoint' && index === 0) throw new Error('interrupt:first-chunk')
      },
    })).rejects.toThrow('interrupt:first-chunk')
    expect(calls).toEqual([0])
    const recovery = await readRecoverableCodexExtractionV1({ scope: fixture.scope })
    expect(recovery).toMatchObject({ nextCallIndex: 1, safeToResume: true })
    const resumedCalls: number[] = []
    const resumed = await resumeCodexExtractionCandidateV1({
      scope: fixture.scope, runId: recovery!.snapshot.run.id,
      runAI: async (_messages, index) => {
        resumedCalls.push(index)
        return response(entry(index % 2 ? '星露藤' : '潮眠苔'))
      },
    })
    expect(resumedCalls).not.toContain(0)
    const pending = await readPendingCodexExtractionCandidateV1({ scope: fixture.scope })
    expect(pending?.candidate).toEqual(resumed.candidate)
    const adopted = await adoptCodexExtractionCandidateV1({
      scope: fixture.scope, runId: resumed.snapshot.run.id, selectedIndexes: [1],
    })
    expect(adopted.snapshot.projection.state).toBe('completed')
    const names = (await db.codexEntries.where('projectId').equals(fixture.projectId).toArray()).map(row => row.name)
    expect(names).toEqual(['旧潮草', resumed.candidate.entries[1].name])
  })

  it('严格协议拒绝围栏、额外字段、未知 schema、类型修复、重复名和非法 importance', () => {
    const valid = entry('月栖花')
    expect(() => parseCodexEntriesStrictV1(`\`\`\`json\n${response(valid)}\n\`\`\``, ['habitat'])).toThrow('严格 JSON')
    expect(() => parseCodexEntriesStrictV1(JSON.stringify([{ ...valid, extra: true }]), ['habitat'])).toThrow('字段')
    expect(() => parseCodexEntriesStrictV1(JSON.stringify([{ ...valid, fields: { unknown: '值' } }]), ['habitat'])).toThrow('未登记字段')
    expect(() => parseCodexEntriesStrictV1(JSON.stringify([{ ...valid, tags: '月潮' }]), ['habitat'])).toThrow('类型')
    expect(() => parseCodexEntriesStrictV1(JSON.stringify([valid, valid]), ['habitat'])).toThrow('名称重复')
    expect(() => parseCodexEntriesStrictV1(JSON.stringify([{ ...valid, importance: 9 }]), ['habitat'])).toThrow('范围')
    expect(() => parseCodexEntriesStrictV1(JSON.stringify([{ ...valid, summary: '' }]), ['habitat'])).toThrow('范围')
    expect(() => parseCodexEntriesStrictV1(JSON.stringify([{ ...valid, fields: { tier: '越界' } }]), [
      { key: 'tier', label: '品级', type: 'select', options: ['凡品', '灵品'] },
    ])).toThrow('登记选项')
    expect(() => parseCodexEntriesStrictV1(JSON.stringify([{ ...valid, fields: { age: '千年' } }]), [
      { key: 'age', label: '年份', type: 'number' },
    ])).toThrow('数值字段')
    expect(() => parseCodexEntriesStrictV1(JSON.stringify([{ ...valid, fields: { origin: '月港' } }]), [
      { key: 'origin', label: '来源', type: 'ref' },
    ])).toThrow('不得伪造引用')
  })

  it('模型重复已有词条或前置分块候选时整次失败，不静默去重', async () => {
    const existing = await seed('existing-name')
    await expect(generateCodexExtractionCandidateV1({
      scope: existing.scope, request: request(existing),
      runAI: async () => response(entry('旧潮草')),
    })).rejects.toThrow('重复输出已有词条')

    const chunks = await seed('chunk-duplicate')
    const source = `月栖花生于月潮湿地。${'潮声回旋。'.repeat(1_200)}月栖花在退潮后成熟。`
    await expect(generateCodexExtractionCandidateV1({
      scope: chunks.scope, request: request(chunks, source),
      runAI: async () => response(entry('月栖花')),
    })).rejects.toThrow('前置分块候选')
    expect(await db.codexEntries.where('projectId').equals(chunks.projectId).count()).toBe(1)
  })

  it('冻结标签选项是输出协议的一部分，模型不得擅自增删标签', async () => {
    const fixture = await seed('tag-policy')
    await expect(generateCodexExtractionCandidateV1({
      scope: fixture.scope,
      request: { ...request(fixture), supplementTags: false },
      runAI: async () => response(entry('月栖花')),
    })).rejects.toThrow('标签数量')
    await expect(generateCodexExtractionCandidateV1({
      scope: fixture.scope,
      request: request(fixture),
      runAI: async () => response({ ...entry('星露藤'), tags: [] }),
    })).rejects.toThrow('标签数量')
  })

  it('模型结果未知不自动重试；候选事件与 checkpoint 之间中断可重建同一候选', async () => {
    const unknown = await seed('unknown')
    let calls = 0
    await expect(generateCodexExtractionCandidateV1({
      scope: unknown.scope, request: request(unknown), runAI: async () => { calls++; throw new Error('provider-lost') },
    })).rejects.toThrow('provider-lost')
    expect(calls).toBe(1)
    expect((await readRecoverableCodexExtractionV1({ scope: unknown.scope }))?.safeToResume).toBe(false)

    const interrupted = await seed('candidate')
    await expect(generateCodexExtractionCandidateV1({
      scope: interrupted.scope, request: request(interrupted), runAI: async () => response(entry('月栖花')),
      onDurableBoundary: boundary => { if (boundary === 'candidate.persisted') throw new Error('interrupt:candidate') },
    })).rejects.toThrow('interrupt:candidate')
    expect((await readPendingCodexExtractionCandidateV1({ scope: interrupted.scope }))?.candidate.entries).toHaveLength(1)
  })

  it('零候选也可由作者确认并生成零写入终态回执', async () => {
    const fixture = await seed('empty')
    const generated = await generateCodexExtractionCandidateV1({
      scope: fixture.scope, request: request(fixture), runAI: async () => response(),
    })
    expect(generated.candidate.entries).toEqual([])
    const completed = await adoptCodexExtractionCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [],
    })
    expect(completed).toMatchObject({ written: 0 })
    expect(completed.snapshot.projection.state).toBe('completed')
    expect(await db.codexEntries.where('projectId').equals(fixture.projectId).count()).toBe(1)
  })

  it.each([
    ['来源请求', async (fixture: Awaited<ReturnType<typeof seed>>) => fixture],
    ['分类 schema', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      await db.codexCategories.update(fixture.categoryId, {
        fieldSchema: JSON.stringify([{ key: 'effect', label: '功效', type: 'text' }]), updatedAt: Date.now() + 1,
      })
    }],
    ['既有词条', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      await db.codexEntries.update(fixture.existingId, { summary: '作者改写旧词条', updatedAt: Date.now() + 1 })
    }],
    ['同名新增', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      const now = Date.now() + 1
      await db.codexEntries.add({
        projectId: fixture.projectId, worldId: fixture.worldId, worldGroupId: fixture.worldGroupId,
        categoryId: fixture.categoryId, name: '月栖花', icon: '', summary: '', description: '', fields: '{}',
        refs: '{}', tags: '[]', importance: 0, order: 1, createdAt: now, updatedAt: now,
      } as any)
    }],
  ] as const)('%s 漂移使候选 stale，零覆盖作者正式词条', async (_label, mutate) => {
    const fixture = await seed(String(_label))
    const generated = await generateCodexExtractionCandidateV1({
      scope: fixture.scope, request: request(fixture), runAI: async () => response(entry('月栖花')),
    })
    if (_label === '来源请求') {
      const checkpoint = await db.agentRunCheckpoints.where('runId').equals(generated.snapshot.run.id).last()
      expect(checkpoint).toBeTruthy()
    } else await mutate(fixture)
    if (_label === '来源请求') {
      vi.spyOn(codexAdapter, 'readCodexExtractPromptTemplateSnapshotV1').mockReturnValue({
        moduleKey: 'codex.extract', systemPrompt: '部署后协议', userPromptTemplate: '{{sourceText}}',
        variables: ['sourceText'], modelOverride: null, examples: null, parameters: null,
      })
    }
    await expect(adoptCodexExtractionCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0],
    })).rejects.toThrow('已变化')
    expect((await db.codexEntries.where('projectId').equals(fixture.projectId).toArray())
      .filter(row => row.name === '月栖花')).toHaveLength(_label === '同名新增' ? 1 : 0)
  })

  it.each<CodexExtractionAdoptionBoundaryV1>([
    'intent.checkpoint', 'confirmation.recorded', 'adoption.started', 'formal.written',
    'adoption.committed', 'step.succeeded', 'verification.started', 'verification.accepted',
  ])('采纳在 %s 中断后沿同一冻结选择幂等收敛', async boundary => {
    const fixture = await seed(boundary)
    const generated = await generateCodexExtractionCandidateV1({
      scope: fixture.scope, request: request(fixture),
      runAI: async () => response(entry('月栖花'), entry('星露藤')),
    })
    await expect(adoptCodexExtractionCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [1],
      onDurableBoundary: current => { if (current === boundary) throw new Error(`interrupt:${boundary}`) },
    })).rejects.toThrow(`interrupt:${boundary}`)
    const completed = await adoptCodexExtractionCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [1],
    })
    expect(completed.snapshot.projection.state).toBe('completed')
    expect((await db.codexEntries.where('projectId').equals(fixture.projectId).toArray()).map(row => row.name))
      .toEqual(['旧潮草', '星露藤'])
    expect(completed.snapshot.events.filter(event => event.type === 'adoption.committed')).toHaveLength(1)
  })

  it('作者选择一旦冻结便不可取消或改选，只能沿原意图收敛', async () => {
    const fixture = await seed('frozen')
    const generated = await generateCodexExtractionCandidateV1({
      scope: fixture.scope, request: request(fixture),
      runAI: async () => response(entry('月栖花'), entry('星露藤')),
    })
    await expect(adoptCodexExtractionCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [1],
      onDurableBoundary: boundary => { if (boundary === 'intent.checkpoint') throw new Error('interrupt:intent') },
    })).rejects.toThrow('interrupt:intent')
    await expect(abandonCodexExtractionV1({ scope: fixture.scope, runId: generated.snapshot.run.id }))
      .rejects.toThrow('选择已冻结')
    await expect(adoptCodexExtractionCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0],
    })).rejects.toThrow('冻结意图不一致')
    expect((await adoptCodexExtractionCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [1],
    })).snapshot.projection.state).toBe('completed')
  })

  it('拒绝、终态漂移、导入取消与 World/Work 隔离都 fail-closed，旧组件旁路下线', async () => {
    const rejectedFixture = await seed('reject')
    const rejectedRun = await generateCodexExtractionCandidateV1({
      scope: rejectedFixture.scope, request: request(rejectedFixture), runAI: async () => response(entry('月栖花')),
    })
    expect((await abandonCodexExtractionV1({ scope: rejectedFixture.scope, runId: rejectedRun.snapshot.run.id })).projection.state)
      .toBe('cancelled')

    const fixture = await seed('isolation')
    const generated = await generateCodexExtractionCandidateV1({
      scope: fixture.scope, request: request(fixture), runAI: async () => response(entry('月栖花')),
    })
    const importedId = await importProjectJSON(await exportProjectJSON(fixture.projectId))
    expect((await db.agentRuns.where('projectId').equals(importedId).toArray())
      .find(run => run.contractJson.includes('world-origin.codex-extract'))?.status).toBe('cancelled')
    const now = Date.now()
    const otherWorkId = await db.works.add({
      projectId: fixture.projectId, worldId: fixture.worldId, title: '另一作品', description: '', genres: ['fantasy'],
      status: 'drafting', targetWordCount: 1_000, createdAt: now, updatedAt: now,
    } as any) as number
    await expect(readPendingCodexExtractionCandidateV1({
      scope: { ...fixture.scope, workId: otherWorkId },
    })).resolves.toBeNull()
    await adoptCodexExtractionCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0] })
    const written = (await db.codexEntries.where('projectId').equals(fixture.projectId).toArray()).find(row => row.name === '月栖花')!
    await db.codexEntries.update(written.id!, { summary: '作者覆盖', updatedAt: Date.now() + 1 })
    await expect(adoptCodexExtractionCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0],
    })).rejects.toThrow('完成回执已过期')

    const panel = readFileSync('src/components/codex/CodexPanel.tsx', 'utf8')
    expect(panel).not.toContain('chat(')
    expect(panel).not.toContain('assembleContext(')
    expect(panel).not.toContain("target: 'codexEntries'")
    expect(panel).toContain('generateCodexExtractionCandidateV1')
    expect(panel).toContain('adoptCodexExtractionCandidateV1')
  })
})
