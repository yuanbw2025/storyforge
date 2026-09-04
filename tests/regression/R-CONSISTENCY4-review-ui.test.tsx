import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ReviewPanel from '../../src/components/editor/ReviewPanel'
import { db } from '../../src/lib/db/schema'
import { useReviewResultStore } from '../../src/stores/review-result'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'
import { seedCurrentProject } from '../helpers/current-workspace'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const startMock = vi.hoisted(() => vi.fn())

vi.mock('../../src/hooks/useAIStream', () => ({
  useAIStream: () => ({
    start: startMock,
    isStreaming: false,
    output: '',
    error: null,
  }),
}))

describe('CONSISTENCY-4 · ReviewPanel 存亡 finding 出口', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(async () => {
    await db.delete()
    await db.open()
    useReviewResultStore.setState({ byChapter: {} })
    startMock.mockReset()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    db.close()
  })

  it('真实 Dexie 章序与死亡 Canon 经闭集引用进入硬冲突卡片', async () => {
    const now = Date.now()
    const projectId = await seedCurrentProject({ name: '存亡 UI 验收', createdAt: now, updatedAt: now })
    const volumeId = await db.outlineNodes.add({
      projectId, parentId: null, type: 'volume', title: '卷一',
      summary: '', order: 0, createdAt: now, updatedAt: now,
    } as any) as number
    const deathNodeId = await db.outlineNodes.add({
      projectId, parentId: volumeId, type: 'chapter', title: '第三章',
      summary: '', order: 2, createdAt: now, updatedAt: now,
    } as any) as number
    const currentNodeId = await db.outlineNodes.add({
      projectId, parentId: volumeId, type: 'chapter', title: '第五章',
      summary: '', order: 4, createdAt: now, updatedAt: now,
    } as any) as number
    const deathChapterId = await db.chapters.add({
      projectId, outlineNodeId: deathNodeId, title: '第三章',
      content: '林飞停止了呼吸。', wordCount: 9, status: 'draft', order: 99,
      notes: '', createdAt: now, updatedAt: now,
    } as any) as number
    const currentChapterId = await db.chapters.add({
      projectId, outlineNodeId: currentNodeId, title: '第五章',
      content: '林飞推门走进议事厅，亲手展开了地图。', wordCount: 19, status: 'draft', order: 1,
      notes: '', createdAt: now, updatedAt: now,
    } as any) as number
    const characterId = await db.characters.add({
      projectId, name: '林飞',
      roleWeight: 'main', moralAxis: 'good', orderAxis: 'lawful',
      shortDescription: '', appearance: '', personality: '', background: '',
      motivation: '', abilities: '', relationships: '', arc: '',
      createdAt: now, updatedAt: now,
    } as any) as number
    await db.temporalFacts.add({
      projectId, characterId, subjectName: '林飞',
      predicate: 'aliveStatus', factKind: 'state', value: 'dead',
      sourceType: 'chapter', sourceChapterId: deathChapterId,
      sourceQuote: '林飞停止了呼吸。',
      validFromChapterId: deathChapterId, validToChapterId: null,
      status: 'confirmed', locked: false, createdAt: now, updatedAt: now,
    })
    await finalizeCurrentFixtureV1(projectId)

    const chapterContent = '林飞推门走进议事厅，亲手展开了地图。'
    startMock.mockResolvedValue(JSON.stringify({
      findings: [],
      cognitionReferences: [],
      lifecycleReferences: [{
        characterId,
        activityType: 'normal-activity',
        quote: chapterContent,
      }],
    }))
    useReviewResultStore.getState().setActiveTab(currentChapterId, 'consistency')

    await act(async () => {
      root.render(createElement(ReviewPanel, {
        projectId,
        chapterId: currentChapterId,
        outlineNodeId: currentNodeId,
        worldGroupId: null,
        chapterContent,
        chapterTitle: '第五章',
        worldContext: '',
        characterContext: '',
        prevChapterSummary: '',
        nextChapterSummary: '',
        foreshadowContext: '',
        stateContext: '',
        onClose: () => undefined,
      }))
    })
    const run = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('开始检测')) as HTMLButtonElement
    await act(async () => {
      run.click()
      await vi.waitFor(() => expect(startMock).toHaveBeenCalledOnce(), { timeout: 3000 })
      await vi.waitFor(() => expect(host.textContent).toContain('角色存亡时序'), { timeout: 3000 })
    })
    expect(host.textContent).toContain('硬冲突')
    expect(host.textContent).toContain(chapterContent)
    expect(host.textContent).toContain('林飞停止了呼吸。')
  })
})
