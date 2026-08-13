import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope } from '../../src/lib/types'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { parseInventoryEventsStrictV1 } from '../../src/lib/ai/adapters/inventory-extract-adapter'
import {
  abandonInventoryExtractionV1,
  adoptInventoryExtractionCandidateV1,
  generateInventoryExtractionCandidateV1,
  type InventoryExtractionAdoptionBoundaryV1,
  readPendingInventoryExtractionCandidateV1,
  readRecoverableInventoryExtractionV1,
  resumeInventoryExtractionCandidateV1,
} from '../../src/lib/agent/run/inventory-extraction-durable'

async function seed(options: { long?: boolean } = {}) {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: '物品提取', genre: 'fantasy', genres: ['fantasy'], status: 'drafting', description: '',
    targetWordCount: 80_000, worldCode: `inventory-${now}`, worldVersion: 1, createdAt: now, updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({
    projectId, code: `inventory-${now}`, name: '潮门世界', description: '', currentVersion: 1,
    createdAt: now, updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId, worldId, title: '潮门纪', description: '', genres: ['fantasy'], status: 'drafting',
    targetWordCount: 80_000, createdAt: now, updatedAt: now,
  } as any) as number
  await db.projects.update(projectId, { activeWorldId: worldId, activeWorkId: workId, ownershipSchemaVersion: 1 })
  const worldGroupId = await db.worldGroups.add({
    projectId, worldId, name: '主世界', order: 0, createdAt: now, updatedAt: now,
  }) as number
  const volumeId = await db.outlineNodes.add({
    projectId, workId, worldGroupId, parentId: null, type: 'volume', title: '第一卷', summary: '',
    order: 0, createdAt: now, updatedAt: now,
  } as any) as number
  const chapterIds: number[] = []
  const outlineIds: number[] = []
  const contents = [
    options.long
      ? `阿澜拾起三枚潮汐令。${'海潮反复拍击钟楼石阶。'.repeat(650)}阿澜把一枚潮汐令交给钟叔。`
      : '阿澜在旧港拾起三枚潮汐令，随后把其中一枚交给钟叔。守钟人记录了这次交接，潮声盖过了他们的谈话。她仔细收好剩余令牌，确认数量后才离开码头。',
    '阿澜穿过潮门，确认背包里没有新增或消耗任何物品。钟叔只远远看着她，没有发生物品交接。两人沿着潮湿石阶继续前行，直到钟声在空旷街道上渐渐消散。',
  ]
  for (let index = 0; index < 2; index++) {
    const outlineId = await db.outlineNodes.add({
      projectId, workId, worldGroupId, parentId: volumeId, type: 'chapter',
      title: `第${index + 1}章`, summary: `第${index + 1}章摘要`, order: index,
      createdAt: now + index, updatedAt: now + index,
    } as any) as number
    outlineIds.push(outlineId)
    chapterIds.push(await db.chapters.add({
      projectId, workId, outlineNodeId: outlineId, title: `第${index + 1}章`,
      content: `<p>${contents[index]}</p>`, wordCount: contents[index].length,
      status: 'draft', order: index, notes: '', createdAt: now + index, updatedAt: now + index,
    } as any) as number)
  }
  const characterIds = [
    await db.characters.add({
      projectId, worldId, workId: null, homeWorldGroupId: worldGroupId,
      name: '阿澜', role: 'protagonist', roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral',
      shortDescription: '潮门守卫', appearance: '', personality: '', background: '', motivation: '',
      abilities: '', relationships: '', arc: '', createdAt: now, updatedAt: now,
    } as any) as number,
    await db.characters.add({
      projectId, worldId, workId: null, homeWorldGroupId: worldGroupId,
      name: '钟叔', role: 'supporting', roleWeight: 'secondary', moralAxis: 'good', orderAxis: 'lawful',
      shortDescription: '老钟匠', appearance: '', personality: '', background: '', motivation: '',
      abilities: '', relationships: '', arc: '', createdAt: now + 1, updatedAt: now + 1,
    } as any) as number,
  ]
  const originalIds = [
    await db.itemLedger.add({
      projectId, workId, itemName: '旧钥匙', heldByName: '阿澜', characterId: characterIds[0],
      action: 'gain', quantity: 1, chapterId: chapterIds[0], chapterTitle: '第1章', note: '旧提取结果',
      createdAt: now,
    } as any) as number,
    await db.itemLedger.add({
      projectId, workId, itemName: '旧地图', heldByName: '钟叔', characterId: characterIds[1],
      action: 'gain', quantity: 1, chapterId: chapterIds[1], chapterTitle: '第2章', note: '旧提取结果',
      createdAt: now + 1,
    } as any) as number,
  ]
  return {
    scope: { projectId, worldId, workId } satisfies WorkspaceScope,
    projectId, worldId, workId, worldGroupId, volumeId, outlineIds, chapterIds, characterIds, originalIds,
  }
}

function item(
  itemName = '潮汐令',
  heldByName = '阿澜',
  action: 'gain' | 'consume' = 'gain',
  quantity = 3,
  note = '旧港拾得',
) {
  return { itemName, heldByName, action, quantity, note }
}

function response(...rows: ReturnType<typeof item>[]) {
  return JSON.stringify(rows)
}

describe.sequential('R-HARNESS63 · 物品栏 durable 分块提取与原子替换', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('Skill 登记三项 Context 来源；范围与全部分块完成后才产生零正式写入候选', async () => {
    const fixture = await seed({ long: true })
    expect(getAgentSkillV1('prose.inventory-extraction')).toMatchObject({
      agentId: 'prose', executionMode: 'inventory-extraction',
      contextSourceKeys: ['chapterContent', 'itemLedger', 'characters'],
      writeTargets: [{
        table: 'itemLedger',
        fields: ['itemName', 'action', 'quantity', 'heldByName', 'characterId', 'chapterId', 'chapterTitle', 'note'],
      }],
    })
    const prompts: string[] = []
    const generated = await generateInventoryExtractionCandidateV1({
      scope: fixture.scope,
      request: { mode: 'range', startOrdinal: 1, endOrdinal: 1 },
      runAI: async (messages, callIndex) => {
        const prompt = messages.map(message => message.content).join('\n')
        prompts.push(prompt)
        expect(prompt).toContain('旧钥匙')
        expect(prompt).toContain('阿澜')
        return callIndex === 0 ? response(item()) : response(item('断潮绳', '钟叔', 'gain', 1, '阿澜所赠'))
      },
    })
    expect(prompts.length).toBeGreaterThan(1)
    expect(prompts[1]).toContain('潮汐令')
    expect(generated.candidate.plan.targetChapterIds).toEqual([fixture.chapterIds[0]])
    expect(generated.candidate.events.map(event => event.itemName)).toEqual(['潮汐令', '断潮绳'])
    expect(generated.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(generated.snapshot.events.findIndex(event => event.type === 'candidate.persisted'))
      .toBeGreaterThan(generated.snapshot.events.findLastIndex(event => event.type === 'model.responded'))
    expect((await db.itemLedger.toArray()).map(row => row.id)).toEqual(fixture.originalIds)
  })

  it('安全中断从下一个未完成分块续跑，不重复模型调用或旧候选', async () => {
    const fixture = await seed({ long: true })
    const initialCalls: number[] = []
    await expect(generateInventoryExtractionCandidateV1({
      scope: fixture.scope, request: { mode: 'range', startOrdinal: 1, endOrdinal: 1 },
      runAI: async (_messages, callIndex) => {
        initialCalls.push(callIndex)
        return response(item())
      },
      onDurableBoundary: (boundary, _snapshot, callIndex) => {
        if (boundary === 'chunk.checkpoint' && callIndex === 0) throw new Error('interrupt:first-inventory-chunk')
      },
    })).rejects.toThrow('interrupt:first-inventory-chunk')
    expect(initialCalls).toEqual([0])
    const recovery = await readRecoverableInventoryExtractionV1({ scope: fixture.scope })
    expect(recovery).toMatchObject({ nextCallIndex: 1, safeToResume: true })
    const resumedCalls: number[] = []
    const resumed = await resumeInventoryExtractionCandidateV1({
      scope: fixture.scope, runId: recovery!.snapshot.run.id,
      runAI: async (_messages, callIndex) => {
        resumedCalls.push(callIndex)
        return response(item('断潮绳', '钟叔', 'gain', 1, '阿澜所赠'))
      },
    })
    expect(resumedCalls).not.toContain(0)
    expect(resumedCalls[0]).toBe(1)
    expect(resumed.snapshot.run.id).toBe(recovery!.snapshot.run.id)
    expect(resumed.candidate.events.map(event => event.itemName)).toEqual(['潮汐令', '断潮绳'])
  })

  it('候选事件与检查点之间中断可从完整分块证据恢复同一候选', async () => {
    const fixture = await seed()
    await expect(generateInventoryExtractionCandidateV1({
      scope: fixture.scope, request: { mode: 'all' }, runAI: async () => response(item()),
      onDurableBoundary: boundary => {
        if (boundary === 'candidate.persisted') throw new Error('interrupt:inventory-candidate-event')
      },
    })).rejects.toThrow('interrupt:inventory-candidate-event')
    const recovered = await readPendingInventoryExtractionCandidateV1({ scope: fixture.scope })
    expect(recovered?.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(recovered?.candidate.candidateHash).toBe(
      recovered?.snapshot.projection.steps['prose:inventory-extraction'].candidateHash,
    )
    expect(await db.itemLedger.count()).toBe(2)
  })

  it('模型结果不可判定时暂停且不重试；严格协议失败时整次失败且不伪造候选', async () => {
    const fixture = await seed({ long: true })
    await expect(generateInventoryExtractionCandidateV1({
      scope: fixture.scope, request: { mode: 'range', startOrdinal: 1, endOrdinal: 1 },
      runAI: async () => { throw new Error('network-lost-after-send') },
    })).rejects.toThrow('network-lost-after-send')
    const recovery = await readRecoverableInventoryExtractionV1({ scope: fixture.scope })
    expect(recovery).toMatchObject({ nextCallIndex: 0, safeToResume: false })
    await expect(resumeInventoryExtractionCandidateV1({
      scope: fixture.scope, runId: recovery!.snapshot.run.id, runAI: async () => response(item()),
    })).rejects.toThrow('不会自动重试')
    expect((await abandonInventoryExtractionV1({
      scope: fixture.scope, runId: recovery!.snapshot.run.id,
    })).projection.state).toBe('cancelled')

    await expect(generateInventoryExtractionCandidateV1({
      scope: fixture.scope, request: { mode: 'all' },
      runAI: async (_messages, callIndex) => callIndex === 0 ? response(item()) : 'not-json',
    })).rejects.toThrow('不是有效 JSON')
    const runs = (await db.agentRuns.where('projectId').equals(fixture.projectId).toArray())
      .filter(run => run.contractJson.includes('prose.inventory-extraction'))
    expect(runs.some(run => run.status === 'failed')).toBe(true)
    expect(await db.itemLedger.count()).toBe(2)
  })

  it('正文、角色或旧物品基线变化会使恢复/采纳 fail-closed', async () => {
    const fixture = await seed({ long: true })
    await expect(generateInventoryExtractionCandidateV1({
      scope: fixture.scope, request: { mode: 'range', startOrdinal: 1, endOrdinal: 1 },
      runAI: async () => response(item()),
      onDurableBoundary: (boundary, _snapshot, callIndex) => {
        if (boundary === 'chunk.checkpoint' && callIndex === 0) throw new Error('interrupt:inventory-cas')
      },
    })).rejects.toThrow('interrupt:inventory-cas')
    const recovery = await readRecoverableInventoryExtractionV1({ scope: fixture.scope })
    await db.chapters.update(fixture.chapterIds[0], {
      content: '<p>作者已重写本章并移除了所有物品变化。</p>', updatedAt: Date.now() + 10,
    })
    await expect(resumeInventoryExtractionCandidateV1({
      scope: fixture.scope, runId: recovery!.snapshot.run.id, runAI: async () => response(item()),
    })).rejects.toThrow('已变化')
    expect((await db.agentRuns.get(recovery!.snapshot.run.id))?.status).toBe('paused')

    const second = await seed()
    const generated = await generateInventoryExtractionCandidateV1({
      scope: second.scope, request: { mode: 'all' }, runAI: async () => response(item()),
    })
    await db.itemLedger.update(second.originalIds[0], { note: '作者已修改旧流水' })
    await expect(adoptInventoryExtractionCandidateV1({
      scope: second.scope, runId: generated.snapshot.run.id, selectedIndexes: [0],
    })).rejects.toThrow('已变化')
    expect((await db.agentRuns.get(generated.snapshot.run.id))?.status).toBe('paused')
  })

  it('作者选择后逐章原子替换；空结果确认会有意清理目标章，角色 ID 由冻结 roster 绑定', async () => {
    const fixture = await seed()
    const generated = await generateInventoryExtractionCandidateV1({
      scope: fixture.scope, request: { mode: 'all' },
      runAI: async (_messages, callIndex) => callIndex === 0
        ? response(item(), item('潮汐令', '钟叔', 'gain', 1, '阿澜所赠'))
        : response(),
    })
    expect(await db.itemLedger.count()).toBe(2)
    const adopted = await adoptInventoryExtractionCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0, 1],
    })
    expect(adopted.snapshot.projection.state).toBe('completed')
    expect(adopted.receiptHash).toHaveLength(64)
    const rows = await db.itemLedger.where('projectId').equals(fixture.projectId).toArray()
    expect(rows).toHaveLength(2)
    expect(rows.every(row => row.chapterId === fixture.chapterIds[0])).toBe(true)
    expect(rows.map(row => row.characterId).sort()).toEqual([...fixture.characterIds].sort())
    expect(rows.map(row => row.itemName)).toEqual(['潮汐令', '潮汐令'])
    expect(await readPendingInventoryExtractionCandidateV1({ scope: fixture.scope })).toBeNull()
  })

  it('当前 World 内同名角色不猜测绑定，保留持有人姓名但 characterId 为空', async () => {
    const fixture = await seed()
    const now = Date.now()
    const otherGroupId = await db.worldGroups.add({
      projectId: fixture.projectId, worldId: fixture.worldId, name: '支线世界', order: 1,
      createdAt: now, updatedAt: now,
    }) as number
    await db.characters.add({
      projectId: fixture.projectId, worldId: fixture.worldId, workId: null, homeWorldGroupId: otherGroupId,
      name: '阿澜', role: 'supporting', roleWeight: 'secondary', moralAxis: 'neutral', orderAxis: 'neutral',
      shortDescription: '同名异界角色', appearance: '', personality: '', background: '', motivation: '',
      abilities: '', relationships: '', arc: '', createdAt: now, updatedAt: now,
    } as any)
    const generated = await generateInventoryExtractionCandidateV1({
      scope: fixture.scope, request: { mode: 'range', startOrdinal: 1, endOrdinal: 1 },
      runAI: async () => response(item()),
    })
    await adoptInventoryExtractionCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0],
    })
    const row = await db.itemLedger.where('chapterId').equals(fixture.chapterIds[0]).first()
    expect(row).toMatchObject({ heldByName: '阿澜', characterId: null })
  })

  it('空候选也可由作者确认，明确清理范围内的旧提取结果', async () => {
    const fixture = await seed()
    const generated = await generateInventoryExtractionCandidateV1({
      scope: fixture.scope, request: { mode: 'all' }, runAI: async () => response(),
    })
    expect(generated.candidate.events).toEqual([])
    const adopted = await adoptInventoryExtractionCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [],
    })
    expect(adopted.snapshot.projection.state).toBe('completed')
    expect(await db.itemLedger.count()).toBe(0)
  })

  it('采纳八个持久化边界逐一中断均收敛到同一 Run 与同一冻结替换结果', async () => {
    const boundaries: InventoryExtractionAdoptionBoundaryV1[] = [
      'intent.checkpoint', 'confirmation.recorded', 'adoption.started', 'formal.chapter',
      'adoption.committed', 'step.succeeded', 'verification.started', 'verification.accepted',
    ]
    for (const boundary of boundaries) {
      await db.delete()
      await db.open()
      const fixture = await seed()
      const generated = await generateInventoryExtractionCandidateV1({
        scope: fixture.scope, request: { mode: 'all' },
        runAI: async (_messages, callIndex) => callIndex === 0 ? response(item()) : response(),
      })
      await expect(adoptInventoryExtractionCandidateV1({
        scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0],
        onDurableBoundary: reached => {
          if (reached === boundary) throw new Error(`interrupt:${boundary}`)
        },
      })).rejects.toThrow(`interrupt:${boundary}`)
      const recovered = await readPendingInventoryExtractionCandidateV1({ scope: fixture.scope })
      if (boundary === 'verification.accepted') expect(recovered).toBeNull()
      else {
        expect(recovered?.snapshot.run.id, boundary).toBe(generated.snapshot.run.id)
        expect(recovered?.selectedIndexes, boundary).toEqual([0])
      }
      const completed = await adoptInventoryExtractionCandidateV1({
        scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0],
      })
      expect(completed.snapshot.projection.state, boundary).toBe('completed')
      const rows = await db.itemLedger.where('projectId').equals(fixture.projectId).toArray()
      expect(rows.map(row => row.itemName), boundary).toEqual(['潮汐令'])
      expect((await db.agentRuns.where('projectId').equals(fixture.projectId).toArray())
        .filter(run => run.contractJson.includes('prose.inventory-extraction')), boundary).toHaveLength(1)
    }
  })

  it('不可移植的范围、分块进度和候选在导入后明确取消', async () => {
    for (const state of ['progress', 'candidate'] as const) {
      await db.delete()
      await db.open()
      const fixture = await seed({ long: state === 'progress' })
      if (state === 'progress') {
        await expect(generateInventoryExtractionCandidateV1({
          scope: fixture.scope, request: { mode: 'range', startOrdinal: 1, endOrdinal: 1 },
          runAI: async () => response(item()),
          onDurableBoundary: (boundary, _snapshot, callIndex) => {
            if (boundary === 'chunk.checkpoint' && callIndex === 0) throw new Error('interrupt:export-inventory-progress')
          },
        })).rejects.toThrow('interrupt:export-inventory-progress')
      } else {
        await generateInventoryExtractionCandidateV1({
          scope: fixture.scope, request: { mode: 'all' }, runAI: async () => response(item()),
        })
      }
      const importedId = await importProjectJSON(await exportProjectJSON(fixture.projectId))
      const imported = (await db.agentRuns.where('projectId').equals(importedId).toArray())
        .find(run => run.contractJson.includes('prose.inventory-extraction'))!
      expect(imported.status, state).toBe('cancelled')
      expect(imported.terminalReceiptHash, state).toBeNull()
    }
  })

  it('只读取当前 Work 正文、物品流水与当前 World 角色', async () => {
    const fixture = await seed()
    const now = Date.now()
    const foreignWorkId = await db.works.add({
      projectId: fixture.projectId, worldId: fixture.worldId, title: '同世界外部作品', description: '',
      genres: ['fantasy'], status: 'drafting', targetWordCount: 1_000, createdAt: now, updatedAt: now,
    } as any) as number
    await db.chapters.add({
      projectId: fixture.projectId, workId: foreignWorkId, outlineNodeId: null, title: '外部章节',
      content: '<p>秘密银钥匙只存在于另一部作品。</p>', wordCount: 30,
      status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now,
    } as any)
    await db.itemLedger.add({
      projectId: fixture.projectId, workId: foreignWorkId, itemName: '外部圣杯', heldByName: '外部角色',
      characterId: null, action: 'gain', quantity: 1, chapterId: null, chapterTitle: '外部章节', note: '隔离', createdAt: now,
    } as any)
    const foreignWorldId = await db.worlds.add({
      projectId: fixture.projectId, code: `foreign-${now}`, name: '外部世界', description: '',
      currentVersion: 1, createdAt: now, updatedAt: now,
    }) as number
    await db.characters.add({
      projectId: fixture.projectId, worldId: foreignWorldId, workId: null, homeWorldGroupId: null,
      name: '异界持有者', role: 'supporting', roleWeight: 'secondary', moralAxis: 'neutral', orderAxis: 'neutral',
      shortDescription: '', appearance: '', personality: '', background: '', motivation: '', abilities: '',
      relationships: '', arc: '', createdAt: now, updatedAt: now,
    } as any)
    await generateInventoryExtractionCandidateV1({
      scope: fixture.scope, request: { mode: 'all' },
      runAI: async messages => {
        const prompt = messages.map(message => message.content).join('\n')
        expect(prompt).toContain('旧钥匙')
        expect(prompt).toContain('阿澜')
        expect(prompt).not.toContain('秘密银钥匙')
        expect(prompt).not.toContain('外部圣杯')
        expect(prompt).not.toContain('异界持有者')
        return response()
      },
    })
  })

  it('终验后正文、角色、目标流水或范围外流水漂移都会令旧 receipt stale', async () => {
    for (const drift of ['chapter', 'character', 'target', 'outside'] as const) {
      await db.delete()
      await db.open()
      const fixture = await seed()
      const generated = await generateInventoryExtractionCandidateV1({
        scope: fixture.scope, request: { mode: 'range', startOrdinal: 1, endOrdinal: 1 },
        runAI: async () => response(item()),
      })
      await adoptInventoryExtractionCandidateV1({
        scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0],
      })
      if (drift === 'chapter') {
        await db.chapters.update(fixture.chapterIds[0], {
          content: '<p>终验后作者改写了物品来源正文。</p>', updatedAt: Date.now() + 20,
        })
      } else if (drift === 'character') {
        await db.characters.update(fixture.characterIds[0], { name: '阿澜·改', updatedAt: Date.now() + 20 })
      } else if (drift === 'target') {
        const target = await db.itemLedger.where('chapterId').equals(fixture.chapterIds[0]).first()
        await db.itemLedger.update(target!.id!, { note: '作者改写正式流水' })
      } else {
        await db.itemLedger.update(fixture.originalIds[1], { note: '作者改写范围外流水' })
      }
      await expect(adoptInventoryExtractionCandidateV1({
        scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0],
      }), drift).rejects.toThrow('完成回执已过期')
      const run = await db.agentRuns.get(generated.snapshot.run.id)
      expect(run?.status, drift).toBe('paused')
      expect(run?.terminalReceiptHash, drift).toBeNull()
    }
  })

  it('严格 parser 拒绝额外字段、容错枚举、非正整数、缺少持有人与非 JSON', () => {
    expect(parseInventoryEventsStrictV1(response(item()))).toEqual([item()])
    expect(() => parseInventoryEventsStrictV1(JSON.stringify([{ ...item(), extra: true }]))).toThrow('字段不在允许闭集')
    expect(() => parseInventoryEventsStrictV1(JSON.stringify([{ ...item(), action: '获得' }]))).toThrow('字段类型或枚举无效')
    expect(() => parseInventoryEventsStrictV1(JSON.stringify([{ ...item(), quantity: 1.5 }]))).toThrow('字段类型或枚举无效')
    expect(() => parseInventoryEventsStrictV1(JSON.stringify([{ ...item(), heldByName: '' }]))).toThrow('字段类型或枚举无效')
    expect(() => parseInventoryEventsStrictV1('物品建议如下')).toThrow('不是有效 JSON')
  })

  it('旧组件逐章 chat、手拼上下文、先删后写和直接 adopt 旁路已下线，人工 CRUD 保留', () => {
    const source = readFileSync('src/components/items/InventoryPanel.tsx', 'utf8')
    expect(source).not.toContain('buildInventoryExtractPrompt')
    expect(source).not.toContain('parseInventoryEvents')
    expect(source).not.toContain('splitExtractionText')
    expect(source).not.toContain('assembleContext')
    expect(source).not.toContain('await chat(')
    expect(source).not.toContain('deleteByChapter')
    expect(source).not.toContain("target: 'itemLedger'")
    expect(source).toContain('generateInventoryExtractionCandidateV1')
    expect(source).toContain('resumeInventoryExtractionCandidateV1')
    expect(source).toContain('adoptInventoryExtractionCandidateV1')
    expect(source).toContain('addEntry')
    expect(source).toContain('updateEntry')
    expect(source).toContain('deleteEntry')
  })
})
