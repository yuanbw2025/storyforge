import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextOpenWorldSaveSettingsPanel, {
  type TextOpenWorldSaveSettingsPanelProps,
} from '../../src/components/text-game/TextOpenWorldSaveSettingsPanel'
import type {
  TextOpenWorldPlayerCheckpointV1,
  TextOpenWorldPlayerSaveBranchV1,
  TextOpenWorldPlayerSaveSummaryV1,
  TextOpenWorldPlayerSavesProjectionV1,
} from '../../src/lib/open-world/player-saves'
import type {
  TextOpenWorldPlayerVersionCompatibilityProjectionV1,
} from '../../src/lib/open-world/player-version-compatibility'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const CURRENT_SESSION_ID = 710_000_031
const HISTORICAL_SESSION_ID = 710_000_032
const MANUAL_CHECKPOINT_ID = 810_000_041
const AUTOSAVE_CHECKPOINT_ID = 810_000_042
const COMBAT_CHECKPOINT_ID = 810_000_043
const MILESTONE_CHECKPOINT_ID = 810_000_044
const CURRENT_RELEASE_ID = 910_000_051
const TARGET_RELEASE_ID = 910_000_052

const SUMMARY: TextOpenWorldPlayerSaveSummaryV1 = {
  runtimeFormat: 'vnext',
  level: 4,
  locationLabel: '盐港',
  regionLabel: '盐脊',
  mainlineLabel: '追查断流',
  worldTimeLabel: '第 3 日 08:20',
}

function checkpoint(input: {
  uiId: string
  checkpointId: number
  name: string
  purpose: TextOpenWorldPlayerCheckpointV1['purpose']
  purposeLabel: string
  health?: TextOpenWorldPlayerCheckpointV1['health']
  repairable?: boolean
}): TextOpenWorldPlayerCheckpointV1 {
  const health = input.health ?? 'available'
  return {
    uiId: input.uiId,
    actionIdentity: { sessionId: CURRENT_SESSION_ID, checkpointId: input.checkpointId },
    name: input.name,
    purpose: input.purpose,
    purposeLabel: input.purposeLabel,
    createdAt: 1_780_000_000_000 + input.checkpointId % 1_000,
    summary: health === 'damaged' ? null : SUMMARY,
    health,
    healthLabel: health === 'available'
      ? '可读取'
      : health === 'repairable' ? '可从规范事件修复' : '需要诊断',
    repairable: input.repairable ?? health === 'repairable',
  }
}

function checkpoints(): TextOpenWorldPlayerCheckpointV1[] {
  return [
    checkpoint({
      uiId: 'save-manual-1', checkpointId: MANUAL_CHECKPOINT_ID,
      name: '进入盐渠前', purpose: 'manual', purposeLabel: '手动存档',
    }),
    checkpoint({
      uiId: 'save-auto-1', checkpointId: AUTOSAVE_CHECKPOINT_ID,
      name: '抵达盐港', purpose: 'autosave', purposeLabel: '自动存档',
      health: 'repairable',
    }),
    checkpoint({
      uiId: 'save-combat-1', checkpointId: COMBAT_CHECKPOINT_ID,
      name: '豺群交战前', purpose: 'combat-retry', purposeLabel: '战前重试点',
    }),
    checkpoint({
      uiId: 'save-milestone-1', checkpointId: MILESTONE_CHECKPOINT_ID,
      name: '主线阶段完成', purpose: 'milestone', purposeLabel: '里程碑',
      health: 'damaged',
    }),
  ]
}

function branch(input: {
  current: boolean
  fullManualSlots?: boolean
}): TextOpenWorldPlayerSaveBranchV1 {
  const used = input.fullManualSlots ? 20 : 19
  return {
    uiId: input.current ? 'branch-current' : 'branch-history',
    actionIdentity: {
      sessionId: input.current ? CURRENT_SESSION_ID : HISTORICAL_SESSION_ID,
    },
    title: input.current ? '当前盐脊时间线' : '渠口调查分支',
    statusLabel: input.current ? '活动' : '已暂停',
    relationship: input.current ? 'root' : 'child',
    relationshipLabel: input.current ? '主时间线' : '分支时间线',
    parentTitle: input.current ? null : '当前盐脊时间线',
    depth: input.current ? 0 : 1,
    isCurrent: input.current,
    updatedAt: input.current ? 1_780_000_001_000 : 1_780_000_000_000,
    runtimeFormat: 'vnext',
    summary: SUMMARY,
    runtimeHealth: input.current ? 'available' : 'repairable',
    runtimeHealthLabel: input.current ? '运行状态可读取' : '运行缓存可从规范事件修复',
    runtimeRepairable: !input.current,
    manualSlots: { used, limit: 20, remaining: 20 - used },
    checkpoints: input.current ? checkpoints() : [],
  }
}

function saves(fullManualSlots = false): TextOpenWorldPlayerSavesProjectionV1 {
  const branches = [branch({ current: true, fullManualSlots }), branch({ current: false })]
  return {
    groups: [{
      uiId: 'save-group-release-1',
      title: '盐脊',
      versionLabel: '版本 1',
      sourceKind: '正式发布',
      branchCount: branches.length,
      branches,
    }],
    totalBranches: branches.length,
    totalCheckpoints: checkpoints().length,
  }
}

function readyVersions(): TextOpenWorldPlayerVersionCompatibilityProjectionV1 {
  return {
    version: 1,
    availability: 'ready',
    productionKey: 'fixture.salt-ridge',
    pinnedRelease: {
      version: 1,
      label: '盐脊旧版',
      createdAt: 1_780_000_000_000,
      isLatestVerifiedRelease: false,
      canContinueWithoutUpgrade: true,
    },
    releases: [
      {
        actionIdentity: { productReleaseId: TARGET_RELEASE_ID },
        version: 2,
        label: '盐脊修复版',
        createdAt: 1_780_000_100_000,
        relationToPinned: 'newer',
        verified: true,
        declaredCompatibleWithPinnedRelease: true,
        compatibilityDeclaration: 'direct-release-lineage',
        canMigratePinnedSession: true,
      },
      {
        actionIdentity: { productReleaseId: CURRENT_RELEASE_ID },
        version: 1,
        label: '盐脊旧版',
        createdAt: 1_780_000_000_000,
        relationToPinned: 'pinned',
        verified: true,
        declaredCompatibleWithPinnedRelease: null,
        compatibilityDeclaration: null,
        canMigratePinnedSession: false,
      },
    ],
    diagnostics: [],
    migration: { available: true, reason: 'compatible-release-available' },
  }
}

function previewVersions(): TextOpenWorldPlayerVersionCompatibilityProjectionV1 {
  return {
    version: 1,
    availability: 'build-preview-excluded',
    productionKey: null,
    pinnedRelease: null,
    releases: [],
    diagnostics: [{
      code: 'build-preview-excluded',
      releaseVersion: null,
      message: '制作预览不属于正式版本目录。',
    }],
    migration: { available: false, reason: 'not-applicable' },
  }
}

function callbacks() {
  return {
    onCreateManualSave: vi.fn(async (_name: string) => undefined),
    onForkCurrent: vi.fn(async (_title: string) => undefined),
    onForkCheckpoint: vi.fn(async (_checkpointId: number, _title: string) => undefined),
    onSelectBranch: vi.fn(async (_sessionId: number) => undefined),
    onDeleteCheckpoint: vi.fn(async (_checkpointId: number) => undefined),
    onDeleteBranch: vi.fn(async (_sessionId: number) => undefined),
    onRepairCheckpoint: vi.fn(async (_checkpointId: number) => undefined),
    onRepairRuntimeHead: vi.fn(async (_sessionId: number) => undefined),
    onPreviewReleaseMigration: vi.fn(async (targetProductReleaseId: number) => ({
      version: 1 as const,
      status: 'ready' as const,
      previewHash: 'a'.repeat(64),
      actionIdentity: { sourceSessionId: CURRENT_SESSION_ID, targetProductReleaseId },
      source: {
        releaseVersion: 1, releaseLabel: '盐脊旧版', throughSequence: 12,
        stateHash: 'b'.repeat(64),
      },
      target: { releaseVersion: 2, releaseLabel: '盐脊修复版' },
      summary: { playerLevel: 4, locationLabel: '盐港', activeQuestCount: 3, worldMinute: 1_920 },
      guarantees: {
        originalSessionUnchanged: true as const,
        originalReleasePinned: true as const,
        createsChildSession: true as const,
        targetReleaseVerified: true as const,
        stateValidatedAgainstTargetPackage: true as const,
      },
      warnings: ['迁移会创建绑定新Release的子时间线，不会覆盖原存档。'],
    })),
    onMigrateRelease: vi.fn(async (_targetProductReleaseId: number, _previewHash: string) => undefined),
    onRefresh: vi.fn(async () => undefined),
  }
}

function panelProps(
  actions: ReturnType<typeof callbacks>,
  overrides: Partial<TextOpenWorldSaveSettingsPanelProps> = {},
): TextOpenWorldSaveSettingsPanelProps {
  return {
    sessionKey: 'session:current',
    productionKey: 'fixture.salt-ridge',
    formalSaveAvailable: true,
    audioAvailable: false,
    saves: saves(),
    versions: readyVersions(),
    busy: false,
    ...actions,
    ...overrides,
  }
}

function buttonByText(root: ParentNode, text: string, contains = false): HTMLButtonElement {
  const result = Array.from(root.querySelectorAll('button')).find(button => (
    contains ? button.textContent?.includes(text) : button.textContent?.trim() === text
  ))
  if (!(result instanceof HTMLButtonElement)) throw new Error(`找不到按钮:${text}`)
  return result
}

function articleByText(root: ParentNode, text: string): HTMLElement {
  const result = Array.from(root.querySelectorAll('article')).find(article => article.textContent?.includes(text))
  if (!(result instanceof HTMLElement)) throw new Error(`找不到条目:${text}`)
  return result
}

function confirmationDialog(): HTMLElement {
  const result = document.querySelector<HTMLElement>('[role="alertdialog"]')
  if (!result) throw new Error('找不到存档确认框')
  return result
}

async function click(target: HTMLButtonElement) {
  await act(async () => {
    target.click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

async function inputText(target: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(target, value)
    target.dispatchEvent(new Event('input', { bubbles: true }))
    target.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

describe('Text Open World G4-12E · 存档、分支、版本与设置纯组件', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    localStorage.clear()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  async function render(props: TextOpenWorldSaveSettingsPanelProps) {
    await act(async () => {
      root.render(createElement(TextOpenWorldSaveSettingsPanel, props))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
  }

  it('提供四个可聚焦分类、四类存档分组和设置面板，且不渲染内部actionIdentity', async () => {
    const actions = callbacks()
    await render(panelProps(actions))

    const panel = host.querySelector<HTMLElement>('[data-testid="text-open-world-save-settings"]')!
    const nav = panel.querySelector<HTMLElement>('nav[aria-label="存档与设置分类"]')!
    const tabs = Array.from(nav.querySelectorAll('button'))
    expect(tabs).toHaveLength(4)
    expect(tabs.map(tab => tab.textContent?.replace(/\d+/g, ''))).toEqual(['存档', '分支', '版本', '设置'])
    expect(tabs[0]?.getAttribute('aria-current')).toBe('page')

    const purposes = Array.from(panel.querySelectorAll<HTMLElement>('[data-save-purpose]'))
      .map(section => section.dataset.savePurpose)
    expect(purposes).toEqual(['manual', 'autosave', 'combat-retry', 'milestone'])
    expect(panel.textContent).toContain('手动存档')
    expect(panel.textContent).toContain('自动存档')
    expect(panel.textContent).toContain('战前重试点')
    expect(panel.textContent).toContain('里程碑')
    for (const internalId of [
      CURRENT_SESSION_ID, HISTORICAL_SESSION_ID, MANUAL_CHECKPOINT_ID,
      AUTOSAVE_CHECKPOINT_ID, COMBAT_CHECKPOINT_ID, MILESTONE_CHECKPOINT_ID,
      CURRENT_RELEASE_ID, TARGET_RELEASE_ID,
    ]) expect(panel.textContent).not.toContain(String(internalId))

    const settingsTab = buttonByText(nav, '设置')
    settingsTab.focus()
    expect(document.activeElement).toBe(settingsTab)
    await click(settingsTab)
    expect(settingsTab.getAttribute('aria-current')).toBe('page')
    expect(host.querySelector('[data-testid="text-open-world-player-preferences"]')).toBeTruthy()
    expect(host.textContent).toContain('阅读与声音')
    expect(host.textContent).toContain('只保存在此浏览器')
  })

  it('20个手动档用满时禁止输入，存在空位时裁剪名称并正常保存', async () => {
    const actions = callbacks()
    await render(panelProps(actions, { saves: saves(true) }))

    let input = host.querySelector<HTMLInputElement>('#text-open-world-manual-save-name')!
    let submit = buttonByText(host, '保存当前进度')
    expect(host.textContent).toContain('20/20 个手动档')
    expect(input.disabled).toBe(true)
    expect(input.placeholder).toBe('20 个手动档已用满')
    expect(submit.disabled).toBe(true)
    expect(actions.onCreateManualSave).not.toHaveBeenCalled()

    await render(panelProps(actions, {
      sessionKey: 'session:with-one-slot',
      saves: saves(false),
    }))
    input = host.querySelector<HTMLInputElement>('#text-open-world-manual-save-name')!
    submit = buttonByText(host, '保存当前进度')
    expect(host.textContent).toContain('19/20 个手动档')
    expect(input.disabled).toBe(false)
    await inputText(input, '   进入北闸之前   ')
    expect(submit.disabled).toBe(false)
    await click(submit)
    expect(actions.onCreateManualSave).toHaveBeenCalledTimes(1)
    expect(actions.onCreateManualSave).toHaveBeenCalledWith('进入北闸之前')
    expect(input.value).toBe('')
  })

  it('从历史检查点继续必须先确认并保留原时间线，修复直达而删除必须确认', async () => {
    const actions = callbacks()
    await render(panelProps(actions))

    const manual = articleByText(host, '进入盐渠前')
    const continueButton = buttonByText(manual, '从此处继续')
    continueButton.focus()
    await click(continueButton)
    let forkDialog = confirmationDialog()
    const panel = host.querySelector<HTMLElement>('[data-testid="text-open-world-save-settings"]')!
    const confirmForkButton = buttonByText(forkDialog, '建立分支并继续')
    const cancelForkButton = buttonByText(forkDialog, '取消')
    expect(actions.onForkCheckpoint).not.toHaveBeenCalled()
    expect(forkDialog.getAttribute('aria-modal')).toBe('true')
    expect(document.querySelector('[data-testid="text-open-world-save-confirmation-backdrop"]')).toBeTruthy()
    expect(panel.hasAttribute('inert')).toBe(true)
    expect(panel.getAttribute('aria-hidden')).toBe('true')
    expect(forkDialog.textContent).toContain('当前时间线和之后发生的事件都会保留')
    expect(forkDialog.textContent).toContain('新的时间线分支')
    expect(document.activeElement).toBe(cancelForkButton)
    await act(async () => {
      cancelForkButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(document.activeElement).toBe(confirmForkButton)
    await act(async () => {
      confirmForkButton.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Tab', shiftKey: true, bubbles: true,
      }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(document.activeElement).toBe(cancelForkButton)
    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
    expect(panel.hasAttribute('inert')).toBe(false)
    expect(panel.getAttribute('aria-hidden')).toBeNull()
    expect(document.activeElement).toBe(continueButton)

    await click(continueButton)
    forkDialog = confirmationDialog()
    await click(buttonByText(forkDialog, '建立分支并继续'))
    expect(actions.onForkCheckpoint).toHaveBeenCalledWith(
      MANUAL_CHECKPOINT_ID,
      '当前盐脊时间线 · 进入盐渠前',
    )
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()

    const repairable = articleByText(host, '抵达盐港')
    expect(buttonByText(repairable, '从此处继续').disabled).toBe(true)
    expect(Array.from(repairable.querySelectorAll('button')).some(button => button.textContent === '删除')).toBe(false)
    await click(buttonByText(repairable, '从规范事件修复'))
    expect(actions.onRepairCheckpoint).toHaveBeenCalledWith(AUTOSAVE_CHECKPOINT_ID)

    await click(buttonByText(manual, '删除'))
    const deleteDialog = confirmationDialog()
    expect(actions.onDeleteCheckpoint).not.toHaveBeenCalled()
    expect(deleteDialog.textContent).toContain('不会删除所属时间线或正式发布')
    expect(deleteDialog.textContent).toContain('释放一个手动档位')
    await click(buttonByText(deleteDialog, '确认删除检查点'))
    expect(actions.onDeleteCheckpoint).toHaveBeenCalledWith(MANUAL_CHECKPOINT_ID)
  })

  it('分支列表可选择和修复历史分支，删除前明确保护Release与其它时间线', async () => {
    const actions = callbacks()
    await render(panelProps(actions))
    await click(buttonByText(host.querySelector('nav')!, '分支', true))

    expect(host.textContent).not.toContain(String(CURRENT_SESSION_ID))
    expect(host.textContent).not.toContain(String(HISTORICAL_SESSION_ID))
    const current = articleByText(host, '当前盐脊时间线')
    expect(buttonByText(current, '正在游玩').disabled).toBe(true)
    const historical = articleByText(host, '渠口调查分支')
    await click(buttonByText(historical, '继续此时间线'))
    expect(actions.onSelectBranch).toHaveBeenCalledWith(HISTORICAL_SESSION_ID)
    await click(buttonByText(historical, '修复运行缓存'))
    expect(actions.onRepairRuntimeHead).toHaveBeenCalledWith(HISTORICAL_SESSION_ID)

    await click(buttonByText(historical, '删除时间线'))
    const dialog = confirmationDialog()
    expect(actions.onDeleteBranch).not.toHaveBeenCalled()
    expect(dialog.textContent).toContain('不会删除共享 Release、父时间线或其它分支')
    await click(buttonByText(dialog, '确认删除时间线'))
    expect(actions.onDeleteBranch).toHaveBeenCalledWith(HISTORICAL_SESSION_ID)
  })

  it('旧Release保持固定；直接兼容新版先预演再显式创建迁移分支，Build Preview不混入正式版本', async () => {
    const actions = callbacks()
    await render(panelProps(actions))
    await click(buttonByText(host.querySelector('nav')!, '版本'))

    expect(host.textContent).toContain('当前存档固定版本')
    expect(host.textContent).toContain('盐脊旧版 · v1')
    expect(host.textContent).toContain('不会被静默升级')
    expect(host.querySelector('[data-version-relation="newer"]')?.textContent)
      .toBe('直接兼容子版本 · 可预演迁移')
    expect(host.textContent).toContain('状态级预演后才能迁移')
    await click(buttonByText(host, '预演迁移'))
    expect(actions.onPreviewReleaseMigration).toHaveBeenCalledWith(TARGET_RELEASE_ID)
    expect(host.textContent).toContain('迁移预演已通过')
    expect(host.textContent).toContain('玩家等级4')
    expect(host.textContent).toContain('不会覆盖原存档')
    const migrate = buttonByText(host, '创建迁移分支并切换')
    expect(migrate.disabled).toBe(true)
    const acknowledge = host.querySelector<HTMLInputElement>('.open-world-version-migration-preview input[type="checkbox"]')!
    await act(async () => { acknowledge.click() })
    expect(migrate.disabled).toBe(false)
    await click(migrate)
    expect(actions.onMigrateRelease).toHaveBeenCalledWith(TARGET_RELEASE_ID, 'a'.repeat(64))

    await render(panelProps(actions, {
      sessionKey: 'session:build-preview',
      formalSaveAvailable: false,
      versions: previewVersions(),
    }))
    const previewTabs = host.querySelectorAll<HTMLButtonElement>('nav[aria-label="存档与设置分类"] button')
    expect(previewTabs[0]?.disabled).toBe(true)
    expect(previewTabs[1]?.disabled).toBe(true)
    expect(host.textContent).not.toContain('保存当前进度')
    expect(host.textContent).not.toContain('建立新分支')
    await click(buttonByText(host.querySelector('nav')!, '版本'))
    expect(host.textContent).toContain('当前是制作预览')
    expect(host.textContent).toContain('制作预览不属于正式版本目录')
    expect(host.textContent).not.toContain('同作品正式版本')
    expect(host.textContent).not.toContain('盐脊旧版 · v1')
  })

  it('切换Session后丢弃旧异步操作的失败，不把错误或忙碌状态带入新存档', async () => {
    let rejectRefresh!: (reason: Error) => void
    const pendingRefresh = new Promise<never>((_resolve, reject) => { rejectRefresh = reject })
    const actions = callbacks()
    actions.onRefresh.mockImplementationOnce(() => pendingRefresh)
    await render(panelProps(actions))

    await act(async () => {
      buttonByText(host, '刷新').click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(buttonByText(host, '刷新').disabled).toBe(true)

    await render(panelProps(actions, { sessionKey: 'session:new' }))
    expect(buttonByText(host, '刷新').disabled).toBe(false)
    rejectRefresh(new Error('旧Session内部错误'))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

    expect(host.textContent).not.toContain('旧Session内部错误')
    expect(buttonByText(host, '刷新').disabled).toBe(false)
  })

  it('当前Session操作失败只显示安全分类文案，不回显内部错误正文', async () => {
    const actions = callbacks()
    actions.onRefresh.mockRejectedValueOnce(new Error('SQL constraint / secret-internal-id-42'))
    await render(panelProps(actions))

    await click(buttonByText(host, '刷新'))

    expect(host.textContent).toContain('操作未能完成，请确认当前状态后重试。')
    expect(host.textContent).not.toContain('SQL constraint')
    expect(host.textContent).not.toContain('secret-internal-id-42')
  })

  it('旧Session成功操作返回后不会清空新Session正在输入的存档名', async () => {
    let resolveSave!: () => void
    const pendingSave = new Promise<void>(resolve => { resolveSave = resolve })
    const actions = callbacks()
    actions.onCreateManualSave.mockImplementationOnce(() => pendingSave)
    await render(panelProps(actions))
    await inputText(host.querySelector<HTMLInputElement>('#text-open-world-manual-save-name')!, '旧档名')
    await click(buttonByText(host, '保存当前进度'))

    await render(panelProps(actions, { sessionKey: 'session:new-with-draft' }))
    const currentInput = host.querySelector<HTMLInputElement>('#text-open-world-manual-save-name')!
    await inputText(currentInput, '新档正在输入')
    resolveSave()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

    expect(currentInput.value).toBe('新档正在输入')
    expect(host.textContent).not.toContain('旧Session内部错误')
  })
})
