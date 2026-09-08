import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import {
  appendProductRuntimeEvent,
  branchProductRuntimeSession,
  createProductRuntimeCheckpoint,
  parseProductRuntimeCheckpointV1,
  verifyProductRuntimeCheckpoint,
} from '../../src/lib/product/runtime-core'
import type { ProductRuntimeCheckpointPurposeV1 } from '../../src/lib/types'
import { createCurrentTtrpgRuntimeTestBedV1 } from '../helpers/current-product-runtime'

async function fixture() {
  return createCurrentTtrpgRuntimeTestBedV1({
    title: `G4-12 checkpoint purpose ${crypto.randomUUID()}`,
    seed: 'g4-12-checkpoint-purpose',
    withWorldGroup: true,
  })
}

async function addRuntimeEvent(sessionId: number) {
  return appendProductRuntimeEvent({
    sessionId,
    type: 'narrative.recorded',
    payload: { text: '可验证的第一个运行事件。' },
  })
}

describe('TOW-G4-12A · checkpoint purpose and portable lineage contract', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })
  afterAll(() => db.close())

  it('五种用途都在共享边界规范化，旧缺失purpose仍只读为manual', async () => {
    const { session } = await fixture()
    const cases: Array<{
      purpose: ProductRuntimeCheckpointPurposeV1
      subjectKey: string | null
    }> = [
      { purpose: 'manual', subjectKey: null },
      { purpose: 'autosave', subjectKey: null },
      { purpose: 'combat-retry', subjectKey: 'encounter.gate' },
      { purpose: 'milestone', subjectKey: 'quest.main.stage.1' },
      { purpose: 'system', subjectKey: null },
    ]
    for (const item of cases) {
      const checkpoint = await createProductRuntimeCheckpoint({
        sessionId: session.id!,
        name: item.purpose,
        purpose: item.purpose,
        subjectKey: item.subjectKey,
      })
      expect(checkpoint).toMatchObject(item)
      expect(await verifyProductRuntimeCheckpoint(checkpoint.id!)).toBe(true)
    }

    const legacy = await createProductRuntimeCheckpoint({
      sessionId: session.id!,
      name: 'legacy manual',
    })
    const legacyRow = { ...legacy } as Record<string, unknown>
    delete legacyRow.purpose
    delete legacyRow.subjectKey
    await db.productRuntimeCheckpoints.put(legacyRow as any)
    expect(parseProductRuntimeCheckpointV1(
      await db.productRuntimeCheckpoints.get(legacy.id!),
    )).toMatchObject({ purpose: 'manual', subjectKey: null })
    expect(await verifyProductRuntimeCheckpoint(legacy.id!)).toBe(true)

    await expect(createProductRuntimeCheckpoint({
      sessionId: session.id!, name: 'unknown', purpose: 'quick-save' as any,
    })).rejects.toThrow('用途无效')
    await expect(createProductRuntimeCheckpoint({
      sessionId: session.id!, name: 'manual with subject', purpose: 'manual', subjectKey: 'event.1',
    })).rejects.toThrow('不能绑定对象')
    await expect(createProductRuntimeCheckpoint({
      sessionId: session.id!, name: 'autosave with subject', purpose: 'autosave', subjectKey: 'event.1',
    })).rejects.toThrow('不能绑定对象')
    await expect(createProductRuntimeCheckpoint({
      sessionId: session.id!, name: 'milestone without subject', purpose: 'milestone',
    })).rejects.toThrow('必须绑定有效对象')
    await expect(createProductRuntimeCheckpoint({
      sessionId: session.id!, name: 'combat without subject', purpose: 'combat-retry',
    })).rejects.toThrow('必须绑定有效对象')
  })

  it('读取验真对非法purpose、配对、scope、sequence和hash一律失败关闭', async () => {
    const { session } = await fixture()
    const checkpoint = await createProductRuntimeCheckpoint({
      sessionId: session.id!, name: 'baseline', purpose: 'system',
    })
    const baseline = { ...checkpoint }
    const corruptions: Array<Partial<typeof checkpoint>> = [
      { purpose: 'quick-save' as any },
      { purpose: 'system', subjectKey: 'forbidden.subject' },
      { projectId: checkpoint.projectId + 1 },
      { throughSequence: 1 },
      { stateHash: 'f'.repeat(64) },
      { stateHash: 'not-a-hash' },
      { stateJson: JSON.stringify({ ...JSON.parse(checkpoint.stateJson), lastSequence: 1 }) },
    ]
    for (const patch of corruptions) {
      await db.productRuntimeCheckpoints.put({ ...baseline, ...patch })
      expect(await verifyProductRuntimeCheckpoint(checkpoint.id!)).toBe(false)
    }
  })

  it('导出快照在离开本机前拒绝损坏检查点与分支lineage', async () => {
    const { project, session: parent } = await fixture()
    await addRuntimeEvent(parent.id!)
    const child = await branchProductRuntimeSession({
      parentSessionId: parent.id!, throughSequence: 1,
      title: '导出校验分支', seed: 'g4-12-export-child',
    })
    const checkpoint = await createProductRuntimeCheckpoint({
      sessionId: child.id!, name: '导出校验档', purpose: 'autosave',
    })
    const checkpointBaseline = { ...checkpoint }
    const childBaseline = { ...child, parentSessionId: parent.id!, parentThroughSequence: 1 }

    await db.productRuntimeCheckpoints.put({
      ...checkpointBaseline, purpose: 'quick-save' as any,
    })
    await expect(exportProjectJSON(project.id!)).rejects.toThrow('ProductRuntimeCheckpoint')
    await db.productRuntimeCheckpoints.put(checkpointBaseline)

    await db.productRuntimeCheckpoints.put({
      ...checkpointBaseline, subjectKey: 'forbidden.subject',
    })
    await expect(exportProjectJSON(project.id!)).rejects.toThrow('ProductRuntimeCheckpoint')
    await db.productRuntimeCheckpoints.put(checkpointBaseline)

    await db.productRuntimeCheckpoints.put({
      ...checkpointBaseline, stateHash: 'f'.repeat(64),
    })
    await expect(exportProjectJSON(project.id!)).rejects.toThrow('ProductRuntimeCheckpoint')
    await db.productRuntimeCheckpoints.put(checkpointBaseline)

    await db.productRuntimeSessions.put({
      ...childBaseline, parentThroughSequence: null,
    })
    await expect(exportProjectJSON(project.id!)).rejects.toThrow('lineage')
    await db.productRuntimeSessions.put(childBaseline)

    await db.productRuntimeSessions.put({
      ...childBaseline, parentSessionId: child.id!, parentThroughSequence: 0,
    })
    await expect(exportProjectJSON(project.id!)).rejects.toThrow('lineage')
    await db.productRuntimeSessions.put(childBaseline)
    await expect(exportProjectJSON(project.id!)).resolves.toMatchObject({
      productRuntimeSessions: expect.any(Array),
      productRuntimeCheckpoints: expect.any(Array),
    })
  })

  it('当前备份保留用途并重映射分支，非法checkpoint或session lineage在写库前被拒绝', async () => {
    const { project, session: parent } = await fixture()
    await addRuntimeEvent(parent.id!)
    const child = await branchProductRuntimeSession({
      parentSessionId: parent.id!, throughSequence: 1,
      title: '检查点分支', seed: 'g4-12-child',
    })
    await createProductRuntimeCheckpoint({
      sessionId: parent.id!, name: '自动保存', purpose: 'autosave', throughSequence: 1,
    })
    await createProductRuntimeCheckpoint({
      sessionId: parent.id!, name: '系统保存', purpose: 'system', throughSequence: 1,
    })
    await createProductRuntimeCheckpoint({
      sessionId: child.id!, name: '阶段里程碑', purpose: 'milestone',
      subjectKey: 'quest.main.stage.1', throughSequence: 0,
    })
    const legacy = await createProductRuntimeCheckpoint({
      sessionId: child.id!, name: '旧手动档', throughSequence: 0,
    })
    const legacyRow = { ...legacy } as Record<string, unknown>
    delete legacyRow.purpose
    delete legacyRow.subjectKey
    await db.productRuntimeCheckpoints.put(legacyRow as any)

    const backup = await exportProjectJSON(project.id!)
    const importedProjectId = await importProjectJSON(backup)
    const importedSessions = await db.productRuntimeSessions.where('projectId').equals(importedProjectId).toArray()
    const importedParent = importedSessions.find(item => item.title !== '检查点分支')!
    const importedChild = importedSessions.find(item => item.title === '检查点分支')!
    expect(importedChild).toMatchObject({
      parentSessionId: importedParent.id,
      parentThroughSequence: 1,
      runtimeSourceHash: importedParent.runtimeSourceHash,
    })
    const importedCheckpoints = await db.productRuntimeCheckpoints
      .where('projectId').equals(importedProjectId).toArray()
    expect(importedCheckpoints.map(item => [item.name, item.purpose, item.subjectKey]))
      .toEqual(expect.arrayContaining([
        ['自动保存', 'autosave', null],
        ['系统保存', 'system', null],
        ['阶段里程碑', 'milestone', 'quest.main.stage.1'],
        ['旧手动档', 'manual', null],
      ]))
    expect(importedCheckpoints.every(item => item.sessionId === (
      item.name === '自动保存' || item.name === '系统保存' ? importedParent.id : importedChild.id
    ))).toBe(true)
    for (const item of importedCheckpoints) {
      expect(await verifyProductRuntimeCheckpoint(item.id!)).toBe(true)
    }

    const projectCount = await db.projects.count()
    const expectRejected = async (
      mutate: (copy: any) => void,
      message: string,
    ) => {
      const copy = structuredClone(backup) as any
      mutate(copy)
      await expect(importProjectJSON(copy)).rejects.toThrow(message)
      expect(await db.projects.count()).toBe(projectCount)
    }
    const autosaveIndex = backup.productRuntimeCheckpoints.findIndex(item => item.purpose === 'autosave')
    const childIndex = backup.productRuntimeSessions.findIndex(item => item.title === '检查点分支')
    await expectRejected(copy => {
      copy.productRuntimeCheckpoints[autosaveIndex].purpose = 'quick-save'
    }, 'purpose')
    await expectRejected(copy => {
      copy.productRuntimeCheckpoints[autosaveIndex].subjectKey = 'forbidden.subject'
    }, 'purpose')
    await expectRejected(copy => {
      copy.productRuntimeCheckpoints[autosaveIndex].throughSequence = 99
    }, 'lineage')
    await expectRejected(copy => {
      copy.productRuntimeCheckpoints[autosaveIndex].stateHash = 'f'.repeat(64)
    }, 'Hash 不匹配')
    await expectRejected(copy => {
      copy.productRuntimeCheckpoints[autosaveIndex]._productRuntimeSessionExportId = 99_999
    }, 'lineage')
    await expectRejected(copy => {
      copy.productRuntimeSessions[childIndex].parentThroughSequence = null
    }, 'lineage')
    await expectRejected(copy => {
      const parentIndex = copy.productRuntimeSessions.findIndex((item: any) => item.title !== '检查点分支')
      copy.productRuntimeSessions[parentIndex]._parentSessionExportId = copy.productRuntimeSessions[childIndex]._exportId
      copy.productRuntimeSessions[parentIndex].parentThroughSequence = 0
    }, '循环')
  }, 40_000)
})
