import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CultivationProgressPanel from '../../src/components/cultivation/CultivationProgressPanel'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { db } from '../../src/lib/db/schema'
import { stringifyCultivationStages } from '../../src/lib/types'
import { useCultivationProgressStore } from '../../src/stores/cultivation-progress'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const chatMock = vi.hoisted(() => vi.fn())

vi.mock('../../src/lib/ai/client', () => ({
  chat: chatMock,
  resolveRequestConfig: (config: unknown) => ({ config }),
}))

vi.mock('../../src/lib/ai/config-readiness', () => ({
  isAIConfigReady: () => true,
  getAIConfigRequiredMessage: () => '',
}))

describe('WORLD-1 · 修炼进度作者确认 UI', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(async () => {
    await db.delete()
    await db.open()
    useCultivationProgressStore.setState({ events: [], loading: false })
    chatMock.mockReset()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    db.close()
  })

  it('AI 结果先停留为候选，作者确认后才落库并显示正文当前境界', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({
      name: '修炼 UI', genre: '', genres: [], status: 'drafting',
      description: '', targetWordCount: 0, enableMultiWorld: false,
      createdAt: now, updatedAt: now,
    } as any) as number
    const volumeId = await db.outlineNodes.add({
      projectId, parentId: null, type: 'volume', title: '卷一', summary: '',
      order: 0, createdAt: now, updatedAt: now,
    } as any) as number
    const nodeId = await db.outlineNodes.add({
      projectId, parentId: volumeId, type: 'chapter', title: '雷雨淬体', summary: '',
      order: 0, createdAt: now, updatedAt: now,
    } as any) as number
    const chapterId = await db.chapters.add({
      projectId, outlineNodeId: nodeId, title: '雷雨淬体',
      content: '<p>雷声滚过山谷，林舟承受九次雷击，终于正式踏入炼体境。</p>',
      wordCount: 28, status: 'draft', order: 0, notes: '',
      createdAt: now, updatedAt: now,
    } as any) as number
    const systemId = await db.cultivationSystems.add({
      projectId, worldGroupId: null, name: '剑修', description: '',
      stages: stringifyCultivationStages([
        { id: 'body', name: '炼体', parentStageIds: [] },
        { id: 'sword', name: '剑胎', parentStageIds: ['body'] },
      ]),
      createdAt: now, updatedAt: now,
    }) as number
    const characterId = await db.characters.add({
      projectId, name: '林舟', role: 'protagonist', roleWeight: 'main',
      moralAxis: 'good', orderAxis: 'lawful',
      cultivationSystemId: systemId, cultivationStageId: 'sword',
      homeWorldGroupId: null, isCrossWorld: false,
      createdAt: now, updatedAt: now,
    } as any) as number
    const project = (await db.projects.get(projectId))!
    chatMock.mockResolvedValue(JSON.stringify({
      events: [{
        characterId,
        cultivationSystemId: systemId,
        stageId: 'body',
        transition: 'enter',
        trigger: '承受九次雷击',
        quote: '正式踏入炼体境',
      }],
    }))

    await act(async () => {
      root.render(createElement(DialogProvider, null,
        createElement(CultivationProgressPanel, { project })))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await act(async () => {
      await vi.waitFor(() => expect(
        host.querySelector('select[aria-label="修炼进度来源章节"]'),
      ).not.toBeNull())
    })

    const select = host.querySelector<HTMLSelectElement>('select[aria-label="修炼进度来源章节"]')!
    await act(async () => {
      await vi.waitFor(() => expect(select.value).toBe(String(chapterId)))
    })
    const analyze = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('分析本章')) as HTMLButtonElement
    await act(async () => {
      analyze.click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('承受九次雷击'))
    })
    expect(await db.cultivationProgress.count()).toBe(0)

    const accept = host.querySelector<HTMLButtonElement>('button[aria-label="确认修炼候选"]')!
    await act(async () => {
      accept.click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await act(async () => {
      await vi.waitFor(() => expect(db.cultivationProgress.count()).resolves.toBe(1))
      await vi.waitFor(() => expect(host.textContent).toContain('正文当前：炼体'))
    })
    expect(await db.cultivationProgress.toArray()).toEqual([
      expect.objectContaining({
        characterId,
        cultivationSystemId: systemId,
        sourceChapterId: chapterId,
        stageId: 'body',
        status: 'confirmed',
      }),
    ])
  })
})
