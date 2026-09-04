import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope } from '../../src/lib/types'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { parseLocations } from '../../src/lib/ai/adapters/structured-extract-adapter'
import {
  abandonLocationExtractionV1,
  adoptLocationExtractionCandidateV1,
  type LocationExtractionAdoptionBoundaryV1,
  generateLocationExtractionCandidateV1,
  readPendingLocationExtractionCandidateV1,
  readRecoverableLocationExtractionV1,
  resumeLocationExtractionCandidateV1,
} from '../../src/lib/agent/run/location-extraction-durable'
import { currentWorkFixtureRecordV1, seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampCurrentFixtureResourceUidsV1 } from '../helpers/current-resource-identity'

async function seed(options: { long?: boolean } = {}) {
  const now = Date.now()
  const created = await seedCurrentWorkspace('地点提取')
  const { projectId, worldId, workId } = created.scope
  const worldGroupId = await db.worldGroups.add({
    projectId, worldId, name: '主世界', order: 0, createdAt: now, updatedAt: now,
  }) as number
  const outlineNodeId = await db.outlineNodes.add({
    projectId, workId, worldGroupId, parentId: null, type: 'chapter', title: '第一章·钟楼夜行',
    summary: '阿澜穿过旧港前往钟楼。', order: 0, createdAt: now, updatedAt: now,
  } as any) as number
  const plain = options.long
    ? `阿澜从旧港走向潮门钟楼。${'潮声'.repeat(2_700)}她在钟楼顶层看见裂星花园。`
    : '阿澜从旧港走向潮门钟楼。她在钟楼顶层看见裂星花园，并与守钟人立下誓约。钟声落下时，全城潮水同时退去，露出了被隐藏的古老台阶。'
  const chapterId = await db.chapters.add({
    projectId, workId, outlineNodeId, title: '第一章·钟楼夜行', content: `<p>${plain}</p>`,
    wordCount: plain.length, status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now,
  } as any) as number
  const originalLocationId = await db.importantLocations.add({
    projectId, worldId, name: '旧港', tags: JSON.stringify(['港口']), description: '潮门外的老港区。',
    significance: '阿澜的出发地。', parentId: null, sortOrder: 0, createdAt: now, updatedAt: now,
  } as any) as number
  await stampCurrentFixtureResourceUidsV1(projectId)
  return {
    scope: { projectId, worldId, workId } satisfies WorkspaceScope,
    projectId, worldId, workId, worldGroupId, outlineNodeId, chapterId, originalLocationId,
  }
}

function location(name: string, tag: 'city' | 'garden' | 'port' = 'city') {
  const registeredTag = tag === 'city' ? '城市' : tag === 'garden' ? '秘境' : '港口'
  return {
    name,
    tags: [registeredTag],
    description: `${name}的空间与氛围。`,
    significance: `${name}承载了当前章节的关键行动。`,
  }
}

function response(...rows: ReturnType<typeof location>[]) {
  return JSON.stringify(rows)
}

describe.sequential('R-HARNESS62 · 重要地点 durable 分块提取与采纳', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('Skill 登记两个 Context Gateway 来源，全部分块完成后才产生零正式写入候选', async () => {
    const fixture = await seed({ long: true })
    expect(getAgentSkillV1('world-origin.locations')).toMatchObject({
      agentId: 'world-origin', executionMode: 'locations',
      contextSourceKeys: ['chapterContent', 'locations'],
      writeTargets: [{
        table: 'importantLocations',
        fields: ['name', 'tags', 'description', 'significance', 'parentId', 'sortOrder'],
      }],
    })
    const prompts: string[] = []
    const generated = await generateLocationExtractionCandidateV1({
      scope: fixture.scope,
      runAI: async (messages, callIndex) => {
        const prompt = messages.map(message => message.content).join('\n')
        prompts.push(prompt)
        expect(prompt).toContain('旧港')
        return callIndex === 0
          ? response(location('潮门钟楼'))
          : response(location('裂星花园', 'garden'))
      },
    })
    expect(prompts.length).toBeGreaterThan(1)
    expect(prompts[1]).toContain('潮门钟楼')
    expect(generated.candidate.locations.map(item => item.name)).toEqual(['潮门钟楼', '裂星花园'])
    expect(generated.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(generated.snapshot.events.filter(event => event.type === 'model.responded')).toHaveLength(prompts.length)
    expect(generated.snapshot.events.findIndex(event => event.type === 'candidate.persisted'))
      .toBeGreaterThan(generated.snapshot.events.findLastIndex(event => event.type === 'model.responded'))
    expect(await db.importantLocations.count()).toBe(1)
  })

  it('安全中断从下一个未完成分块续跑，不重复调用已有证据的分块', async () => {
    const fixture = await seed({ long: true })
    const initialCalls: number[] = []
    await expect(generateLocationExtractionCandidateV1({
      scope: fixture.scope,
      runAI: async (_messages, callIndex) => {
        initialCalls.push(callIndex)
        return response(location('潮门钟楼'))
      },
      onDurableBoundary: (boundary, _snapshot, callIndex) => {
        if (boundary === 'chunk.checkpoint' && callIndex === 0) throw new Error('interrupt:first-chunk')
      },
    })).rejects.toThrow('interrupt:first-chunk')
    expect(initialCalls).toEqual([0])
    const recovery = await readRecoverableLocationExtractionV1({ scope: fixture.scope })
    expect(recovery).toMatchObject({ nextCallIndex: 1, safeToResume: true })
    const resumedCalls: number[] = []
    const resumed = await resumeLocationExtractionCandidateV1({
      scope: fixture.scope, runId: recovery!.snapshot.run.id,
      runAI: async (_messages, callIndex) => {
        resumedCalls.push(callIndex)
        return response(location('裂星花园', 'garden'))
      },
    })
    expect(resumedCalls).not.toContain(0)
    expect(resumedCalls[0]).toBe(1)
    expect(resumed.snapshot.run.id).toBe(recovery!.snapshot.run.id)
    expect(resumed.candidate.locations.map(item => item.name)).toEqual(['潮门钟楼', '裂星花园'])
  })

  it('候选事件已持久化、候选检查点尚未写成时，可从完整分块证据重建同一候选', async () => {
    const fixture = await seed()
    await expect(generateLocationExtractionCandidateV1({
      scope: fixture.scope,
      runAI: async () => response(location('潮门钟楼')),
      onDurableBoundary: boundary => {
        if (boundary === 'candidate.persisted') throw new Error('interrupt:candidate-event')
      },
    })).rejects.toThrow('interrupt:candidate-event')
    const recovered = await readPendingLocationExtractionCandidateV1({ scope: fixture.scope })
    expect(recovered?.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(recovered?.candidate.locations.map(item => item.name)).toEqual(['潮门钟楼'])
    expect(recovered?.candidate.candidateHash).toBe(
      recovered?.snapshot.projection.steps['world-origin:locations'].candidateHash,
    )
    const adopted = await adoptLocationExtractionCandidateV1({
      scope: fixture.scope, runId: recovered!.snapshot.run.id, selectedIndexes: [0],
    })
    expect(adopted.snapshot.projection.state).toBe('completed')
    expect((await db.importantLocations.where('projectId').equals(fixture.projectId).toArray())
      .filter(row => row.name === '潮门钟楼')).toHaveLength(1)
  })

  it('模型请求发出后的结果不可判定窗口不自动重试，也不伪造部分候选', async () => {
    const fixture = await seed({ long: true })
    await expect(generateLocationExtractionCandidateV1({
      scope: fixture.scope,
      runAI: async () => { throw new Error('network-lost-after-send') },
    })).rejects.toThrow('network-lost-after-send')
    const recovery = await readRecoverableLocationExtractionV1({ scope: fixture.scope })
    expect(recovery).toMatchObject({ nextCallIndex: 0, safeToResume: false })
    expect(recovery!.snapshot.projection.state).toBe('paused')
    expect(await readPendingLocationExtractionCandidateV1({ scope: fixture.scope })).toBeNull()
    expect(await db.importantLocations.count()).toBe(1)
    await expect(resumeLocationExtractionCandidateV1({
      scope: fixture.scope, runId: recovery!.snapshot.run.id, runAI: async () => response(location('不应重试')),
    })).rejects.toThrow('不会自动重试')
    expect((await abandonLocationExtractionV1({
      scope: fixture.scope, runId: recovery!.snapshot.run.id,
    })).projection.state).toBe('cancelled')
  })

  it('任一分块违反严格输出协议都使整个 Run 失败，不产生部分候选', async () => {
    const fixture = await seed({ long: true })
    await expect(generateLocationExtractionCandidateV1({
      scope: fixture.scope,
      runAI: async (_messages, callIndex) => (
        callIndex === 0 ? response(location('潮门钟楼')) : '这不是 JSON'
      ),
    })).rejects.toThrow('不是有效 JSON')
    const run = (await db.agentRuns.where('projectId').equals(fixture.projectId).toArray())
      .find(row => row.contractJson.includes('world-origin.locations'))!
    expect(run.status).toBe('failed')
    expect(run.terminalReceiptHash).toBeNull()
    expect(await readPendingLocationExtractionCandidateV1({ scope: fixture.scope })).toBeNull()
    expect(await readRecoverableLocationExtractionV1({ scope: fixture.scope })).toBeNull()
    expect(await db.importantLocations.count()).toBe(1)
  })

  it('续跑前正文或地点基线变化会暂停原 Run，不将旧分块与新上游混合', async () => {
    const fixture = await seed({ long: true })
    await expect(generateLocationExtractionCandidateV1({
      scope: fixture.scope, runAI: async () => response(location('潮门钟楼')),
      onDurableBoundary: (boundary, _snapshot, callIndex) => {
        if (boundary === 'chunk.checkpoint' && callIndex === 0) throw new Error('interrupt:source-cas')
      },
    })).rejects.toThrow('interrupt:source-cas')
    const recovery = await readRecoverableLocationExtractionV1({ scope: fixture.scope })
    await db.chapters.update(fixture.chapterId, {
      content: '<p>作者已重写整章，并删除了原地点。</p>', updatedAt: Date.now() + 1,
    })
    await expect(resumeLocationExtractionCandidateV1({
      scope: fixture.scope, runId: recovery!.snapshot.run.id,
      runAI: async () => response(location('不应生成')),
    })).rejects.toThrow('已变化')
    expect((await db.agentRuns.get(recovery!.snapshot.run.id))?.status).toBe('paused')
    expect(await readPendingLocationExtractionCandidateV1({ scope: fixture.scope })).toBeNull()
  })

  it('候选刷新恢复，作者只选一项后通过 adopt 写入当前 World 并签发 receipt', async () => {
    const fixture = await seed()
    const generated = await generateLocationExtractionCandidateV1({
      scope: fixture.scope,
      runAI: async () => response(location('潮门钟楼'), location('裂星花园', 'garden')),
    })
    const recovered = await readPendingLocationExtractionCandidateV1({ scope: fixture.scope })
    expect(recovered?.snapshot.run.id).toBe(generated.snapshot.run.id)
    expect(recovered?.selectedIndexes).toBeNull()
    const adopted = await adoptLocationExtractionCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [1],
    })
    expect(adopted.snapshot.projection.state).toBe('completed')
    expect(adopted.receiptHash).toHaveLength(64)
    expect(adopted.written).toBe(1)
    const rows = await db.importantLocations.where('projectId').equals(fixture.projectId).toArray()
    expect(rows.map(row => row.name).sort()).toEqual(['旧港', '裂星花园'])
    expect((rows.find(row => row.name === '裂星花园') as any).worldId).toBe(fixture.worldId)
    expect(rows.find(row => row.name === '裂星花园')).toMatchObject({ parentId: null, sortOrder: 1 })
    expect(await readPendingLocationExtractionCandidateV1({ scope: fixture.scope })).toBeNull()
  })

  it('既有地点改变会使未采纳候选 stale，不覆盖作者当前基线', async () => {
    const fixture = await seed()
    const generated = await generateLocationExtractionCandidateV1({
      scope: fixture.scope, runAI: async () => response(location('潮门钟楼')),
    })
    await db.importantLocations.update(fixture.originalLocationId, {
      description: '作者已重写旧港。', updatedAt: Date.now() + 1,
    })
    await expect(adoptLocationExtractionCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0],
    })).rejects.toThrow('已变化')
    expect((await db.agentRuns.get(generated.snapshot.run.id))?.status).toBe('paused')
    expect(await db.importantLocations.count()).toBe(1)
  })

  it('采纳八个持久化边界逐一中断均收敛到同一 Run、同一冻结选择和一条正式地点', async () => {
    const boundaries: LocationExtractionAdoptionBoundaryV1[] = [
      'intent.checkpoint', 'confirmation.recorded', 'adoption.started', 'formal.written',
      'adoption.committed', 'step.succeeded', 'verification.started', 'verification.accepted',
    ]
    for (const boundary of boundaries) {
      await db.delete()
      await db.open()
      const fixture = await seed()
      const generated = await generateLocationExtractionCandidateV1({
        scope: fixture.scope,
        runAI: async () => response(location('潮门钟楼'), location('裂星花园', 'garden')),
      })
      await expect(adoptLocationExtractionCandidateV1({
        scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [1],
        onDurableBoundary: reached => {
          if (reached === boundary) throw new Error(`interrupt:${boundary}`)
        },
      })).rejects.toThrow(`interrupt:${boundary}`)
      const recovered = await readPendingLocationExtractionCandidateV1({ scope: fixture.scope })
      if (boundary === 'verification.accepted') expect(recovered).toBeNull()
      else {
        expect(recovered?.snapshot.run.id).toBe(generated.snapshot.run.id)
        expect(recovered?.selectedIndexes, boundary).toEqual([1])
      }
      const completed = await adoptLocationExtractionCandidateV1({
        scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [1],
      })
      expect(completed.snapshot.projection.state, boundary).toBe('completed')
      expect((await db.importantLocations.where('projectId').equals(fixture.projectId).toArray())
        .filter(row => row.name === '裂星花园'), boundary).toHaveLength(1)
      expect((await db.agentRuns.where('projectId').equals(fixture.projectId).toArray())
        .filter(run => run.contractJson.includes('world-origin.locations')), boundary).toHaveLength(1)
    }
  })

  it('不可移植的分块进度和候选在项目导入后均明确取消', async () => {
    for (const state of ['progress', 'candidate'] as const) {
      await db.delete()
      await db.open()
      const fixture = await seed({ long: state === 'progress' })
      if (state === 'progress') {
        await expect(generateLocationExtractionCandidateV1({
          scope: fixture.scope, runAI: async () => response(location('潮门钟楼')),
          onDurableBoundary: (boundary, _snapshot, callIndex) => {
            if (boundary === 'chunk.checkpoint' && callIndex === 0) throw new Error('interrupt:export-progress')
          },
        })).rejects.toThrow('interrupt:export-progress')
      } else {
        await generateLocationExtractionCandidateV1({
          scope: fixture.scope, runAI: async () => response(location('潮门钟楼')),
        })
      }
      const importedId = await importProjectJSON(await exportProjectJSON(fixture.projectId))
      const imported = (await db.agentRuns.where('projectId').equals(importedId).toArray())
        .find(run => run.contractJson.includes('world-origin.locations'))!
      expect(imported.status, state).toBe('cancelled')
      expect(imported.terminalReceiptHash, state).toBeNull()
    }
  })

  it('只读取当前 Work 正文和当前 World 地点，不泄漏同项目其他作品与世界', async () => {
    const fixture = await seed()
    const now = Date.now()
    const foreignWorkId = await db.works.add(currentWorkFixtureRecordV1({
      projectId: fixture.projectId, worldId: fixture.worldId, title: '同世界其他作品', description: '',
      genres: ['fantasy'], status: 'drafting', targetWordCount: 1_000, createdAt: now, updatedAt: now,
    })) as number
    await db.chapters.add({
      projectId: fixture.projectId, workId: foreignWorkId, outlineNodeId: null, title: '外部章节',
      content: '<p>秘密外城只存在于另一部作品，绝不应被读取。</p>', wordCount: 40,
      status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now,
    } as any)
    const foreignWorldId = await db.worlds.add({
      projectId: fixture.projectId, code: `foreign-${now}`, name: '其他世界', description: '',
      currentVersion: 1, createdAt: now, updatedAt: now,
    }) as number
    await db.importantLocations.add({
      projectId: fixture.projectId, worldId: foreignWorldId, name: '异世界圣殿', tags: '[]',
      description: '不应出现。', significance: '隔离测试。', parentId: null, sortOrder: 0,
      createdAt: now, updatedAt: now,
    } as any)
    await generateLocationExtractionCandidateV1({
      scope: fixture.scope,
      runAI: async messages => {
        const prompt = messages.map(message => message.content).join('\n')
        expect(prompt).toContain('旧港')
        expect(prompt).not.toContain('秘密外城')
        expect(prompt).not.toContain('异世界圣殿')
        return response(location('潮门钟楼'))
      },
    })
  })

  it('终验后无论上游正文、原有地点或所选正式地点漂移，旧 receipt 都会 stale', async () => {
    for (const drift of ['chapter', 'original', 'selected'] as const) {
      await db.delete()
      await db.open()
      const fixture = await seed()
      const generated = await generateLocationExtractionCandidateV1({
        scope: fixture.scope, runAI: async () => response(location('潮门钟楼')),
      })
      await adoptLocationExtractionCandidateV1({
        scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0],
      })
      if (drift === 'chapter') {
        await db.chapters.update(fixture.chapterId, {
          content: '<p>终验后作者重写了本章正文，使原提取证据失效。</p>', updatedAt: Date.now() + 1,
        })
      } else if (drift === 'original') {
        await db.importantLocations.update(fixture.originalLocationId, {
          significance: '终验后作者改写了原有地点。', updatedAt: Date.now() + 1,
        })
      } else {
        const selected = await db.importantLocations.where('projectId').equals(fixture.projectId)
          .filter(row => row.name === '潮门钟楼').first()
        await db.importantLocations.update(selected!.id!, {
          description: '终验后作者改写了正式地点。', updatedAt: Date.now() + 1,
        })
      }
      await expect(adoptLocationExtractionCandidateV1({
        scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0],
      }), drift).rejects.toThrow('完成回执已过期')
      const run = await db.agentRuns.get(generated.snapshot.run.id)
      expect(run?.status, drift).toBe('paused')
      expect(run?.terminalReceiptHash, drift).toBeNull()
    }
  })

  it('严格 parser 拒绝额外字段、未登记标签、空证据、重复标签和非 JSON', () => {
    const valid = location('潮门钟楼')
    expect(() => parseLocations(JSON.stringify([{ ...valid, extra: true }]))).toThrow('字段不在允许闭集')
    expect(() => parseLocations(JSON.stringify([{ ...valid, tags: ['未登记'] }]))).toThrow('未登记标签')
    expect(() => parseLocations(JSON.stringify([{ ...valid, description: '', significance: '' }]))).toThrow('必需内容无效')
    expect(() => parseLocations(JSON.stringify([{ ...valid, tags: ['城市', '城市'] }]))).toThrow('标签重复')
    expect(() => parseLocations('这是一段地点建议')).toThrow('不是有效 JSON')
  })

  it('旧组件逐章 chat、手拼上下文、内存候选和直接 adopt 旁路已下线，人工 CRUD 保留', () => {
    const source = readFileSync('src/components/location/LocationPanel.tsx', 'utf8')
    expect(source).not.toContain('buildLocationExtractPrompt')
    expect(source).not.toContain('splitExtractionText')
    expect(source).not.toContain('assembleContext')
    expect(source).not.toContain('await chat(')
    expect(source).not.toContain("target: 'importantLocations'")
    expect(source).toContain('generateLocationExtractionCandidateV1')
    expect(source).toContain('resumeLocationExtractionCandidateV1')
    expect(source).toContain('adoptLocationExtractionCandidateV1')
    expect(source).toContain('await addLocation')
    expect(source).toContain('updateLocation')
    expect(source).toContain('deleteLocation')
  })
})
