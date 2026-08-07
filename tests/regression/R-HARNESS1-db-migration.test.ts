import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

const opened: Dexie[] = []
const names: string[] = []

function track<T extends Dexie>(db: T): T {
  opened.push(db)
  return db
}

function databaseName(): string {
  const name = `harness-v51-${Math.random()}`
  names.push(name)
  return name
}

class LegacyV50DB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(50).stores({
      projects: '++id, name, createdAt, updatedAt',
      agentConversations: '++id, projectId, worldGroupId, status, updatedAt',
      agentEvents: '++id, projectId, conversationId, [conversationId+sequence], kind, createdAt',
      narrativeModules: '++id, projectId, worldId, workId, kind, status, updatedAt',
      simulationSessions: '++id, projectId, worldGroupId, worldId, workId, worldReleaseId, narrativeModuleId, kind, status, parentSessionId, updatedAt',
    })
  }
}

class HarnessV51DB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(50).stores({
      projects: '++id, name, createdAt, updatedAt',
      agentConversations: '++id, projectId, worldGroupId, status, updatedAt',
      agentEvents: '++id, projectId, conversationId, [conversationId+sequence], kind, createdAt',
      narrativeModules: '++id, projectId, worldId, workId, kind, status, updatedAt',
      simulationSessions: '++id, projectId, worldGroupId, worldId, workId, worldReleaseId, narrativeModuleId, kind, status, parentSessionId, updatedAt',
    })
    this.version(51).stores({
      agentRuns: '++id, projectId, workId, worldGroupId, conversationId, status, updatedAt',
      agentRunEvents: '++id, projectId, worldGroupId, runId, &[runId+sequence], type, createdAt',
      agentRunCheckpoints: '++id, projectId, worldGroupId, runId, &[runId+throughSequence], createdAt',
    })
  }
}

afterEach(async () => {
  for (const db of opened.splice(0)) db.close()
  for (const name of names.splice(0)) await Dexie.delete(name)
})

describe('R-HARNESS1-db-migration · v50 -> v51', () => {
  it('只创建空 run 三表，不追认历史会话为可恢复任务', async () => {
    const name = databaseName()
    const legacy = track(new LegacyV50DB(name))
    await legacy.open()
    const projectId = await legacy.table('projects').add({
      name: '旧分步骤作品',
      createdAt: 1,
      updatedAt: 2,
    })
    const conversationId = await legacy.table('agentConversations').add({
      projectId,
      worldGroupId: null,
      title: '历史会话',
      status: 'active',
      createdAt: 3,
      updatedAt: 4,
    })
    await legacy.table('agentEvents').add({
      projectId,
      conversationId,
      sequence: 1,
      kind: 'candidate',
      content: '历史候选不等于已完成 run',
      payload: '{}',
      createdAt: 4,
    })
    const moduleId = await legacy.table('narrativeModules').add({
      projectId,
      kind: 'main',
      title: '保留叙事蓝图',
      status: 'ready',
      updatedAt: 5,
    })
    legacy.close()

    const upgraded = track(new HarnessV51DB(name))
    await upgraded.open()

    expect(await upgraded.table('projects').get(projectId)).toMatchObject({ name: '旧分步骤作品' })
    expect(await upgraded.table('agentConversations').get(conversationId)).toMatchObject({ title: '历史会话' })
    expect(await upgraded.table('agentEvents').count()).toBe(1)
    expect(await upgraded.table('narrativeModules').get(moduleId)).toMatchObject({ title: '保留叙事蓝图' })
    expect(await upgraded.table('agentRuns').count()).toBe(0)
    expect(await upgraded.table('agentRunEvents').count()).toBe(0)
    expect(await upgraded.table('agentRunCheckpoints').count()).toBe(0)
  })

  it('唯一索引拒绝同一 run 的重复 sequence 和 checkpoint', async () => {
    const db = track(new HarnessV51DB(databaseName()))
    await db.open()
    const runId = await db.table('agentRuns').add({
      projectId: 1,
      status: 'planned',
      updatedAt: 1,
    })
    await db.table('agentRunEvents').add({
      projectId: 1,
      runId,
      sequence: 1,
      type: 'run.created',
      createdAt: 1,
    })
    await expect(db.table('agentRunEvents').add({
      projectId: 1,
      runId,
      sequence: 1,
      type: 'run.created',
      createdAt: 2,
    })).rejects.toMatchObject({ name: 'ConstraintError' })

    await db.table('agentRunCheckpoints').add({
      projectId: 1,
      runId,
      throughSequence: 1,
      createdAt: 1,
    })
    await expect(db.table('agentRunCheckpoints').add({
      projectId: 1,
      runId,
      throughSequence: 1,
      createdAt: 2,
    })).rejects.toMatchObject({ name: 'ConstraintError' })
  })
})
