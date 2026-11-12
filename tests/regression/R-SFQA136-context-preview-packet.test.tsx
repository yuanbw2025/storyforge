import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import ChapterContextPreview from '../../src/components/editor/ChapterContextPreview'
import ChapterEditor from '../../src/components/editor/ChapterEditor'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { ToastProvider } from '../../src/components/shared/Toast'
import { db } from '../../src/lib/db/schema'
import * as gateway from '../../src/lib/prose/gateway-context'
import { runChapterPostAdoptionV1 } from '../../src/lib/prose/post-adoption-runner'
import { authorizeChapterPostAdoptionV1, createChapterPostAdoptionDurableRunV1 } from '../../src/lib/agent/run/chapter-post-adoption-durable'
import { readOwnedRows, stampNewRecord } from '../../src/lib/workspace/scope'
import type { StateCard } from '../../src/lib/types'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { useStateCardStore } from '../../src/stores/state-card'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { useChapterStore } from '../../src/stores/chapter'
import { useOutlineStore } from '../../src/stores/outline'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const config = { provider: 'agnes' as const, model: 'agnes-2.5-flash', baseUrl: 'https://example.invalid/v1',
  apiKey: 'synthetic-only', temperature: 0, maxTokens: 1000 }
const mounts: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []
beforeEach(async () => {
  await db.delete(); await db.open()
  useAIConfigStore.setState({ config, taskRoutes: {} })
  useStateCardStore.setState({ cards: [], loading: false })
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('136 preview must not dispatch a model') }))
})
afterEach(async () => {
  for (const { host, root } of mounts.splice(0)) { await act(async () => root.unmount()); host.remove() }
  vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close()
})

async function fixture(name = '136当前作品', names = ['阿明', '阿青']) {
  const f = await seedCurrentWorkspace(name, { genres: ['realism'] })
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(f.scope, 'outlineNodes', {
    projectId: f.scope.projectId, parentId: null, type: 'chapter', title: '收店', summary: '阿明收好工具后关灯。', order: 0, createdAt: 1, updatedAt: 1,
  }, { owner: 'work' })) as number
  const chapterId = await db.chapters.add(stampNewRecord(f.scope, 'chapters', {
    projectId: f.scope.projectId, outlineNodeId, title: '收店', content: '<p>阿明收好工具后关灯。</p>', wordCount: 11,
    status: 'draft', order: 0, notes: '', createdAt: 1, updatedAt: 1,
  }, { owner: 'work' })) as number
  await db.detailedOutlines.add(stampNewRecord(f.scope, 'detailedOutlines', {
    projectId: f.scope.projectId, outlineNodeId, scenes: [{ sceneId: 'closing', title: '收店', summary: '阿明收好工具后关灯。', characterIds: [],
      conflict: '', location: '小店', pace: 'slow', estimatedWords: 500, notes: '' }], createdAt: 1, updatedAt: 1,
  }, { owner: 'work' }))
  for (const entityName of names) await db.stateCards.add(stampNewRecord(f.scope, 'stateCards', {
    projectId: f.scope.projectId, category: 'character', entityName, fields: JSON.stringify([{ key: '状态', value: `${entityName}的专属状态` }]),
    createdAt: 1, updatedAt: 1,
  }, { owner: 'work' }))
  return { ...f, outlineNodeId, chapterId }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
const prepare = (f: Fixture, operation: 'generate' | 'continue' | 'review' = 'generate') => gateway.prepareProseGatewayAssemblyV1({
  projectId: f.scope.projectId, scope: f.scope, chapterId: f.chapterId, outlineNodeId: f.outlineNodeId,
  worldGroupId: null, operation, authorRequest: '阿明收好工具后关灯。', config,
})
function mounted() {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); mounts.push({ host, root }); return { host, root }
}
async function loadEditor(f: Fixture) {
  await useOutlineStore.getState().loadAll(f.scope.projectId)
  await useChapterStore.getState().loadAll(f.scope.projectId)
  useChapterStore.getState().selectChapter(f.chapterId)
  await useStateCardStore.getState().loadAll(f.scope)
}
function renderEditor(root: ReturnType<typeof createRoot>, f: Fixture) {
  root.render(createElement(MemoryRouter, null, createElement(ToastProvider, null,
    createElement(DialogProvider, null, createElement(ChapterEditor, { project: f.project, outlineNodeId: f.outlineNodeId })))))
}
function button(host: HTMLElement, text: string) {
  const found = [...host.querySelectorAll('button')].find(value => value.textContent?.trim() === text)
  if (!found) throw new Error(`Missing button ${text}`)
  return found
}
async function settle(condition: () => boolean, host: HTMLElement) {
  const deadline = Date.now() + 4000
  while (Date.now() < deadline) {
    let done = false
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); done = condition() })
    if (done) return
  }
  throw new Error(`136 UI did not settle: ${host.textContent?.slice(-900)}`)
}

it.each(['partial', 'all', 'none', 'empty'] as const)('real mandatory packet, rather than %s lexical matching, defines the preview sources', async mode => {
  const f = await fixture('136匹配反例', mode === 'empty' ? [] : undefined)
  await useStateCardStore.getState().loadAll(f.scope)
  const { cards, buildSelectiveStateContext } = useStateCardStore.getState()
  const selection = buildSelectiveStateContext(mode === 'all' ? '阿明与阿青' : mode === 'partial' ? '阿明' : '无关的海潮', [])
  expect(selection.matchedIds).toHaveLength(mode === 'empty' ? 0 : mode === 'partial' ? 1 : 2)
  const assembly = await prepare(f)
  const actualIds = [...new Set(assembly.contextGatewayExecution.contextPacket.sourceRefs.filter(ref => ref.table === 'stateCards').map(ref => ref.recordId))]
  expect(actualIds.sort()).toEqual(cards.map(card => card.id!).sort())
  expect(assembly.contextGatewayExecution.retrievalTrace.mandatory.some(ref => ref.resourceKey.endsWith(':consistency-dossier'))).toBe(true)
  const { root, host } = mounted()
  await act(async () => root.render(createElement(ChapterContextPreview, {
    operation: 'generate', assembly, onOperationChange() {}, onRefresh() {}, stateCards: cards,
    matchedIds: selection.matchedIds, extraIds: [], stateListExpanded: true, onToggleStateList() {}, onToggleStateCard() {},
  })))
  const packet = host.querySelector('[data-testid="context-preview-packet"]')!
  expect(packet.textContent).toContain(`已读取状态卡 ${cards.length} 张`)
  expect(packet.textContent).toContain('一致性档案为必读资料')
  expect(packet.textContent).toContain(`操作：generate`)
  expect(packet.textContent).toContain(assembly.contextGatewayExecution.contextPacket.packetHash)
  expect(packet.querySelector('pre')?.textContent).toBe(assembly.contextGatewayExecution.contextPacket.content)
  expect(host.textContent).not.toContain('状态卡注入（1/2）')
  expect(assembly.contextGatewayExecution.metrics.additionalPlanningModelCalls).toBe(0)
  expect(fetch).not.toHaveBeenCalled()
})

it('time-boundary and damaged-card guards remain authoritative in the actual packet', async () => {
  const f = await fixture()
  const laterOutline = await db.outlineNodes.add(stampNewRecord(f.scope, 'outlineNodes', {
    projectId: f.scope.projectId, parentId: null, type: 'chapter', title: '次日', summary: '', order: 1, createdAt: 1, updatedAt: 1,
  }, { owner: 'work' })) as number
  const laterChapter = await db.chapters.add(stampNewRecord(f.scope, 'chapters', {
    projectId: f.scope.projectId, outlineNodeId: laterOutline, title: '次日', content: '<p>次日。</p>', wordCount: 2, status: 'draft', order: 1, notes: '', createdAt: 1, updatedAt: 1,
  }, { owner: 'work' })) as number
  const cards = await db.stateCards.toArray()
  await db.stateCards.update(cards[1].id!, { lastChapterId: laterChapter })
  const assembly = await prepare(f)
  expect(assembly.contextGatewayExecution.contextPacket.sourceRefs.filter(ref => ref.table === 'stateCards').map(ref => ref.recordId)).toContain(cards[0].id)
  expect(assembly.contextGatewayExecution.contextPacket.sourceRefs.filter(ref => ref.table === 'stateCards').map(ref => ref.recordId)).not.toContain(cards[1].id)
  expect(assembly.contextGatewayExecution.contextPacket.content).not.toContain('阿青的专属状态')
  await db.stateCards.update(cards[0].id!, { fields: '{broken' })
  await expect(prepare(f)).rejects.toThrow()
  expect((await db.stateCards.get(cards[0].id!))?.fields).toBe('{broken')
  expect(fetch).not.toHaveBeenCalled()
})

it('actual editor switches generate/continue/review packets and preserves organization focus selection without model dispatch', async () => {
  const f = await fixture(); await loadEditor(f)
  const actual = gateway.prepareProseGatewayAssemblyV1
  const packets: Array<{ input: Parameters<typeof actual>[0]; assembly: Awaited<ReturnType<typeof actual>> }> = []
  vi.spyOn(gateway, 'prepareProseGatewayAssemblyV1').mockImplementation(async input => {
    const assembly = await actual(input); packets.push({ input, assembly }); return assembly
  })
  const { root, host } = mounted(); await act(async () => renderEditor(root, f))
  await act(async () => button(host, '上下文').click())
  await settle(() => !!host.querySelector('[data-testid="context-preview-packet"]'), host)
  const preview = () => host.querySelector('section[aria-label="章节上下文预览"]')!
  expect(preview().textContent).toContain('生成正文 · 已读取状态卡 2 张')
  await act(async () => button(host, '展开整理关注卡').click())
  const extra = host.querySelector('button[aria-label="整理关注卡：阿青"]') as HTMLButtonElement
  expect(extra.getAttribute('aria-pressed')).toBe('false')
  const firstHash = preview().querySelector('code')!.textContent
  await act(async () => extra.click())
  expect(extra.getAttribute('aria-pressed')).toBe('true')
  expect(preview().querySelector('code')?.textContent).toBe(firstHash)
  await act(async () => extra.click())
  expect(extra.getAttribute('aria-pressed')).toBe('false')
  for (const operation of ['continue', 'review'] as const) {
    await act(async () => {
      const select = host.querySelector('select[aria-label="上下文预览用途"]') as HTMLSelectElement
      select.value = operation; select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(preview().querySelector('[data-testid="context-preview-packet"]')).toBeNull()
    await settle(() => !!preview().querySelector('[data-testid="context-preview-packet"]'), host)
    const received = packets.filter(value => value.input.operation === operation).slice(-1)[0]!
    expect(preview().textContent).toContain(`操作：${operation}`)
    expect(preview().querySelector('code')?.textContent).toBe(received.assembly.contextGatewayExecution.contextPacket.packetHash)
    expect(received.input.scope).toEqual(f.scope)
  }
  expect(preview().textContent).toContain('评审面板的本轮补充要求')
  expect(packets.some(value => value.input.operation === 'review' && value.input.scope === undefined)).toBe(true)
  expect(fetch).not.toHaveBeenCalled()
})

it('late old-work packets cannot replace the new owner; explicit refresh surfaces a real read failure', async () => {
  const f = await fixture('136原作品'); const next = await fixture('136新作品', ['新人物'])
  await loadEditor(f)
  const actual = gateway.prepareProseGatewayAssemblyV1
  let release!: () => void
  let held = false
  vi.spyOn(gateway, 'prepareProseGatewayAssemblyV1').mockImplementation(async input => {
    const value = await actual(input)
    if (input.scope && input.projectId === f.scope.projectId) {
      held = true; await new Promise<void>(resolve => { release = resolve })
    }
    return value
  })
  const { root, host } = mounted(); await act(async () => renderEditor(root, f))
  await act(async () => button(host, '上下文').click())
  await settle(() => held, host)
  await act(async () => { await loadEditor(next); renderEditor(root, next) })
  await settle(() => !!host.querySelector('[data-testid="context-preview-packet"]'), host)
  const packet = () => host.querySelector('[data-testid="context-preview-packet"]')!
  expect(packet().textContent).toContain('新人物的专属状态')
  const newHash = packet().querySelector('code')!.textContent
  await act(async () => release())
  expect(packet().querySelector('code')!.textContent).toBe(newHash)
  expect(packet().textContent).not.toContain('阿青的专属状态')
  const nextCards = await readOwnedRows<StateCard>(next.scope, 'stateCards', { owner: 'work' })
  expect(nextCards).toHaveLength(1)
  const nextCard = nextCards[0]
  await db.stateCards.update(nextCard.id!, { fields: '{broken' })
  await act(async () => button(host, '刷新预览').click())
  expect(host.querySelector('[data-testid="context-preview-packet"]')).toBeNull()
  await settle(() => !!host.querySelector('section[aria-label="章节上下文预览"] [role="alert"]'), host)
  expect(host.querySelector('[data-testid="context-preview-packet"]')).toBeNull()
  expect(fetch).not.toHaveBeenCalled()
})

it.each([false, true])('manual organization receives the original persisted focus selection, extra=%s', async extra => {
  const f = await fixture(); await loadEditor(f)
  const requests: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, options?: RequestInit) => {
    requests.push(String(options?.body)); return new Response('{"error":{"message":"synthetic forbidden"}}', { status: 403 })
  }))
  const { root, host } = mounted(); await act(async () => renderEditor(root, f))
  await act(async () => button(host, '上下文').click())
  await settle(() => !!host.querySelector('[data-testid="context-preview-packet"]'), host)
  if (extra) {
    await act(async () => button(host, '展开整理关注卡').click())
    await act(async () => (host.querySelector('button[aria-label="整理关注卡：阿青"]') as HTMLButtonElement).click())
  }
  await act(async () => button(host, '整理本章').click())
  await settle(() => requests.length === 1, host)
  const request = JSON.parse(requests[0]) as { messages: Array<{ content: string }> }
  const user = request.messages.find(message => message.content.includes('【当前状态】'))!.content
  const focus = user.split('【当前状态】\n')[1].split('\n\n【已知物品名】')[0]
  expect(focus).toContain('阿明的专属状态')
  expect(focus.includes('阿青的专属状态')).toBe(extra)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(await db.stateCards.count()).toBe(2)
})

it('organization focus is local to the selected chapter within the same Work', async () => {
  const f = await fixture(); await loadEditor(f)
  const nextOutline = await db.outlineNodes.add(stampNewRecord(f.scope, 'outlineNodes', {
    projectId: f.scope.projectId, parentId: null, type: 'chapter', title: '次日', summary: '阿明再度收店。', order: 1, createdAt: 1, updatedAt: 1,
  }, { owner: 'work' })) as number
  const nextChapter = await db.chapters.add(stampNewRecord(f.scope, 'chapters', {
    projectId: f.scope.projectId, outlineNodeId: nextOutline, title: '次日', content: '<p>阿明再度收店。</p>', wordCount: 7, status: 'draft', order: 1, notes: '', createdAt: 1, updatedAt: 1,
  }, { owner: 'work' })) as number
  const { root, host } = mounted(); await act(async () => renderEditor(root, f))
  await act(async () => button(host, '上下文').click())
  await act(async () => button(host, '展开整理关注卡').click())
  const extraButton = () => host.querySelector('button[aria-label="整理关注卡：阿青"]') as HTMLButtonElement
  await act(async () => extraButton().click())
  expect(extraButton().getAttribute('aria-pressed')).toBe('true')
  await act(async () => {
    await useOutlineStore.getState().loadAll(f.scope.projectId)
    await useChapterStore.getState().loadAll(f.scope.projectId)
    useChapterStore.getState().selectChapter(nextChapter)
    renderEditor(root, { ...f, outlineNodeId: nextOutline, chapterId: nextChapter })
  })
  expect(extraButton().getAttribute('aria-pressed')).toBe('false')
  expect(host.textContent).toContain('本章整理关注卡（1/2）')
  expect(fetch).not.toHaveBeenCalled()
})

it.each([false, true])('authorized post-adoption organization retains selected extra IDs, extra=%s', async extra => {
  const f = await fixture()
  await db.works.update(f.scope.workId, { postAdoptionTaskTypes: ['organization'] })
  const run = await createChapterPostAdoptionDurableRunV1({ scope: f.scope, worldGroupId: null, chapterId: f.chapterId })
  await authorizeChapterPostAdoptionV1({ scope: f.scope, snapshot: run, source: 'author-click' })
  const requests: string[] = []
  const controller = new AbortController()
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, options?: RequestInit) => {
    requests.push(String(options?.body)); controller.abort()
    return new Response('{"error":{"message":"synthetic forbidden"}}', { status: 403 })
  }))
  const chapter = (await db.chapters.get(f.chapterId))!
  const card = (await db.stateCards.toArray()).find(value => value.entityName === '阿青')!
  await runChapterPostAdoptionV1({ project: f.project, aiConfig: config, extraStateIds: extra ? [card.id!] : [],
    task: { chapterId: f.chapterId, chapterTitle: chapter.title, chapterContent: chapter.content, chapterPlainText: '阿明收好工具后关灯。', resumeRunId: run.run.id },
    signal: controller.signal,
  })
  expect(fetch).toHaveBeenCalledTimes(1)
  const request = JSON.parse(requests[0]) as { messages: Array<{ content: string }> }
  const focus = request.messages.find(message => message.content.includes('【当前状态】'))!.content.split('【当前状态】\n')[1].split('\n\n【已知物品名】')[0]
  expect(focus).toContain('阿明的专属状态')
  expect(focus.includes('阿青的专属状态')).toBe(extra)
  expect(await db.stateCards.count()).toBe(2)
})
