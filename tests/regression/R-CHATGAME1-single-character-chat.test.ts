import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import {
  appendChatMessage,
  appendChatReply,
  appendSimulationEvent,
  createSimulationSession,
  readSimulationState,
} from '../../src/lib/simulation/runtime'
import { buildSimulationCanonSnapshot } from '../../src/lib/simulation/canon-snapshot'

describe('CHATGAME-1 · 单角色聊天 MVP', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  async function createChatSession() {
    const projectId = 98001
    await db.projects.put({
      id: projectId,
      name: 'CHATGAME-1 测试项目',
      genre: 'fantasy',
      genres: ['fantasy'],
      status: 'drafting',
      description: '测试世界',
      targetWordCount: 10_000,
      enableMultiWorld: false,
      createdAt: 1,
      updatedAt: 1,
    } as any)
    const catalog = await buildSimulationCanonSnapshot({ projectId, worldGroupId: null, sourceKeys: ['project-world:98001'] })
    const session = await createSimulationSession({
      projectId,
      kind: 'chatgame',
      title: '城门初遇',
      canonSnapshot: catalog.snapshot,
      initialState: {
        ...structuredClone(catalog.initialState),
        entities: {
          'character:keeper': {
            entityKey: 'character:keeper',
            kind: 'character',
            sourceId: 1,
            name: '守门人',
            locationKey: null,
            lifecycleStatus: 'active',
            attributes: { role: 'npc', tone: '谨慎' },
          },
        },
        chat: {
          characterKey: 'character:keeper',
          identity: { name: '旅人', description: '刚抵达城门的旅人' },
          scene: { title: '城门初遇', description: '雨后的城门还没有关闭。' },
          messages: [],
        },
      },
    })
    await db.simulationEvents.bulkAdd([
      {
        projectId, worldGroupId: null, sessionId: session.id!, sequence: 1, type: 'chat.message.recorded',
        actorKey: null, targetKey: null, payloadJson: JSON.stringify({ messageId: 'chat:1', text: '请告诉我城里现在安全吗？' }), createdAt: 2,
      },
      {
        projectId, worldGroupId: null, sessionId: session.id!, sequence: 2, type: 'chat.reply.recorded',
        actorKey: 'character:keeper', targetKey: 'character:keeper', payloadJson: JSON.stringify({ messageId: 'chat:2', replyToSequence: 1, supersedesSequence: null, text: '守门人压低声音：暂时安全。' }), createdAt: 3,
      },
      {
        projectId, worldGroupId: null, sessionId: session.id!, sequence: 3, type: 'chat.reply.recorded',
        actorKey: 'character:keeper', targetKey: 'character:keeper', payloadJson: JSON.stringify({ messageId: 'chat:3', replyToSequence: 1, supersedesSequence: 2, text: '守门人看了看雨幕：现在还算安全，但别走北街。' }), createdAt: 4,
      },
    ] as any)
    return { projectId, session }
  }

  it('历史消息、回复与重生成仍可回放，但不再开放新写入', async () => {
    const { projectId, session } = await createChatSession()
    const state = await readSimulationState(session.id!)
    expect(state.chat?.messages).toHaveLength(3)
    expect(state.chat?.messages.find(message => message.eventSequence === 2)?.supersededBySequence).toBe(3)
    expect(state.chat?.messages.filter(message => message.supersededBySequence == null).map(message => message.text)).toEqual([
      '请告诉我城里现在安全吗？',
      '守门人看了看雨幕：现在还算安全，但别走北街。',
    ])
    expect(await db.characters.get(1)).toBeUndefined()
    const context = await assembleContext({ projectId, simulationSessionId: session.id!, sourceKeys: ['simulationRuntime'] })
    expect(context.text).toContain('旅人')
    expect(context.text).toContain('别走北街')
    await expect(appendChatMessage({ sessionId: session.id!, text: '这条不应写入。' })).rejects.toThrow('只读兼容')
    await expect(appendChatReply({ sessionId: session.id!, replyToSequence: 1, text: '旧回复', baseSequence: 3 })).rejects.toThrow('Instance Harness')
  })

  it('拒绝过期回复与越权事件，且不保留旧直连提示词入口', async () => {
    const { session } = await createChatSession()
    await appendSimulationEvent({ sessionId: session.id!, type: 'time.advanced', payload: { amount: 1 } })
    await expect(appendChatReply({ sessionId: session.id!, replyToSequence: 1, text: '你好。', baseSequence: 3 })).rejects.toThrow('Instance Harness')
    await expect(appendSimulationEvent({ sessionId: session.id!, type: 'chat.reply.recorded', payload: { text: '绕过 API' } })).rejects.toThrow('专用 API')
  })
})
