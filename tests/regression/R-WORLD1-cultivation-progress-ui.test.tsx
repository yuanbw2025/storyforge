import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { db } from '../../src/lib/db/schema'
import { stringifyCultivationStages } from '../../src/lib/types'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { useCultivationProgressStore } from '../../src/stores/cultivation-progress'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const runnerMocks = vi.hoisted(() => ({
  generate: vi.fn(),
  readPending: vi.fn(async () => null),
  readRecoverable: vi.fn(async () => null),
  adopt: vi.fn(),
  reject: vi.fn(async () => undefined),
  abandon: vi.fn(async () => undefined),
}))

vi.mock('../../src/lib/ai/client', () => ({
  resolveRequestConfig: (config: unknown) => ({ config }),
}))

vi.mock('../../src/lib/agent/run/cultivation-progress-extraction-durable', () => ({
  generateCultivationProgressExtractionCandidateV1: runnerMocks.generate,
  readPendingCultivationProgressExtractionCandidateV1: runnerMocks.readPending,
  readRecoverableCultivationProgressExtractionRunV1: runnerMocks.readRecoverable,
  adoptCultivationProgressExtractionCandidateV1: runnerMocks.adopt,
  rejectCultivationProgressExtractionCandidateV1: runnerMocks.reject,
  abandonCultivationProgressExtractionRunV1: runnerMocks.abandon,
}))

vi.mock('../../src/lib/ai/config-readiness', () => ({
  isAIConfigReady: () => true,
  getAIConfigRequiredMessage: () => '',
}))

import CultivationProgressPanel from '../../src/components/cultivation/CultivationProgressPanel'

describe('WORLD-1 · 修炼进度作者确认 UI', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(async () => {
    await db.delete()
    await db.open()
    useCultivationProgressStore.setState({ events: [], loading: false })
    runnerMocks.generate.mockReset()
    runnerMocks.adopt.mockReset()
    runnerMocks.readPending.mockResolvedValue(null)
    runnerMocks.readRecoverable.mockResolvedValue(null)
    useAIConfigStore.setState({
      config: {
        provider: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'harness71-ui',
        apiKey: '', temperature: 0.2, maxTokens: 4_000,
      },
    })
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
    const candidate = {
      version: 1,
      kind: 'cultivation-progress-extraction-candidate',
      portable: false,
      projectId,
      worldId: -1,
      workId: -1,
      chapterId,
      worldGroupId: null,
      events: [{
        characterId,
        cultivationSystemId: systemId,
        stageId: 'body',
        trigger: '承受九次雷击',
        evidenceQuote: '正式踏入炼体境',
        sourceOffset: 22,
      }],
    }
    runnerMocks.generate.mockResolvedValue({ snapshot: { run: { id: 71 } }, candidate })
    runnerMocks.adopt.mockImplementation(async () => {
      await db.cultivationProgress.add({
        projectId, worldGroupId: null, characterId, characterName: '林舟',
        cultivationSystemId: systemId, cultivationSystemName: '剑修',
        stageId: 'body', stageName: '炼体', transition: 'enter',
        sourceChapterId: chapterId, sourceChapterTitle: '雷雨淬体',
        sourceQuote: '正式踏入炼体境', sourceOffset: 22, trigger: '承受九次雷击',
        status: 'confirmed', createdAt: now, updatedAt: now,
      } as any)
      useCultivationProgressStore.setState({ events: await db.cultivationProgress.toArray() })
      return { written: 1 }
    })

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
    await vi.waitFor(() => expect(runnerMocks.generate).toHaveBeenCalled())
    await vi.waitFor(() => expect(host.textContent).toContain('承受九次雷击'), { timeout: 3_000 })
    expect(runnerMocks.generate).toHaveBeenCalledWith(expect.objectContaining({
      chapterId, worldGroupId: null,
    }))
    expect(await db.cultivationProgress.count()).toBe(0)

    let accept = host.querySelector<HTMLButtonElement>('button[aria-label="确认所选修炼候选"]')!
    await vi.waitFor(() => {
      accept = host.querySelector<HTMLButtonElement>('button[aria-label="确认所选修炼候选"]')!
      expect(accept.disabled).toBe(false)
    })
    await act(async () => {
      accept.click()
      await vi.waitFor(() => expect(runnerMocks.adopt).toHaveBeenCalled())
      await new Promise(resolve => setTimeout(resolve, 10))
    })
    await vi.waitFor(() => expect(db.cultivationProgress.count()).resolves.toBe(1))
    expect(host.textContent).toContain('已原子写入 1 条修炼历程并完成终验')
    expect(await db.cultivationProgress.toArray()).toEqual([
      expect.objectContaining({
        characterId,
        cultivationSystemId: systemId,
        sourceChapterId: chapterId,
        stageId: 'body',
        status: 'confirmed',
      }),
    ])
    expect(runnerMocks.adopt).toHaveBeenCalledWith(expect.objectContaining({
      runId: 71, selectedIndexes: [0],
    }))
  })
})
