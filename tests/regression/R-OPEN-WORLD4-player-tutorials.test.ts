import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_TEXT_OPEN_WORLD_PLAYER_TUTORIAL_PROGRESS_V1,
  TEXT_OPEN_WORLD_PLAYER_TUTORIAL_LIMITS_V1,
  TEXT_OPEN_WORLD_PLAYER_TUTORIAL_PROGRESS_SCHEMA_V1,
  TEXT_OPEN_WORLD_PLAYER_TUTORIAL_STORAGE_PREFIX_V1,
  TEXT_OPEN_WORLD_SYSTEM_TUTORIAL_STEPS_V1,
  createTextOpenWorldPlayerTutorialStoreV1,
  parseTextOpenWorldPlayerTutorialProgressV1,
  projectTextOpenWorldPlayerTutorialsV1,
  readTextOpenWorldPlayerTutorialProgressV1,
  textOpenWorldPlayerTutorialStorageKeyV1,
  type TextOpenWorldPlayerTutorialProgressV1,
  type TextOpenWorldPlayerTutorialScopeV1,
  type TextOpenWorldPlayerTutorialStorageV1,
  type TextOpenWorldTutorialFeatureV1,
} from '../../src/lib/open-world/player-tutorials'

const RELEASE_SCOPE: TextOpenWorldPlayerTutorialScopeV1 = {
  productionKey: 'text-open-world.salt-ridge',
  runtimeChannel: 'release',
}

function progress(
  overrides: Partial<TextOpenWorldPlayerTutorialProgressV1> = {},
): TextOpenWorldPlayerTutorialProgressV1 {
  return {
    schema: TEXT_OPEN_WORLD_PLAYER_TUTORIAL_PROGRESS_SCHEMA_V1,
    version: 1,
    completedStepKeys: [],
    skippedStepKeys: [],
    suppressAutomatic: false,
    ...overrides,
  }
}

function allSystemFeatures(): Partial<Record<TextOpenWorldTutorialFeatureV1, boolean>> {
  return {
    scene: true,
    'system-actions': true,
    'fixed-choices': true,
    'natural-input': true,
    quests: true,
    'map-travel': true,
    combat: true,
    'inventory-equipment': true,
    crafting: true,
    shop: true,
    'formal-save': true,
  }
}

describe('Text Open World G4-13A · 浏览器本地教程进度与纯投影', () => {
  beforeEach(() => localStorage.clear())

  it('严格解析v1状态，限制键数量与长度，并拒绝unknown field和凭证形状', () => {
    const parsed = parseTextOpenWorldPlayerTutorialProgressV1(progress({
      completedStepKeys: ['system.quests', 'system.opening'],
      skippedStepKeys: ['authored.tutorial.investigate'],
      suppressAutomatic: true,
    }))
    expect(parsed).toEqual({
      schema: TEXT_OPEN_WORLD_PLAYER_TUTORIAL_PROGRESS_SCHEMA_V1,
      version: 1,
      completedStepKeys: ['system.opening', 'system.quests'],
      skippedStepKeys: ['authored.tutorial.investigate'],
      suppressAutomatic: true,
    })
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed?.completedStepKeys)).toBe(true)

    const invalid = [
      { ...progress(), version: 2 },
      { ...progress(), apiKey: 'sk-proj-SENTINEL' },
      { ...progress(), completedStepKeys: ['system.opening', 'system.opening'] },
      { ...progress(), completedStepKeys: ['system.opening'], skippedStepKeys: ['system.opening'] },
      { ...progress(), completedStepKeys: ['opening'] },
      { ...progress(), completedStepKeys: ['authored.sk-proj-SENTINEL'] },
      { ...progress(), completedStepKeys: [`system.${'x'.repeat(
        TEXT_OPEN_WORLD_PLAYER_TUTORIAL_LIMITS_V1.maximumStepKeyLength,
      )}`] },
      { ...progress(), completedStepKeys: Array.from(
        { length: TEXT_OPEN_WORLD_PLAYER_TUTORIAL_LIMITS_V1.maximumTrackedStepKeys + 1 },
        (_, index) => `authored.step-${index}`,
      ) },
    ]
    invalid.forEach(value => expect(parseTextOpenWorldPlayerTutorialProgressV1(value)).toBeNull())

    const key = textOpenWorldPlayerTutorialStorageKeyV1(RELEASE_SCOPE)
    localStorage.setItem(key, JSON.stringify({ ...progress(), token: 'secret' }))
    expect(readTextOpenWorldPlayerTutorialProgressV1(RELEASE_SCOPE))
      .toBe(DEFAULT_TEXT_OPEN_WORLD_PLAYER_TUTORIAL_PROGRESS_V1)
    expect(() => createTextOpenWorldPlayerTutorialStoreV1(RELEASE_SCOPE)
      .complete('authored.sk-live-SENTINEL')).toThrow(/stepKey无效/)
  })

  it('按产品、运行通道与可选用户隔离，release进度自然跨Release和Session共享', () => {
    const sameProductAnotherReleaseOrSession = { ...RELEASE_SCOPE }
    const preview = { ...RELEASE_SCOPE, runtimeChannel: 'build-preview' as const }
    const anotherProduct = { ...RELEASE_SCOPE, productionKey: 'text-open-world.other' }
    const anotherUser = { ...RELEASE_SCOPE, userId: 'player.beta' }
    const keys = [RELEASE_SCOPE, preview, anotherProduct, anotherUser]
      .map(textOpenWorldPlayerTutorialStorageKeyV1)
    expect(new Set(keys).size).toBe(4)
    expect(keys.every(key => key.startsWith(TEXT_OPEN_WORLD_PLAYER_TUTORIAL_STORAGE_PREFIX_V1)))
      .toBe(true)
    expect(textOpenWorldPlayerTutorialStorageKeyV1(sameProductAnotherReleaseOrSession)).toBe(keys[0])

    const releaseStore = createTextOpenWorldPlayerTutorialStoreV1(RELEASE_SCOPE)
    releaseStore.complete('system.opening')
    releaseStore.setSuppress(true)
    const resumedRelease = createTextOpenWorldPlayerTutorialStoreV1(sameProductAnotherReleaseOrSession)
    expect(resumedRelease.getSnapshot()).toMatchObject({
      completedStepKeys: ['system.opening'],
      suppressAutomatic: true,
    })
    expect(createTextOpenWorldPlayerTutorialStoreV1(preview).getSnapshot())
      .toBe(DEFAULT_TEXT_OPEN_WORLD_PLAYER_TUTORIAL_PROGRESS_V1)
    expect(createTextOpenWorldPlayerTutorialStoreV1(anotherProduct).getSnapshot())
      .toBe(DEFAULT_TEXT_OPEN_WORLD_PLAYER_TUTORIAL_PROGRESS_V1)
    expect(createTextOpenWorldPlayerTutorialStoreV1(anotherUser).getSnapshot())
      .toBe(DEFAULT_TEXT_OPEN_WORLD_PLAYER_TUTORIAL_PROGRESS_V1)

    for (const productionKey of ['', ' padded ', 'line\nbreak', 'x'.repeat(257)]) {
      expect(() => textOpenWorldPlayerTutorialStorageKeyV1({
        productionKey,
        runtimeChannel: 'release',
      })).toThrow(/productionKey无效/)
    }
    expect(() => textOpenWorldPlayerTutorialStorageKeyV1({
      ...RELEASE_SCOPE,
      runtimeChannel: 'session-42' as never,
    })).toThrow(/runtimeChannel无效/)
  })

  it('complete、skip、setSuppress与reset产生稳定快照，并安全支持StrictMode重订阅', () => {
    const store = createTextOpenWorldPlayerTutorialStoreV1(RELEASE_SCOPE)
    const initial = store.getSnapshot()
    expect(initial).toBe(store.getSnapshot())
    expect(store.getServerSnapshot()).toBe(DEFAULT_TEXT_OPEN_WORLD_PLAYER_TUTORIAL_PROGRESS_V1)
    const listener = vi.fn()
    const strictModeMount = store.subscribe(listener)
    strictModeMount()
    const strictModeRemount = store.subscribe(listener)

    const completed = store.complete('system.opening')
    expect(store.getSnapshot()).toBe(completed)
    expect(completed.completedStepKeys).toEqual(['system.opening'])
    expect(completed.skippedStepKeys).toEqual([])
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.complete('system.opening')).toBe(completed)
    expect(listener).toHaveBeenCalledTimes(1)

    const skipped = store.skip('system.opening')
    expect(skipped.completedStepKeys).toEqual([])
    expect(skipped.skippedStepKeys).toEqual(['system.opening'])
    expect(store.setSuppress(true)).toMatchObject({ suppressAutomatic: true })
    expect(listener).toHaveBeenCalledTimes(3)

    const reset = store.reset()
    expect(reset).toBe(DEFAULT_TEXT_OPEN_WORLD_PLAYER_TUTORIAL_PROGRESS_V1)
    expect(listener).toHaveBeenCalledTimes(4)
    expect(store.refresh()).toBe(reset)
    expect(listener).toHaveBeenCalledTimes(4)
    strictModeRemount()
    store.complete('system.quests')
    expect(listener).toHaveBeenCalledTimes(4)
  })

  it('localStorage读写失败时保留当前挂载内存，refresh不会把已接受进度清空', () => {
    const blocked: TextOpenWorldPlayerTutorialStorageV1 = {
      getItem: () => null,
      setItem: () => { throw new DOMException('blocked', 'QuotaExceededError') },
      removeItem: () => { throw new DOMException('blocked', 'SecurityError') },
    }
    const store = createTextOpenWorldPlayerTutorialStoreV1(RELEASE_SCOPE, { storage: blocked })
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    const completed = store.complete('system.opening')
    expect(completed.completedStepKeys).toEqual(['system.opening'])
    expect(store.refresh()).toBe(completed)
    expect(store.getSnapshot()).toBe(completed)
    expect(listener).toHaveBeenCalledTimes(1)

    const reset = store.reset()
    expect(reset).toBe(DEFAULT_TEXT_OPEN_WORLD_PLAYER_TUTORIAL_PROGRESS_V1)
    expect(store.refresh()).toBe(reset)
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()

    const inaccessible: TextOpenWorldPlayerTutorialStorageV1 = {
      getItem: () => { throw new DOMException('blocked', 'SecurityError') },
      setItem: () => { throw new DOMException('blocked', 'SecurityError') },
      removeItem: () => { throw new DOMException('blocked', 'SecurityError') },
    }
    const memoryOnly = createTextOpenWorldPlayerTutorialStoreV1(RELEASE_SCOPE, {
      storage: inaccessible,
    })
    expect(memoryOnly.complete('system.map-travel').completedStepKeys)
      .toEqual(['system.map-travel'])
    expect(memoryOnly.refresh().completedStepKeys).toEqual(['system.map-travel'])
  })

  it('同作用域订阅和cross-tab事件同步，Preview及取消订阅实例保持隔离', () => {
    const first = createTextOpenWorldPlayerTutorialStoreV1(RELEASE_SCOPE)
    const second = createTextOpenWorldPlayerTutorialStoreV1(RELEASE_SCOPE)
    const preview = createTextOpenWorldPlayerTutorialStoreV1({
      ...RELEASE_SCOPE,
      runtimeChannel: 'build-preview',
    })
    const firstListener = vi.fn()
    const secondListener = vi.fn()
    const previewListener = vi.fn()
    const unsubscribeFirst = first.subscribe(firstListener)
    const unsubscribeSecond = second.subscribe(secondListener)
    const unsubscribePreview = preview.subscribe(previewListener)

    first.complete('system.opening')
    expect(second.getSnapshot().completedStepKeys).toEqual(['system.opening'])
    expect(firstListener).toHaveBeenCalledTimes(1)
    expect(secondListener).toHaveBeenCalledTimes(1)
    expect(previewListener).not.toHaveBeenCalled()

    const external = progress({
      completedStepKeys: ['system.opening', 'system.quests'],
      suppressAutomatic: true,
    })
    const key = textOpenWorldPlayerTutorialStorageKeyV1(RELEASE_SCOPE)
    localStorage.setItem(key, JSON.stringify(external))
    window.dispatchEvent(new StorageEvent('storage', {
      key,
      newValue: JSON.stringify(external),
    }))
    expect(first.getSnapshot()).toMatchObject({
      completedStepKeys: ['system.opening', 'system.quests'],
      suppressAutomatic: true,
    })
    expect(second.getSnapshot()).toEqual(first.getSnapshot())
    expect(preview.getSnapshot()).toBe(DEFAULT_TEXT_OPEN_WORLD_PLAYER_TUTORIAL_PROGRESS_V1)

    unsubscribeSecond()
    first.skip('system.map-travel')
    expect(second.getSnapshot().skippedStepKeys).toEqual([])
    unsubscribeFirst()
    unsubscribePreview()
  })

  it('系统帮助只列真实支持功能，automaticStep只由当前availability触发', () => {
    expect(TEXT_OPEN_WORLD_SYSTEM_TUTORIAL_STEPS_V1.map(step => step.key)).toEqual([
      'system.opening',
      'system.system-actions',
      'system.fixed-choices',
      'system.natural-input',
      'system.quests',
      'system.map-travel',
      'system.combat',
      'system.inventory-equipment',
      'system.crafting',
      'system.shop',
      'system.formal-save',
    ])
    const featureSupport = allSystemFeatures()
    const opening = projectTextOpenWorldPlayerTutorialsV1({
      progress: progress(),
      featureSupport,
      featureAvailability: { scene: true },
      availableActionKeys: [],
    })
    expect(opening.steps.map(step => step.key)).toEqual(TEXT_OPEN_WORLD_SYSTEM_TUTORIAL_STEPS_V1
      .map(step => step.key))
    expect(opening.automaticStep?.key).toBe('system.opening')

    const laterCombat = projectTextOpenWorldPlayerTutorialsV1({
      progress: progress({ completedStepKeys: ['system.opening'] }),
      featureSupport,
      featureAvailability: { combat: true },
      availableActionKeys: [],
    })
    expect(laterCombat.steps.find(step => step.key === 'system.combat')).toMatchObject({
      status: 'pending',
      targetUiKey: 'overlay.combat',
      targetView: 'scene',
    })
    expect(laterCombat.automaticStep?.key).toBe('system.combat')

    const noCurrentTrigger = projectTextOpenWorldPlayerTutorialsV1({
      progress: progress(),
      featureSupport: { combat: true, quests: true },
      featureAvailability: {},
      availableActionKeys: [],
    })
    expect(noCurrentTrigger.steps.map(step => step.key)).toEqual(['system.quests', 'system.combat'])
    expect(noCurrentTrigger.automaticStep).toBeNull()
    const suppressed = projectTextOpenWorldPlayerTutorialsV1({
      progress: progress({ suppressAutomatic: true }),
      featureSupport,
      featureAvailability: { scene: true },
      availableActionKeys: [],
    })
    expect(suppressed.steps).toHaveLength(11)
    expect(suppressed.automaticStep).toBeNull()
  })

  it('作者教程仅接纳当前可用Action，归一旧target别名并按基础输入→作者→其余系统排序', () => {
    const authoredTutorials = [
      {
        key: 'tutorial.second',
        triggerActionKey: 'action.visible-two',
        targetUiKey: 'overlay.quest-log',
        title: '当前任务行动',
        body: '这个提示只在对应行动当前可用时出现。',
      },
      {
        key: 'tutorial.legacy-alias',
        triggerActionKey: 'action.visible-one',
        targetUiKey: 'ui.action-panel',
        title: '选择行动',
        body: '旧目标键必须归一到当前系统行动区。',
      },
      {
        key: 'tutorial.locked',
        triggerActionKey: 'action.future-secret',
        targetUiKey: 'overlay.quest-log',
        title: '未来任务',
        body: '不应泄漏。',
      },
      {
        key: 'tutorial.unknown-target',
        triggerActionKey: 'action.visible-one',
        targetUiKey: 'overlay.not-real',
        title: '未知面板',
        body: '不应出现。',
      },
      {
        key: 'tutorial.extra-field',
        triggerActionKey: 'action.visible-one',
        targetUiKey: 'play.system-actions',
        title: '带额外字段',
        body: '不应出现。',
        apiKey: 'sk-proj-SENTINEL',
      },
    ]
    const projection = projectTextOpenWorldPlayerTutorialsV1({
      progress: progress(),
      featureSupport: {
        scene: true,
        'system-actions': true,
        quests: true,
        'natural-input': true,
      },
      featureAvailability: {
        'system-actions': true,
        quests: true,
        'natural-input': true,
      },
      availableActionKeys: ['action.visible-one', 'action.visible-two'],
      authoredTutorials,
    })

    expect(projection.steps.map(step => step.key)).toEqual([
      'system.opening',
      'system.system-actions',
      'authored.tutorial.second',
      'authored.tutorial.legacy-alias',
      'system.natural-input',
      'system.quests',
    ])
    expect(projection.steps.find(step => step.key === 'authored.tutorial.legacy-alias'))
      .toMatchObject({
        source: 'authored',
        triggerActionKey: 'action.visible-one',
        targetUiKey: 'play.system-actions',
        targetView: 'scene',
        completion: { kind: 'acknowledge' },
      })
    expect(projection.automaticStep?.key).toBe('system.system-actions')
    expect(projection.incompatibleAuthoredTutorialCount).toBe(2)
    const serialized = JSON.stringify(projection)
    expect(serialized).not.toContain('action.future-secret')
    expect(serialized).not.toContain('未来任务')
    expect(serialized).not.toContain('sk-proj-SENTINEL')

    const noAvailableAuthorAction = projectTextOpenWorldPlayerTutorialsV1({
      progress: progress(),
      featureSupport: { 'system-actions': true, quests: true },
      featureAvailability: { 'system-actions': true },
      availableActionKeys: [],
      authoredTutorials,
    })
    expect(noAvailableAuthorAction.steps.every(step => step.source === 'system')).toBe(true)
    expect(noAvailableAuthorAction.incompatibleAuthoredTutorialCount).toBe(2)
    expect(JSON.stringify(noAvailableAuthorAction)).not.toContain('action.future-secret')
  })

  it('对Presentation宽合同给出仅计数的客户端兼容诊断，且不泄漏被冻结内容', () => {
    const authoredTutorials = Array.from(
      { length: TEXT_OPEN_WORLD_PLAYER_TUTORIAL_LIMITS_V1.maximumAuthoredTutorials + 2 },
      (_, index) => ({
        key: `tutorial.${index}`,
        triggerActionKey: 'action.visible',
        targetUiKey: index === 0 ? 'overlay.future-client' : 'play.system-actions',
        title: index === 1
          ? 'x'.repeat(TEXT_OPEN_WORLD_PLAYER_TUTORIAL_LIMITS_V1.maximumTitleLength + 1)
          : `教程${index}`,
        body: `安全内容${index}`,
      }),
    )
    const projection = projectTextOpenWorldPlayerTutorialsV1({
      progress: progress(),
      featureSupport: { 'system-actions': true },
      featureAvailability: { 'system-actions': true },
      availableActionKeys: ['action.visible'],
      authoredTutorials,
    })
    expect(projection.incompatibleAuthoredTutorialCount).toBe(4)
    expect(projection.steps.filter(step => step.source === 'authored')).toHaveLength(
      TEXT_OPEN_WORLD_PLAYER_TUTORIAL_LIMITS_V1.maximumAuthoredTutorials - 2,
    )
    expect(JSON.stringify(projection)).not.toContain('future-client')
    expect(JSON.stringify(projection)).not.toContain('x'.repeat(80))
  })

  it('已完成或跳过步骤仍可从帮助列表重看，纯投影不会改写进度', () => {
    const store = createTextOpenWorldPlayerTutorialStoreV1(RELEASE_SCOPE)
    store.complete('system.opening')
    store.skip('system.natural-input')
    const snapshot = store.getSnapshot()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    const projected = projectTextOpenWorldPlayerTutorialsV1({
      progress: snapshot,
      featureSupport: { scene: true, 'natural-input': true, quests: true },
      featureAvailability: { scene: true, 'natural-input': true, quests: true },
      availableActionKeys: [],
    })
    expect(projected.steps).toEqual([
      expect.objectContaining({ key: 'system.opening', status: 'completed' }),
      expect.objectContaining({ key: 'system.natural-input', status: 'skipped' }),
      expect.objectContaining({ key: 'system.quests', status: 'pending' }),
    ])
    const replayed = projected.steps.find(step => step.key === 'system.opening')
    expect(replayed).toMatchObject({ status: 'completed', completion: { kind: 'acknowledge' } })
    expect(projected.automaticStep?.key).toBe('system.quests')
    expect(store.getSnapshot()).toBe(snapshot)
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })
})
