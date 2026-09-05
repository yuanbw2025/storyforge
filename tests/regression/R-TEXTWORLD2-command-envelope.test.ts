import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { parseTextOpenWorldCommandEnvelopeV1 } from '../../src/lib/open-world/command-contract'
import { commitTextOpenWorldCommandV1, getTextOpenWorldCommandStatusV1 } from '../../src/lib/open-world/commands'
import {
  appendProductRuntimeEvent,
  hashProductRuntimeStateV1,
  readProductRuntimeStateVersion,
} from '../../src/lib/product/runtime-core'
import { EMPTY_PRODUCT_RUNTIME_STATE, type ProductRuntimeSession, type TextOpenWorldCommandEnvelopeV1 } from '../../src/lib/types'

async function session(status: ProductRuntimeSession['status'] = 'active'): Promise<ProductRuntimeSession> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: 'TEXTWORLD vNext命令测试', genre: 'open-world', genres: ['open-world'], status: 'drafting',
    description: '', targetWordCount: 1, createdAt: now, updatedAt: now,
  } as any) as number
  const stateJson = JSON.stringify(EMPTY_PRODUCT_RUNTIME_STATE)
  const stateHash = await hashProductRuntimeStateV1(EMPTY_PRODUCT_RUNTIME_STATE)
  const value: ProductRuntimeSession = {
    projectId, worldGroupId: null, worldId: projectId, workId: projectId,
    productReleaseId: null, productBuildId: 1, runtimeSourceHash: 'a'.repeat(64),
    kind: 'text-open-world', title: 'vNext最小Session', status, rulesetVersion: 1, seed: 'command-test-seed',
    canonSnapshotJson: '{}', initialStateJson: stateJson,
    runtimeHeadSequence: 0, runtimeHeadStateJson: stateJson, runtimeHeadStateHash: stateHash,
    parentSessionId: null, parentThroughSequence: null, createdAt: now, updatedAt: now,
  }
  value.id = (await db.productRuntimeSessions.add(value)) as number
  return value
}

async function envelope(sessionId: number, overrides: Partial<TextOpenWorldCommandEnvelopeV1> = {}): Promise<TextOpenWorldCommandEnvelopeV1> {
  const base = await readProductRuntimeStateVersion(sessionId)
  return {
    schema: 'storyforge.text-open-world.command', version: 1,
    commandId: 'command.observe.1', sessionId, actorKey: 'player', actionKey: 'action.investigate-channel',
    payload: { targetKey: 'location.salt-port' }, baseSequence: base.sequence, baseStateHash: base.stateHash,
    source: 'system-action', requestedAt: Date.now(), ...overrides,
  }
}

describe('TEXTWORLD-2 · vNext command envelope and idempotency', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('严格解析命令并限制字段、来源、hash和payload体积', async () => {
    const current = await session()
    const valid = await envelope(current.id!)
    expect(parseTextOpenWorldCommandEnvelopeV1(valid)).toMatchObject({
      commandId: valid.commandId, actorKey: 'player', source: 'system-action',
    })
    expect(() => parseTextOpenWorldCommandEnvelopeV1({ ...valid, extra: true })).toThrow('字段不符合合同')
    expect(() => parseTextOpenWorldCommandEnvelopeV1({ ...valid, source: 'free-write' })).toThrow('source无效')
    expect(() => parseTextOpenWorldCommandEnvelopeV1({ ...valid, baseStateHash: 'bad' })).toThrow('不是SHA-256')
    expect(() => parseTextOpenWorldCommandEnvelopeV1({ ...valid, payload: { text: 'x'.repeat(70_000) } })).toThrow('不能超过65536字节')
  })

  it('相同commandId重试返回原事件，不追加第二次效果', async () => {
    const current = await session()
    const command = await envelope(current.id!)
    const first = await commitTextOpenWorldCommandV1(command)
    const retry = await commitTextOpenWorldCommandV1({ ...command, requestedAt: command.requestedAt + 1000 })

    expect(first).toMatchObject({ status: 'committed', replayed: false, eventSequence: 1, resultingSequence: 1 })
    expect(retry).toMatchObject({ status: 'committed', replayed: true, eventId: first.eventId, resultingStateHash: first.resultingStateHash })
    expect(await db.productRuntimeEvents.where('sessionId').equals(current.id!).count()).toBe(1)
    expect(await readProductRuntimeStateVersion(current.id!)).toEqual({ sequence: 1, stateHash: first.resultingStateHash })
  })

  it('同ID不同内容冲突，旧基线也不能提交新命令', async () => {
    const current = await session()
    const first = await envelope(current.id!)
    await commitTextOpenWorldCommandV1(first)
    await expect(commitTextOpenWorldCommandV1({ ...first, payload: { targetKey: 'location.ridge-channel' } }))
      .rejects.toThrow('相同commandId的命令内容不同')

    await expect(commitTextOpenWorldCommandV1({
      ...first, commandId: 'command.observe.stale', requestedAt: first.requestedAt + 1,
    })).rejects.toThrow('Session状态已变化')
    expect(await db.productRuntimeEvents.where('sessionId').equals(current.id!).count()).toBe(1)
  })

  it('未知传输结果可以查询，未提交命令明确返回not-found', async () => {
    const current = await session()
    const command = await envelope(current.id!)
    const committed = await commitTextOpenWorldCommandV1(command)

    const found = await getTextOpenWorldCommandStatusV1({ sessionId: current.id!, commandId: command.commandId })
    expect(found).toMatchObject({
      status: 'committed', envelope: { actionKey: command.actionKey, payload: command.payload },
      receipt: { eventId: committed.eventId, resultingStateHash: committed.resultingStateHash, replayed: true },
    })
    expect(await getTextOpenWorldCommandStatusV1({ sessionId: current.id!, commandId: 'command.missing' }))
      .toEqual({ status: 'not-found', sessionId: current.id!, commandId: 'command.missing' })
  })

  it('暂停Session不能接收新命令，治理事件不能绕过专用入口', async () => {
    const paused = await session('paused')
    await expect(commitTextOpenWorldCommandV1(await envelope(paused.id!))).rejects.toThrow('只有active Session')
    await expect(appendProductRuntimeEvent({
      sessionId: paused.id!, type: 'textworld.command.committed', payload: {},
    })).rejects.toThrow('vNext事件只能通过对应的专用命令API')
  })
})
