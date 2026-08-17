import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import StoryGamePlayer from '../../src/components/text-game/StoryGamePlayer'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { db } from '../../src/lib/db/schema'
import { addNarrativeNode, createNarrativeModule } from '../../src/lib/narrative/blueprint'
import { addNarrativeBeat, addNarrativeChoice, createGameDefinition } from '../../src/lib/text-game/content'
import { publishGameDefinition } from '../../src/lib/text-game/releases'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { EMPTY_SIMULATION_STATE, type Project } from '../../src/lib/types'
import { useStoryGamePlayerStore } from '../../src/stores/story-game-player'
import { useSimulationRuntimeStore } from '../../src/stores/simulation-runtime'
import { createSimulationSession } from '../../src/lib/simulation/runtime'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function button(host: HTMLElement, text: string): HTMLButtonElement {
  const result = Array.from(host.querySelectorAll('button')).find(item => item.textContent?.trim() === text)
  if (!result) throw new Error(`找不到按钮:${text}`)
  return result
}

async function click(host: HTMLElement, text: string) {
  await act(async () => {
    button(host, text).click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

async function clickContaining(host: HTMLElement, text: string) {
  await act(async () => {
    const result = Array.from(host.querySelectorAll('button')).find(item => item.textContent?.includes(text))
    if (!result) throw new Error(`找不到包含文本的按钮:${text}`)
    result.click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

async function openGameDetails(host: HTMLElement, title: string) {
  await act(async () => {
    const result = host.querySelector<HTMLButtonElement>(`button[aria-label="查看游戏：${title}"]`)
    if (!result) throw new Error(`找不到游戏:${title}`)
    result.click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

describe('STORYGAME-1B · player loop', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  let project: Project
  let scope: { projectId: number; worldId: number; workId: number }

  beforeEach(async () => {
    localStorage.clear()
    await db.delete()
    await db.open()
    useStoryGamePlayerStore.setState({
      scope: null,
      worldGroupId: null,
      releases: [],
      sessions: [],
      selectedSessionId: null,
      events: [],
      checkpoints: [],
      runtimeState: structuredClone(EMPTY_SIMULATION_STATE),
      speakerNames: {},
      loading: false,
      busy: false,
      error: '',
    })
    const now = Date.now()
    const projectId = await db.projects.add({
      name: '雾港故事', genre: 'fantasy', genres: ['fantasy'], description: '',
      targetWordCount: 0, enableMultiWorld: false, createdAt: now, updatedAt: now,
    } as Project) as number
    const ownership = await ensureWorkspaceOwnership(projectId)
    scope = ownership.scope
    project = ownership.project
    const speakerId = await db.characters.add({
      projectId, worldId: scope.worldId, name: '守灯人', role: 'supporting',
      shortDescription: '', appearance: '', personality: '', background: '', motivation: '',
      abilities: '', relationships: '', arc: '', createdAt: now, updatedAt: now,
    } as any) as number
    const module = await createNarrativeModule({ scope, owner: 'work', kind: 'main', title: '灯塔之夜' })
    await addNarrativeNode({ scope, moduleId: module.id!, key: 'entry', kind: 'entry', title: '风暴将至' })
    await addNarrativeNode({ scope, moduleId: module.id!, key: 'safe', kind: 'ending', title: '灯火未熄' })
    await addNarrativeNode({ scope, moduleId: module.id!, key: 'dark', kind: 'ending', title: '长夜无灯' })
    await addNarrativeBeat({ scope, moduleId: module.id!, nodeKey: 'entry', beatKey: 'rain', kind: 'narration', text: '雨水拍打着灯塔。' })
    await addNarrativeBeat({ scope, moduleId: module.id!, nodeKey: 'entry', beatKey: 'keeper', kind: 'dialogue', speakerCharacterId: speakerId, text: '你来得正是时候。' })
    await addNarrativeBeat({ scope, moduleId: module.id!, nodeKey: 'safe', beatKey: 'safe-end', kind: 'system', text: '你守住了雾港的灯。' })
    await addNarrativeBeat({ scope, moduleId: module.id!, nodeKey: 'dark', beatKey: 'dark-end', kind: 'system', text: '海雾吞没了最后一束光。' })
    await addNarrativeChoice({ scope, moduleId: module.id!, sourceNodeKey: 'entry', choiceKey: 'light', text: '点亮灯火', description: '与守灯人并肩工作。', targetNodeKey: 'safe', order: 0 })
    await addNarrativeChoice({ scope, moduleId: module.id!, sourceNodeKey: 'entry', choiceKey: 'leave', text: '转身离开', targetNodeKey: 'dark', order: 1 })
    await addNarrativeChoice({ scope, moduleId: module.id!, sourceNodeKey: 'entry', choiceKey: 'locked', text: '打开密室', unavailableReason: '你还没有密室钥匙。', targetNodeKey: 'dark', availableConditionJson: '{"path":"hasKey","eq":true}', order: 2 })
    const definition = await createGameDefinition({ scope, gameKey: 'lighthouse', title: '灯塔之夜', description: '一场风暴中的短篇选择故事。', narrativeModuleId: module.id! })
    const revision = await createWorldRevision({ scope, label: '玩家测试发布', selectedNarrativeModuleIds: [module.id!] })
    const worldRelease = await publishWorldRevision(revision.id!)
    await publishGameDefinition({ scope, gameDefinitionId: definition.id!, worldReleaseId: worldRelease.id! })

    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    db.close()
  })

  async function renderPlayer() {
    await act(async () => {
      root.render(createElement(DialogProvider, null, createElement(StoryGamePlayer, {
        project, scope, worldGroupId: null,
      })))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
  }

  it('从正式发布新建游戏，键盘可达的选择自动保存并刷新恢复到通关页', async () => {
    await renderPlayer()
    await viWaitFor(() => expect(host.textContent).toContain('灯塔之夜'))
    expect(host.textContent).toContain('分支叙事游戏库')
    expect(await db.simulationSessions.count()).toBe(0)
    await openGameDetails(host, '灯塔之夜')
    expect(host.textContent).toContain('3 个场景')
    expect(await db.simulationSessions.count()).toBe(0)
    await click(host, '开始新游戏')
    await viWaitFor(() => expect(host.textContent).toContain('雨水拍打着灯塔。'))
    expect(host.textContent).toContain('守灯人')
    expect(host.textContent).toContain('你来得正是时候。')
    expect(host.querySelector('.storygame-story-stage')).not.toBeNull()
    expect(host.querySelector('.storygame-cast')).not.toBeNull()
    expect(host.querySelector('.storygame-speaker-mark')?.textContent).toBe('守')
    const locked = button(host, '3打开密室')
    expect(locked.disabled).toBe(true)
    expect(locked.getAttribute('aria-describedby')).toMatch(/^choice-reason-/)
    expect(host.textContent).toContain('你还没有密室钥匙。')
    expect(useStoryGamePlayerStore.getState().checkpoints).toHaveLength(1)
    await useSimulationRuntimeStore.getState().load(project.id!, null)
    expect(useSimulationRuntimeStore.getState().sessions).toHaveLength(0)

    await click(host, '1点亮灯火与守灯人并肩工作。')
    await viWaitFor(() => expect(host.textContent).toContain('ENDING REACHED'))
    expect(host.textContent).toContain('灯火未熄')
    expect(host.textContent).toContain('你守住了雾港的灯。')
    expect(await db.simulationEvents.count()).toBe(5)

    await act(async () => {
      root.unmount()
      root = createRoot(host)
      root.render(createElement(DialogProvider, null, createElement(StoryGamePlayer, {
        project, scope, worldGroupId: null,
      })))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await viWaitFor(() => expect(host.textContent).toContain('灯火未熄'))
    expect(host.textContent).toContain('5回放事件')
  })

  it('正式游戏库只展示分支叙事发布，不把 AVG 等其他产品混入错误卡片', async () => {
    const storyRelease = await db.gameReleases.toCollection().first()
    expect(storyRelease).toBeTruthy()
    const { id: _id, ...foreignRelease } = storyRelease!
    await db.gameReleases.add({
      ...foreignRelease,
      version: 99,
      label: 'AVG 不应出现在分支叙事书架',
      manifestJson: JSON.stringify({ productType: 'avg' }),
      contentHash: 'f'.repeat(64),
      createdAt: Date.now() + 1,
    })
    const { id: _storyId, ...sameStory } = storyRelease!
    await db.gameReleases.add({
      ...sameStory,
      version: storyRelease!.version + 1,
      label: '同一故事的较新不可变版本',
      createdAt: Date.now() + 2,
    })

    await renderPlayer()
    await viWaitFor(() => expect(host.textContent).toContain('灯塔之夜'))
    expect(host.textContent).not.toContain('AVG 不应出现在分支叙事书架')
    expect(Array.from(host.querySelectorAll('.textgame-catalog-list>article'))).toHaveLength(1)
    expect(useStoryGamePlayerStore.getState().releases).toHaveLength(2)
  })

  it('从中段检查点 fork 后改选另一结局且原存档保持不变', async () => {
    await renderPlayer()
    await viWaitFor(() => expect(host.textContent).toContain('灯塔之夜'))
    await openGameDetails(host, '灯塔之夜')
    await click(host, '开始新游戏')
    await viWaitFor(() => expect(host.textContent).toContain('风暴将至'))
    await click(host, '存档')
    await click(host, '保存当前检查点')
    await viWaitFor(() => expect(host.textContent).toContain('保存检查点'))
    await act(async () => {
      const input = document.querySelector<HTMLInputElement>('[role="dialog"] input')!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '风暴前')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      button(document.body, '保存').click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await viWaitFor(() => expect(host.textContent).toContain('风暴前'))
    await click(host, '故事')
    await click(host, '1点亮灯火与守灯人并肩工作。')
    await viWaitFor(() => expect(host.textContent).toContain('灯火未熄'))
    const originalId = useStoryGamePlayerStore.getState().selectedSessionId!
    await click(host, '从检查点改选')
    await click(host, '从这里分支')
    await viWaitFor(() => expect(host.textContent).toContain('从检查点创建新时间线'))
    await act(async () => {
      button(document.body, '创建分支').click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await click(host, '故事')
    await viWaitFor(() => expect(button(host, '2转身离开').disabled).toBe(false))
    await click(host, '2转身离开')
    await viWaitFor(() => expect(host.textContent).toContain('长夜无灯'))
    expect(await db.simulationSessions.count()).toBe(2)
    const originalState = await import('../../src/lib/simulation/runtime').then(module => module.readSimulationState(originalId))
    expect(originalState.narrative?.endingKey).toBe('safe')
  })

  it('旧 WORLD-2F storygame 存档保留读取、推进与兼容标记，但不出现在新建入口', async () => {
    const worldRelease = await db.worldReleases.where('projectId').equals(scope.projectId).first()
    const legacyId = await db.simulationSessions.add({
      projectId: scope.projectId,
      kind: 'storygame',
      title: '旧版灯塔存档',
      status: 'active',
      rulesetVersion: 1,
      seed: 'legacy-storygame',
      canonSnapshotJson: JSON.stringify({ version: 1, sources: [] }),
      parentSessionId: null,
      parentThroughSequence: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      initialStateJson: JSON.stringify({
        ...structuredClone(EMPTY_SIMULATION_STATE),
        narrative: {
          schema: 'storyforge.simulation-narrative',
          version: 1,
          sourceModuleId: null,
          sourceModuleExportId: null,
          moduleKind: 'main',
          moduleTitle: '旧版故事',
          sourceHash: 'a'.repeat(64),
          nodes: [
            { key: 'old-entry', kind: 'entry', title: '旧入口', summary: '保留旧存档', conditionJson: '{}', effectsJson: '[]', successorKeys: ['old-end'] },
            { key: 'old-end', kind: 'ending', title: '旧结局', summary: '', conditionJson: '{}', effectsJson: '[]', successorKeys: [] },
          ],
          currentNodeKey: 'old-entry',
          visitedNodeKeys: ['old-entry'],
          availableNodeKeys: ['old-end'],
          variables: {},
          completed: false,
        },
      }),
    }) as number
    await expect(createSimulationSession({
      projectId: scope.projectId,
      kind: 'storygame',
      title: '不得再走旧入口',
      initialState: structuredClone(EMPTY_SIMULATION_STATE),
    })).rejects.toThrow('必须通过不可变 GameRelease')
    await db.simulationSessions.update(legacyId, {
      worldId: scope.worldId,
      workId: scope.workId,
      worldReleaseId: worldRelease?.id ?? null,
    })

    await renderPlayer()
    await viWaitFor(() => expect(host.textContent).toContain('旧版灯塔存档'))
    expect(host.textContent).toContain('分支叙事游戏库')
    await clickContaining(host, '旧版灯塔存档')
    await viWaitFor(() => expect(host.textContent).toContain('旧版兼容模式'))
    expect(host.textContent).toContain('旧 WORLD-2F 兼容存档')
    await click(host, '1旧结局')
    await viWaitFor(() => expect(host.textContent).toContain('ENDING REACHED'))
    expect(host.textContent).toContain('旧结局')
    expect(useStoryGamePlayerStore.getState().releases).toHaveLength(1)
    expect(host.querySelectorAll('.textgame-catalog-list>article')).toHaveLength(0)
  })
})

async function viWaitFor(assertion: () => void | Promise<void>) {
  const started = Date.now()
  let lastError: unknown
  while (Date.now() - started < 3_000) {
    try {
      await act(async () => {
        await assertion()
      })
      return
    } catch (error) {
      lastError = error
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
      })
    }
  }
  throw lastError
}
