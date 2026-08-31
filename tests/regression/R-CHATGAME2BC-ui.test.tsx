import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import InteractionGameWorkbench from '../../src/components/character-interaction/InteractionGameWorkbench'
import ChatGamePanel from '../../src/components/simulation/ChatGamePanel'
import { DialogProvider } from '../../src/components/shared/Dialog'
import {
  createStarterInteractionGame,
  publishInteractionGameDraft,
  saveInteractionSceneTemplate,
} from '../../src/lib/character-interaction/authoring'
import { db } from '../../src/lib/db/schema'
import type { Project } from '../../src/lib/types'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function button(host: ParentNode, text: string): HTMLButtonElement {
  const result = Array.from(host.querySelectorAll('button')).find(item => item.textContent?.trim() === text)
  if (!result) throw new Error(`找不到按钮:${text}`)
  return result
}

async function click(host: ParentNode, text: string) {
  await act(async () => { button(host, text).click(); await new Promise(resolve => setTimeout(resolve, 0)) })
}

async function fill(host: ParentNode, placeholder: string, value: string) {
  const field = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[placeholder="${placeholder}"]`)
  if (!field) throw new Error(`找不到输入框:${placeholder}`)
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')?.set
    setter?.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

async function waitFor(assertion: () => void | Promise<void>) {
  const start = Date.now(); let last: unknown
  while (Date.now() - start < 8_000) {
    try { await act(async () => { await assertion() }); return } catch (reason) {
      last = reason
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    }
  }
  throw last
}

async function fixture() {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: '互动 UI', genre: 'drama', genres: ['drama'], status: 'drafting', description: '',
    targetWordCount: 20_000, createdAt: now, updatedAt: now,
    workspacePurpose: 'world-engine', workspacePurposeDecision: 'explicit',
  } as any) as number
  const ownership = await ensureWorkspaceOwnership(projectId)
  const ids: number[] = []
  for (const [index, name] of ['汀兰', '明石', '郁'].entries()) {
    ids.push(await db.characters.add({
      projectId, worldId: ownership.scope.worldId, name,
      role: 'supporting', roleWeight: 'secondary', moralAxis: 'neutral', orderAxis: 'neutral',
      shortDescription: `${name}是港口会面的参与者。`, appearance: '', personality: '', background: '',
      motivation: '', abilities: '', relationships: '[]', arc: '', speechStyle: '简洁克制',
      createdAt: now + index, updatedAt: now + index,
    } as any) as number)
  }
  return {
    scope: ownership.scope,
    project: (await db.projects.get(projectId)) as Project,
    characterIds: ids,
  }
}

describe('CHATGAME-2B/2C · author and player UI', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  beforeEach(async () => {
    await db.delete(); await db.open()
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  })
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); db.close() })

  it('旧作者工作台可维护与检查草稿，但不能绕过正式制作直接发布', async () => {
    const seeded = await fixture()
    await act(async () => {
      root.render(createElement(DialogProvider, null, createElement(InteractionGameWorkbench, { scope: seeded.scope })))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await waitFor(() => expect(host.textContent).toContain('用所选角色创建'))
    await fill(host, '聊天起点地点（可选）', '停战后的旧港口')
    await fill(host, '聊天起点时间（可选）', '故事终局十年后')
    await fill(host, '聊天背景/为什么会在这里（可选）', '用户带着一封旧信来访。')
    await fill(host, '希望这次聊天向哪里发展（可选）', '决定是否重查当年的失踪案。')
    await click(host, '用所选角色创建')
    await waitFor(() => expect(host.textContent).toContain('3 角色 · 1 场景'))
    expect(await db.interactionSceneTemplates.toCollection().first()).toMatchObject({
      location: '停战后的旧港口',
      timeLabel: '故事终局十年后',
      purpose: '用户带着一封旧信来访。',
      goalsJson: '["决定是否重查当年的失踪案。"]',
    })
    await fill(host, '新角色姓名', '洛舟')
    await fill(host, '身份、作用或与玩家的关系', '来自终局之外的访客')
    await click(host, '创建专属角色')
    await waitFor(() => expect(host.textContent).toContain('已创建互动专属角色 洛舟'))
    expect(await db.characters.count()).toBe(3)
    expect((await db.interactionCharacterProfiles.toArray()).filter(item => item.characterId == null)).toHaveLength(1)
    await click(host, '上下文检查')
    const inspect = Array.from(host.querySelectorAll('button')).find(item => item.textContent?.includes('检查 汀兰'))
    expect(inspect).toBeTruthy()
    await act(async () => { inspect!.click(); await new Promise(resolve => setTimeout(resolve, 0)) })
    await waitFor(() => expect(host.textContent).toContain('统一上下文源：interactionRuntime'))
    await click(host, '校验与发布')
    await click(host, '运行检查')
    await waitFor(() => expect(host.textContent).toContain('草稿检查通过'))
    expect(host.textContent).toContain('正式发布请进入“正式制作”')
    expect(Array.from(host.querySelectorAll('button')).some(item => item.textContent?.includes('发布新版本'))).toBe(false)
    expect(await db.gameReleases.count()).toBe(0)
  }, 20_000)

  it('玩家入口拒绝没有 ProductRelease 谱系的裸 GameRelease', async () => {
    const seeded = await fixture()
    const definition = await createStarterInteractionGame({ scope: seeded.scope, title: '港口之约', characterIds: seeded.characterIds })
    const profiles = await db.interactionCharacterProfiles.where('gameDefinitionId').equals(definition.id!).toArray()
    const scene = await db.interactionSceneTemplates.where('gameDefinitionId').equals(definition.id!).first()
    await saveInteractionSceneTemplate({
      scope: seeded.scope, gameDefinitionId: definition.id!, sceneId: scene!.id,
      sceneKey: scene!.sceneKey, title: scene!.title, purpose: scene!.purpose, location: scene!.location, timeLabel: scene!.timeLabel,
      participantKeysJson: scene!.participantKeysJson, publicKnowledgeKeysJson: scene!.publicKnowledgeKeysJson,
      goalsJson: scene!.goalsJson, endingConditionsJson: scene!.endingConditionsJson, safetyBoundariesJson: scene!.safetyBoundariesJson,
      relationshipRulesJson: JSON.stringify([{ ruleKey: 'promise.broken', label: '失约', playerText: '承认失约', fromParticipantKey: profiles[0].participantKey, toParticipantKey: 'player', dimensionKey: 'trust', delta: -2, reason: '玩家坦白自己未赴约。', significantEventKey: null }]),
      openingNodeKey: scene!.openingNodeKey, endingNodeKey: scene!.endingNodeKey,
      maxTurns: scene!.maxTurns, directorBudget: scene!.directorBudget, order: scene!.order,
    })
    await publishInteractionGameDraft({ scope: seeded.scope, gameDefinitionId: definition.id!, fixtureOnly: true })
    await act(async () => {
      root.render(createElement(ChatGamePanel, { project: seeded.project, worldGroupId: null, workspaceScope: seeded.scope }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await waitFor(() => expect(host.textContent).toContain('尚无角色互动发布'))
    expect(host.textContent).not.toContain('港口之约')
    expect(Array.from(host.querySelectorAll('button')).some(item => item.textContent?.trim() === '新建会话')).toBe(false)
    expect(await db.gameReleases.count()).toBe(1)
    expect(await db.characterInteractionProductReleases.count()).toBe(0)
    expect(await db.simulationSessions.count()).toBe(0)
  }, 20_000)

  it('在产品页列出并只读回放无 World/Work 归属的 CHATGAME-1 存档', async () => {
    const seeded = await fixture()
    const now = Date.now()
    const sessionId = await db.simulationSessions.add({
      projectId: seeded.scope.projectId, worldGroupId: null, worldId: null, workId: null,
      worldReleaseId: null, gameReleaseId: null, narrativeModuleId: null,
      kind: 'chatgame', title: '旧城门对话', status: 'active', rulesetVersion: 1, seed: 'legacy',
      canonSnapshotJson: '{}', initialStateJson: JSON.stringify({
        version: 1, clock: 0, entities: {}, memories: [], randomResults: {}, narratives: [], pendingNpcEvolutions: [],
        ttrpg: null, interaction: null, narrative: null, lastSequence: 0,
        chat: { characterKey: 'legacy:keeper', identity: { name: '守门人', description: '旧存档角色' }, scene: { title: '城门初遇', description: '雨后的城门。' }, messages: [] },
      }),
      parentSessionId: null, parentThroughSequence: null, createdAt: now, updatedAt: now,
    } as any) as number
    await db.simulationEvents.bulkAdd([
      { projectId: seeded.scope.projectId, worldGroupId: null, sessionId, sequence: 1, type: 'chat.message.recorded', actorKey: null, targetKey: null, payloadJson: JSON.stringify({ messageId: 'legacy:1', text: '城里安全吗？' }), createdAt: now + 1 },
      { projectId: seeded.scope.projectId, worldGroupId: null, sessionId, sequence: 2, type: 'chat.reply.recorded', actorKey: 'legacy:keeper', targetKey: 'legacy:keeper', payloadJson: JSON.stringify({ messageId: 'legacy:2', text: '暂时安全，但别走北街。', replyToSequence: 1, supersedesSequence: null }), createdAt: now + 2 },
    ] as any)
    await act(async () => {
      root.render(createElement(ChatGamePanel, { project: seeded.project, worldGroupId: null, workspaceScope: seeded.scope }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await waitFor(() => expect(host.textContent).toContain('旧城门对话'))
    expect(host.textContent).toContain('CHATGAME-1 · 只读')
    await click(host, '旧城门对话CHATGAME-1 · 只读')
    await waitFor(() => expect(host.textContent).toContain('别走北街'))
    expect(host.textContent).toContain('新消息、重试、检查点和分支均已关闭')
    expect(host.querySelector('textarea')).toBeNull()
  }, 20_000)
})
