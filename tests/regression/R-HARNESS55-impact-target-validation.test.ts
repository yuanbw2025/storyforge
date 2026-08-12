import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope } from '../../src/lib/types'
import {
  isImpactHandoffRouteModuleV2,
  type ImpactHandoffV2,
} from '../../src/lib/consistency/impact-handoff'
import { resolveCurrentImpactHandoffTargetV2 } from '../../src/lib/agent/run/impact-handoff-durable'

const HASH = 'a'.repeat(64)

async function seed() {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: '精确落点', genre: 'fantasy', genres: ['fantasy'], status: 'drafting',
    description: '', targetWordCount: 100_000, worldCode: 'target', worldVersion: 1,
    createdAt: now, updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({
    projectId, code: 'target', name: '主世界', description: '', currentVersion: 1,
    createdAt: now, updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId, worldId, title: '当前作品', description: '', genres: ['fantasy'],
    status: 'drafting', targetWordCount: 100_000, createdAt: now, updatedAt: now,
  } as any) as number
  const otherWorkId = await db.works.add({
    projectId, worldId, title: '另一作品', description: '', genres: ['fantasy'],
    status: 'drafting', targetWordCount: 100_000, createdAt: now, updatedAt: now,
  } as any) as number
  await db.projects.update(projectId, {
    activeWorldId: worldId,
    activeWorkId: workId,
    ownershipSchemaVersion: 1,
  })
  const volumeId = await db.outlineNodes.add({
    projectId, workId, parentId: null, type: 'volume', title: '卷一', summary: '', order: 0,
    createdAt: now, updatedAt: now,
  } as any) as number
  const outlineNodeId = await db.outlineNodes.add({
    projectId, workId, parentId: volumeId, type: 'chapter', title: '第一章', summary: '', order: 0,
    createdAt: now, updatedAt: now,
  } as any) as number
  const chapterId = await db.chapters.add({
    projectId, workId, outlineNodeId, title: '第一章', content: '<p>潮声。</p>', wordCount: 3,
    status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now,
  } as any) as number
  return {
    scope: { projectId, worldId, workId } satisfies WorkspaceScope,
    projectId,
    otherWorkId,
    outlineNodeId,
    chapterId,
    now,
  }
}

function handoff(patch: Partial<ImpactHandoffV2>): ImpactHandoffV2 {
  return {
    version: 2,
    itemId: 'impact-remediation:chapter:1',
    action: 'review-downstream-chapter',
    table: 'chapters',
    recordId: 1,
    targetModule: 'chapters-list',
    targetRecordId: 1,
    sourceChapterId: 1,
    sourceOutlineNodeId: 1,
    planHash: HASH,
    graphHash: HASH,
    sourceTextHash: HASH,
    reviewRunId: 1,
    reviewReceiptHash: HASH,
    returnModule: 'chapters-list',
    returnNodeId: 1,
    ...patch,
  }
}

describe.sequential('R-HARNESS55 · 人工交接精确目标验证', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('把章节和细纲业务主键归一为现有面板使用的 outlineNodeId', async () => {
    const fixture = await seed()
    const chapterTarget = await resolveCurrentImpactHandoffTargetV2({
      scope: fixture.scope,
      handoff: handoff({
        sourceChapterId: fixture.chapterId,
        sourceOutlineNodeId: fixture.outlineNodeId,
        returnNodeId: fixture.outlineNodeId,
        recordId: fixture.chapterId,
        targetRecordId: fixture.chapterId,
      }),
    })
    expect(chapterTarget).toEqual({
      table: 'chapters',
      recordId: fixture.chapterId,
      moduleRecordId: fixture.outlineNodeId,
    })

    const detailId = await db.detailedOutlines.add({
      projectId: fixture.projectId,
      workId: fixture.scope.workId,
      outlineNodeId: fixture.outlineNodeId,
      scenes: [],
      createdAt: fixture.now,
      updatedAt: fixture.now,
    } as any) as number
    const detailTarget = await resolveCurrentImpactHandoffTargetV2({
      scope: fixture.scope,
      handoff: handoff({
        action: 'review-source-record',
        table: 'detailedOutlines',
        recordId: detailId,
        targetModule: 'detailed-outline',
        targetRecordId: detailId,
      }),
    })
    expect(detailTarget?.moduleRecordId).toBe(fixture.outlineNodeId)
  })

  it('拒绝错误模块、目标缺失和未登记表', async () => {
    const fixture = await seed()
    const base = handoff({
      sourceChapterId: fixture.chapterId,
      sourceOutlineNodeId: fixture.outlineNodeId,
      returnNodeId: fixture.outlineNodeId,
      recordId: fixture.chapterId,
      targetRecordId: fixture.chapterId,
    })
    await expect(resolveCurrentImpactHandoffTargetV2({
      scope: fixture.scope,
      handoff: { ...base, targetModule: 'fact-library' },
    })).resolves.toBeNull()
    await expect(resolveCurrentImpactHandoffTargetV2({
      scope: fixture.scope,
      handoff: { ...base, recordId: 999_999, targetRecordId: 999_999 },
    })).resolves.toBeNull()
    await expect(resolveCurrentImpactHandoffTargetV2({
      scope: fixture.scope,
      handoff: handoff({
        action: 'review-source-record', table: 'notRegistered', recordId: 7,
        targetModule: 'fact-library', targetRecordId: 7,
      }),
    })).resolves.toBeNull()
  })

  it('同项目另一 Work 的同表记录不能成为当前落点', async () => {
    const fixture = await seed()
    const stateCardId = await db.stateCards.add({
      projectId: fixture.projectId,
      workId: fixture.otherWorkId,
      category: 'character',
      entityName: '越界角色',
      fields: '[]',
      createdAt: fixture.now,
      updatedAt: fixture.now,
    } as any) as number
    await expect(resolveCurrentImpactHandoffTargetV2({
      scope: fixture.scope,
      handoff: handoff({
        action: 'review-derived-state', table: 'stateCards', recordId: stateCardId,
        targetModule: 'state-table', targetRecordId: stateCardId,
      }),
    })).resolves.toBeNull()
  })

  it('真实回执也只能在地址声明的目标模块消费', () => {
    const target = handoff({ targetModule: 'chapters-list' })
    expect(isImpactHandoffRouteModuleV2('chapters-list', target)).toBe(true)
    expect(isImpactHandoffRouteModuleV2('info', target)).toBe(false)
    expect(isImpactHandoffRouteModuleV2(null, target)).toBe(false)
  })

  it('工作区只把验签解析后的面板 ID 交给现有模块', () => {
    const source = readFileSync('src/pages/WorkspacePage.tsx', 'utf8')
    expect(source).toContain("!isImpactHandoffRouteModuleV2(params.get('module'), parsed)")
    expect(source).toContain('activeModule !== parsed.targetModule')
    expect(source).toContain('beginImpactManualCorrectionV1({ scope, handoff: parsed })')
    expect(source).toContain('impactHandoffTarget?.moduleRecordId')
    for (const prop of [
      'initialFactId', 'initialStateCardId', 'initialEntryId', 'initialEventId',
      'initialRelationId', 'initialCharacterId', 'initialReferenceId', 'initialNodeId',
      'initialRecordTarget',
    ]) expect(source).toContain(prop)
    expect(source).not.toContain("initialNodeId={impactHandoff?.targetRecordId")
  })
})
