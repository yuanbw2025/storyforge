import { act, createElement, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import StorylineProgressPanel from '../../src/components/outline/StorylineProgressPanel'
import { db } from '../../src/lib/db/schema'
import { stringifyStages } from '../../src/lib/types'
import { useStorylineProgressStore } from '../../src/stores/storyline-progress'
import {
  acceptStorylineProgressCandidate,
  validateCanonicalStorylineCandidateV1,
} from '../../src/lib/storyline/storyline-progress'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'
import { seedCurrentProject } from '../helpers/current-workspace'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('Phase 39 · 动态故事线作者确认 UI', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(async () => {
    await db.delete()
    await db.open()
    useStorylineProgressStore.setState({ progress: [], crossings: [], loading: false })
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    db.close()
  })

  it('映射已写章节后只显示候选，作者点击采纳才落库', async () => {
    const now = Date.now()
    const projectId = await seedCurrentProject({ name: '故事线 UI', createdAt: now, updatedAt: now })
    const volumeId = await db.outlineNodes.add({
      projectId,
      parentId: null,
      type: 'volume',
      title: '卷一',
      summary: '',
      order: 0,
      createdAt: now,
      updatedAt: now,
    } as any) as number
    const nodeId = await db.outlineNodes.add({
      projectId,
      parentId: volumeId,
      type: 'chapter',
      title: '交钥匙',
      summary: '',
      order: 0,
      createdAt: now,
      updatedAt: now,
    } as any) as number
    const chapterId = await db.chapters.add({
      projectId,
      outlineNodeId: nodeId,
      title: '交钥匙',
      content: '<p>林飞交出了青铜钥匙。</p>',
      wordCount: 12,
      status: 'draft',
      order: 0,
      notes: '',
      createdAt: now,
      updatedAt: now,
    } as any) as number
    const arcId = await db.storyArcs.add({
      projectId,
      name: '寻钥主线',
      type: 'main',
      stages: stringifyStages([{
        id: 'hand-over',
        title: '交付',
        description: '交出钥匙',
        keyEvents: [],
      }]),
      description: '',
      createdAt: now,
      updatedAt: now,
    }) as number
    await finalizeCurrentFixtureV1(projectId)
    const arcs = await db.storyArcs.where('projectId').equals(projectId).toArray()
    const candidateDraft = JSON.stringify({
      progress: [{
        kind: 'progress',
        arcId,
        currentStageId: 'hand-over',
        status: 'active',
        progressNote: '钥匙已交付',
        involvedEntities: ['林飞', '青铜钥匙'],
        evidenceQuote: '交出了青铜钥匙',
      }],
      crossings: [],
      newArcs: [],
    })

    function Harness() {
      const [pending, setPending] = useState<any[]>([])
      const copilot = useMemo(() => ({
        pendingCandidates: pending,
        busy: false,
        loading: false,
        error: null,
        submitTargetedRequest: async () => {
          setPending([{
            event: { id: 1, content: candidateDraft },
            payload: {
              skillId: 'outline.storyline-progress',
              storylineProgressChapterId: chapterId,
            },
          }])
        },
        adoptCandidate: async (candidate: any) => {
          const parsed = validateCanonicalStorylineCandidateV1({
            candidate: JSON.parse(candidate.event.content),
            chapterContent: '林飞交出了青铜钥匙。',
            arcs,
          })
          await acceptStorylineProgressCandidate({ projectId, chapterId, candidate: parsed.progress[0] })
          setPending([])
        },
        rejectCandidate: async () => setPending([]),
        updateCandidate: async () => undefined,
      }), [pending])
      return createElement(StorylineProgressPanel, {
        projectId,
        arcs,
        copilot: copilot as any,
        onArcsChanged: async () => undefined,
      })
    }

    await act(async () => {
      root.render(createElement(Harness))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('交钥匙'))
    })

    const analyze = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('映射本章')) as HTMLButtonElement
    await act(async () => {
      analyze.click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('钥匙已交付'))
    })
    expect(await db.storylineProgress.count()).toBe(0)

    const accept = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('采纳本次映射')) as HTMLButtonElement
    await act(async () => {
      accept.click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await act(async () => {
      await vi.waitFor(() => expect(db.storylineProgress.count()).resolves.toBe(1))
    })
    expect((await db.storylineProgress.toArray())[0]).toEqual(expect.objectContaining({
      arcId,
      status: 'active',
      progressNote: '钥匙已交付',
    }))
  })
})
