import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../src/components/shared/Toast'
import ScenePanel from '../../src/components/outline/ScenePanel'
import { db } from '../../src/lib/db/schema'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { buildDetailedOutlineGenerationRunContractV1 } from '../../src/lib/agent/run/detailed-outline-generation-durable'
import {
  buildDetailedOutlineCopilotPatchV1,
  detailedOutlinePostStateMatchesPatchV1,
  parseDetailedOutlineCopilotDraftV1,
} from '../../src/lib/agent/detailed-outline-copilot'
import { useOutlineStore } from '../../src/stores/outline'
import { useDetailedOutlineStore } from '../../src/stores/detailed-outline'
import { useCharacterStore } from '../../src/stores/character'
import { useForeshadowStore } from '../../src/stores/foreshadow'
import type { Project, WorkspaceScope } from '../../src/lib/types'

const mocks = vi.hoisted(() => ({
  starts: [] as string[],
  sceneOutput: JSON.stringify({
    scenes: [{
      title: '潮门试探',
      summary: '守灯人试探潮门守卫的口风。',
      location: '潮门外港',
      conflict: '守卫拒绝透露失踪船只的去向。',
      pace: 'medium',
      estimatedWords: 1200,
    }],
  }),
  enhancedOutput: JSON.stringify({
    openingHook: '潮声接住上一章的余韵。',
    endingCliffhanger: '门后响起第二个人的脚步。',
    sceneLocation: '潮门外港',
    emotionArc: 'rising',
    appearingCharacterIds: [],
    foreshadowIds: [],
    scenes: [{
      title: '潮门试探',
      summary: '守灯人试探潮门守卫的口风。',
      location: '潮门外港',
      conflict: '守卫拒绝透露失踪船只的去向。',
      pace: 'medium',
      characterIds: [],
      estimatedWords: 1200,
    }],
  }),
}))

vi.mock('../../src/hooks/useAIStream', async () => {
  const React = await import('react')
  return {
    useAIStream: (sessionKey: string) => {
      const [state, setState] = React.useState({
        output: '',
        isStreaming: false,
        error: null as string | null,
        tokenUsage: null,
      })
      const start = React.useCallback(async () => {
        mocks.starts.push(sessionKey)
        const output = sessionKey.includes('detail.enhance')
          ? mocks.enhancedOutput
          : mocks.sceneOutput
        setState(current => ({ ...current, output, error: null }))
        return output
      }, [sessionKey])
      const restore = React.useCallback((value: { output: string }) => {
        setState(current => ({ ...current, output: value.output, error: null }))
      }, [])
      const reset = React.useCallback(() => {
        setState({ output: '', isStreaming: false, error: null, tokenUsage: null })
      }, [])
      return {
        ...state,
        start,
        restore,
        reset,
        stop: vi.fn(),
      }
    },
  }
})

vi.mock('../../src/components/shared/AIStreamOutput', async () => {
  const React = await import('react')
  return {
    default: (props: {
      output: string
      onAccept?: (value: string) => void
      onDismiss?: () => void
    }) => React.createElement('div', { 'data-testid': 'durable-detail-output' },
      React.createElement('span', null, props.output),
      props.onAccept
        ? React.createElement('button', {
            type: 'button',
            'data-testid': 'accept-detail',
            onClick: () => props.onAccept?.(props.output),
          }, '采纳')
        : null,
      props.onDismiss
        ? React.createElement('button', {
            type: 'button',
            'data-testid': 'dismiss-detail',
            onClick: props.onDismiss,
          }, '拒绝')
        : null,
    ),
  }
})

vi.mock('../../src/components/outline/ChapterOutlineWorkshop', () => ({
  default: () => createElement('div', { 'data-testid': 'chapter-workshop' }),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

async function waitUntil(predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    let matched = false
    await act(async () => {
      matched = await predicate()
      if (!matched) await new Promise(resolve => setTimeout(resolve, 10))
    })
    if (matched) return
  }
  throw new Error('等待 UI/IndexedDB 状态超时')
}

async function unmountLatest(): Promise<void> {
  const item = mounted.pop()
  if (!item) return
  await act(async () => item.root.unmount())
  item.host.remove()
}

async function mountScenePanel(input: {
  project: Project
  outlineNodeId: number
}): Promise<HTMLDivElement> {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(
    ToastProvider,
    null,
    createElement(ScenePanel, {
      project: input.project,
      outlineNodeId: input.outlineNodeId,
      chapterTitle: '潮门',
      chapterSummary: '守灯人抵达潮门并寻找失踪船只。',
    }),
  )))
  return host
}

async function seedWorkspace(): Promise<{
  project: Project
  scope: WorkspaceScope
  outlineNodeId: number
}> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: '潮门纪事',
    genre: 'fantasy',
    genres: ['fantasy'],
    description: '',
    status: 'drafting',
    targetWordCount: 100_000,
    worldCode: 'tide-gate',
    worldVersion: 1,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({
    projectId,
    code: 'tide-gate',
    name: '潮门世界',
    description: '',
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId,
    worldId,
    title: '潮门纪事',
    description: '',
    genres: ['fantasy'],
    status: 'drafting',
    targetWordCount: 100_000,
    createdAt: now,
    updatedAt: now,
  }) as number
  await db.projects.update(projectId, {
    activeWorldId: worldId,
    activeWorkId: workId,
    ownershipSchemaVersion: 1,
  })
  const worldGroupId = await db.worldGroups.add({
    projectId,
    name: '主世界',
    order: 0,
    createdAt: now,
    updatedAt: now,
  }) as number
  const outlineNodeId = await db.outlineNodes.add({
    projectId,
    workId,
    worldGroupId,
    parentId: null,
    type: 'chapter',
    title: '潮门',
    summary: '守灯人抵达潮门并寻找失踪船只。',
    order: 0,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const project = await db.projects.get(projectId) as Project
  useOutlineStore.setState({ nodes: [await db.outlineNodes.get(outlineNodeId)!] as any })
  return {
    project,
    scope: { projectId, worldId, workId },
    outlineNodeId,
  }
}

beforeEach(async () => {
  mocks.starts.length = 0
  await db.delete()
  await db.open()
  useOutlineStore.setState({ nodes: [], loading: false })
  useDetailedOutlineStore.setState({ detailedOutlines: [], loading: false })
  useCharacterStore.setState({ characters: [], loading: false })
  useForeshadowStore.setState({ foreshadows: [], loading: false })
})

afterEach(async () => {
  while (mounted.length) await unmountLatest()
  db.close()
  vi.clearAllMocks()
})

describe.sequential('R-HARNESS37 · 章节页场景细纲 Agent/Harness 收口', { timeout: 20_000 }, () => {
  it('严格结构门拒绝额外字段、非法枚举，并生成可核对的正式 patch', () => {
    expect(() => parseDetailedOutlineCopilotDraftV1(JSON.stringify({
      scenes: [{
        title: '潮门试探',
        summary: '试探守卫。',
        location: '外港',
        conflict: '守卫拒绝回答。',
        pace: 'medium',
        estimatedWords: 800,
        surprise: '未声明字段',
      }],
    }), 'scenes')).toThrow('未声明字段')
    expect(() => parseDetailedOutlineCopilotDraftV1(JSON.stringify({
      scenes: [{
        title: '潮门试探',
        summary: '试探守卫。',
        location: '外港',
        conflict: '守卫拒绝回答。',
        pace: 'warp',
        estimatedWords: 800,
      }],
    }), 'scenes')).toThrow('pace 不在允许范围')

    const patch = buildDetailedOutlineCopilotPatchV1({
      raw: mocks.sceneOutput,
      operation: 'scenes',
      currentScenes: [],
      chapterSummary: '守灯人抵达潮门并寻找失踪船只。',
      validCharacterIds: new Set(),
      validForeshadowIds: new Set(),
    })
    expect(patch.scenes).toHaveLength(1)
    expect(detailedOutlinePostStateMatchesPatchV1({ outlineNodeId: 7, ...patch }, 7, patch)).toBe(true)
    expect(detailedOutlinePostStateMatchesPatchV1({ outlineNodeId: 7, scenes: [] }, 7, patch)).toBe(false)
  })

  it('RunContract 从 outline.details Skill 派生读取、写入与执行版本', () => {
    const contract = buildDetailedOutlineGenerationRunContractV1({
      projectId: 1,
      worldGroupId: 2,
      outlineNodeId: 3,
      operation: 'scenes',
    })
    expect(contract.permissions.contextSourceKeys).toContain('detailedOutline')
    expect(contract.permissions.contextSourceKeys).toContain('chapterOutline')
    expect(contract.permissions.writeTargets).toEqual([expect.objectContaining({
      table: 'detailedOutlines',
      mode: 'author-confirmed',
    })])
    expect(contract.executionBindings).toEqual([expect.objectContaining({
      stepId: 'detailed-outline.generate',
      skillId: 'outline.details',
      promptVersion: 'detailed-outline-copilot-v1',
    })])
  })

  it('章节正文页生成后零业务写入，刷新恢复候选，作者确认后才完成并留下回执', async () => {
    const fixture = await seedWorkspace()
    let host = await mountScenePanel(fixture)
    await waitUntil(() => !host.querySelector<HTMLElement>('[title="AI 一键拆场景"]')!
      .className.includes('pointer-events-none'))
    await act(async () => {
      host.querySelector<HTMLElement>('[title="AI 一键拆场景"]')!.click()
    })
    await waitUntil(async () => {
      const run = await db.agentRuns.orderBy('id').last()
      if (!run?.id) return false
      return (await readAgentRunV1(fixture.scope, run.id)).projection.state === 'awaiting_confirmation'
    })
    expect(mocks.starts).toHaveLength(1)
    expect(mocks.starts[0]).toContain('detail.scene')
    expect(await db.detailedOutlines.count()).toBe(0)

    await unmountLatest()
    host = await mountScenePanel(fixture)
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button')!.click()
    })
    await waitUntil(() => !!host.querySelector('[data-testid="accept-detail"]'))
    expect(mocks.starts).toHaveLength(1)

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="accept-detail"]')!.click()
    })
    await waitUntil(async () => (await db.detailedOutlines.count()) === 1)
    const saved = await db.detailedOutlines.where('outlineNodeId').equals(fixture.outlineNodeId).first()
    expect(saved?.scenes).toHaveLength(1)
    expect(saved?.lastUsedSummary).toBe('守灯人抵达潮门并寻找失踪船只。')
    const run = await db.agentRuns.orderBy('id').last()
    expect(run?.id).toBeTypeOf('number')
    await waitUntil(async () => (
      await readAgentRunV1(fixture.scope, run!.id!)
    ).projection.state === 'completed')
    const snapshot = await readAgentRunV1(fixture.scope, run!.id!)
    expect(snapshot.projection.state).toBe('completed')
    expect(snapshot.projection.terminalReceiptHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('ScenePanel 不再自行拼上下文、直接调用 AI 或使用二次模型解析', () => {
    const source = readFileSync(join(process.cwd(), 'src/components/outline/ScenePanel.tsx'), 'utf8')
    expect(source).not.toContain('useAIStream')
    expect(source).not.toContain('assembleContext')
    expect(source).not.toContain('buildDetailSceneGeneratePrompt')
    expect(source).not.toContain('parseEnhancedDetailSmart')
    expect(source).not.toContain("target: 'detailedOutlines'")
    expect(source).toContain('useDetailedOutlineGenerationController')
    expect(source).toContain('isRecovering')
  })
})
