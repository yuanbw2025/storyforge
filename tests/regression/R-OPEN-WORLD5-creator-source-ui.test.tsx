import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextOpenWorldCreatorStudio from '../../src/components/text-game/TextOpenWorldCreatorStudio'
import {
  inspectTextOpenWorldCreatorWorldSourceV1,
  listTextOpenWorldCreatorWorldSourcesV1,
} from '../../src/lib/open-world/creator-source'
import { deriveTextOpenWorldNovelWorldDraftV1, previewTextOpenWorldNovelWorldDraftV1, type TextOpenWorldNovelWorldDraftPreviewV1 } from '../../src/lib/open-world/novel-world-derivation'
import type {
  TextOpenWorldCreatorWorldSourceCandidateV1,
  WorkspaceScope,
} from '../../src/lib/types'

vi.mock('../../src/lib/open-world/creator-source', () => ({
  inspectTextOpenWorldCreatorWorldSourceV1: vi.fn(),
  listTextOpenWorldCreatorWorldSourcesV1: vi.fn(),
}))

vi.mock('../../src/lib/open-world/novel-world-derivation', () => ({
  deriveTextOpenWorldNovelWorldDraftV1: vi.fn(), previewTextOpenWorldNovelWorldDraftV1: vi.fn(),
}))

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)

const WORLD_HASH = 'a'.repeat(64)
const CATALOG_HASH = 'b'.repeat(64)
const PROFILE_HASH = 'c'.repeat(64)
const REFERENCE_HASH = 'd'.repeat(64)
const SCHEMA_HASH = 'e'.repeat(64)
const NOVEL_HASH = 'f'.repeat(64)

const worldScope: WorkspaceScope = { projectId: 11, worldId: 12, workId: 13 }
const novelScope: WorkspaceScope = { projectId: 21, worldId: 22, workId: 23 }

function worldCandidate(
  overrides: Partial<Pick<TextOpenWorldCreatorWorldSourceCandidateV1, 'readiness' | 'gaps'>> = {},
): TextOpenWorldCreatorWorldSourceCandidateV1 {
  return {
    schema: 'storyforge.text-open-world-creator-world-source-candidate',
    version: 1,
    sourceKind: 'world-release',
    worldReference: {
      schema: 'storyforge.world-reference',
      version: 1,
      worldCode: 'world.salt-ridge',
      releaseUid: 'release.salt-ridge.v3',
      releaseVersion: 3,
      releaseHash: WORLD_HASH,
      localReleaseRecordId: 71,
      manifestIdentity: {
        schema: 'storyforge.world-release',
        version: 3,
        semanticContract: 3,
        schemaHash: SCHEMA_HASH,
      },
      capabilityIdentity: { catalogHash: CATALOG_HASH, profileHash: PROFILE_HASH },
      referenceHash: REFERENCE_HASH,
    },
    label: '盐脊世界 · 第三版',
    worldName: '盐脊',
    workTitle: '盐脊纪事',
    releasedAt: Date.UTC(2026, 8, 8, 10, 30),
    capabilities: [{
      area: 'story',
      resourceCount: 4,
      rowCount: 18,
      status: 'available',
      selectionStatus: 'selected',
      selectedResourceCount: 4,
      omittedResourceCount: 0,
      confirmedRowCount: 18,
      candidateRowCount: 0,
      conflictRowCount: 0,
      omittedRowCount: 0,
      latestRevision: 5,
      originalEvidenceAvailable: true,
      queryableIndexAvailable: true,
    }, {
      area: 'characters',
      resourceCount: 2,
      rowCount: 6,
      status: 'partial',
      selectionStatus: 'partial-selection',
      selectedResourceCount: 1,
      omittedResourceCount: 1,
      confirmedRowCount: 4,
      candidateRowCount: 1,
      conflictRowCount: 0,
      omittedRowCount: 1,
      latestRevision: 4,
      originalEvidenceAvailable: true,
      queryableIndexAvailable: true,
    }],
    resourceCounts: {
      totalResources: 6,
      totalRows: 24,
      byArea: [
        { area: 'story', resourceCount: 4, rowCount: 18 },
        { area: 'characters', resourceCount: 2, rowCount: 6 },
      ],
      byKind: [{ resourceKind: 'story-core', resourceCount: 2, rowCount: 5 }],
    },
    requirements: [{
      key: 'tow.story',
      label: '核心故事来源',
      level: 'stable-required',
      selector: { areas: ['story'], resourceKinds: [], contextKinds: [], query: null },
      minimumResources: 1,
      condition: null,
      status: 'matched',
      matchedResourceKeys: ['resource.story'],
      availableResourceCount: 4,
      reasonCodes: [],
    }],
    readiness: overrides.readiness ?? 'ready-with-gaps',
    gaps: overrides.gaps ?? [{
      code: 'character-coverage',
      severity: 'recommendation',
      title: '建议补充次要角色',
      detail: '当前角色足以开始，但地区事件的角色变化空间较少。',
      requirementKey: null,
    }],
  }
}

function novelPreview(scope = novelScope): TextOpenWorldNovelWorldDraftPreviewV1 {
  return { sourceScope: scope, workCode: 'novel.river', workTitle: '河灯长夜', range: 'all-confirmed-canon',
    sourceRevision: { version: 1, entries: [], vectorHash: NOVEL_HASH }, previewHash: NOVEL_HASH }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function button(host: ParentNode, label: string): HTMLButtonElement {
  const result = [...host.querySelectorAll<HTMLButtonElement>('button')]
    .find(candidate => candidate.textContent?.includes(label))
  if (!result) throw new Error(`找不到按钮：${label}`)
  return result
}

function tab(host: ParentNode, label: string): HTMLButtonElement {
  const result = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    .find(candidate => candidate.textContent?.includes(label))
  if (!result) throw new Error(`找不到来源标签：${label}`)
  return result
}

async function waitFor(assertion: () => void | Promise<void>): Promise<void> {
  const started = Date.now()
  let last: unknown
  while (Date.now() - started < 5_000) {
    try {
      await act(async () => { await assertion() })
      return
    } catch (cause) {
      last = cause
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    }
  }
  throw last
}

describe('TOW-G5-01 · 创作者双来源 UI', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  const listWorld = vi.mocked(listTextOpenWorldCreatorWorldSourcesV1)
  const inspectWorld = vi.mocked(inspectTextOpenWorldCreatorWorldSourceV1)
  const previewNovel = vi.mocked(previewTextOpenWorldNovelWorldDraftV1)
  const deriveDraft = vi.mocked(deriveTextOpenWorldNovelWorldDraftV1)

  beforeEach(() => {
    vi.resetAllMocks()
    listWorld.mockResolvedValue([worldCandidate()])
    inspectWorld.mockResolvedValue(worldCandidate())
    previewNovel.mockResolvedValue(novelPreview())
    deriveDraft.mockResolvedValue({ targetProjectId: 99 } as Awaited<ReturnType<typeof deriveTextOpenWorldNovelWorldDraftV1>>)
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it('只通过 worldScope 核验完整版本并把精确候选交给下一步', async () => {
    const onContinue = vi.fn()
    await act(async () => root.render(createElement(TextOpenWorldCreatorStudio, {
      worldScope,
      novelScope,
      onContinue,
    })))
    await waitFor(() => expect(host.textContent).toContain('盐脊世界 · 第三版'))

    expect(listWorld).toHaveBeenCalledWith(worldScope)
    expect(previewNovel).not.toHaveBeenCalled()
    expect(host.textContent).toContain('尚未冻结、模型尚未实读、未开始计费和生产')
    expect(host.textContent).toContain(WORLD_HASH)
    expect(host.innerHTML).not.toContain('sourceManifest')
    expect(host.innerHTML).not.toContain('contentText')

    const sourceButton = [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
      .find(candidate => candidate.textContent?.includes('盐脊世界'))!
    expect(sourceButton.getAttribute('aria-checked')).toBe('false')
    await act(async () => sourceButton.click())
    await waitFor(() => expect(host.querySelector('[data-testid="creator-world-preview"]')).not.toBeNull())

    expect(inspectWorld).toHaveBeenCalledWith({
      scope: worldScope,
      localReleaseRecordId: 71,
      expectedReleaseHash: WORLD_HASH,
    })
    expect(sourceButton.getAttribute('aria-checked')).toBe('true')
    expect(host.textContent).toContain('故事素材')
    expect(host.textContent).toContain('6 项')
    expect(host.textContent).toContain('建议补充次要角色')
    expect(host.textContent).toContain(CATALOG_HASH)

    await act(async () => button(host, '继续到主 Agent 会谈').click())
    expect(onContinue).toHaveBeenCalledTimes(1)
    expect(onContinue.mock.calls[0]?.[0]).toEqual({
      sourceKind: 'world-release',
      sourceScope: worldScope,
      localReleaseRecordId: 71,
      expectedReleaseHash: WORLD_HASH,
      preview: worldCandidate(),
    })
  })

  it('父入口传入等值的新 scope 对象时不重载目录，也不丢失已核验候选', async () => {
    const onContinue = vi.fn()
    await act(async () => root.render(createElement(TextOpenWorldCreatorStudio, {
      worldScope: { ...worldScope },
      novelScope: { ...novelScope },
      onContinue,
    })))
    await waitFor(() => expect(host.textContent).toContain('盐脊世界 · 第三版'))
    const sourceButton = [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
      .find(candidate => candidate.textContent?.includes('盐脊世界'))!
    await act(async () => sourceButton.click())
    await waitFor(() => expect(host.querySelector('[data-testid="creator-world-preview"]')).not.toBeNull())

    await act(async () => root.render(createElement(TextOpenWorldCreatorStudio, {
      worldScope: { ...worldScope },
      novelScope: { ...novelScope },
      onContinue,
    })))
    await act(async () => { await Promise.resolve() })

    expect(listWorld).toHaveBeenCalledTimes(1)
    expect(inspectWorld).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[data-testid="creator-world-preview"]')?.textContent).toContain('盐脊')
    expect(button(host, '继续到主 Agent 会谈').disabled).toBe(false)
  })

  it('严格复核世界 handoff，并同时展示阻断与建议缺口', async () => {
    const blocked = worldCandidate({
      readiness: 'blocked',
      gaps: [{
        code: 'core-story-missing',
        severity: 'blocking',
        title: '缺少必需来源：核心故事',
        detail: '当前世界版本没有可支撑主线拆解的确认故事素材。',
        requirementKey: 'tow.story',
      }, {
        code: 'minor-character-coverage',
        severity: 'recommendation',
        title: '建议补充次要角色',
        detail: '更多次要角色可以丰富地区任务。',
        requirementKey: null,
      }],
    })
    listWorld.mockResolvedValueOnce([blocked])
    inspectWorld.mockResolvedValueOnce(blocked)

    await act(async () => root.render(createElement(TextOpenWorldCreatorStudio, {
      worldScope,
      novelScope,
      initialSource: {
        schema: 'storyforge.product-production-handoff',
        version: 1,
        productType: 'text-open-world',
        worldReleaseId: 71,
        worldContentHash: WORLD_HASH,
      },
      onContinue: vi.fn(),
    })))
    await waitFor(() => expect(host.querySelector('[data-testid="creator-world-preview"]')).not.toBeNull())

    expect(inspectWorld).toHaveBeenCalledWith({
      scope: worldScope,
      localReleaseRecordId: 71,
      expectedReleaseHash: WORLD_HASH,
    })
    expect(host.textContent).toContain('当前阻断')
    expect(host.textContent).toContain('缺少必需来源：核心故事')
    expect(host.textContent).toContain('建议补充次要角色')
    expect(button(host, '继续到主 Agent 会谈').disabled).toBe(true)

    await act(async () => root.render(createElement(TextOpenWorldCreatorStudio, {
      worldScope: { ...worldScope },
      novelScope: { ...novelScope },
      initialSource: {
        productType: 'text-open-world',
        worldContentHash: WORLD_HASH,
        version: 1,
        worldReleaseId: 71,
        schema: 'storyforge.product-production-handoff',
      },
      onContinue: vi.fn(),
    })))
    await act(async () => { await Promise.resolve() })
    expect(listWorld).toHaveBeenCalledTimes(1)
    expect(inspectWorld).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[data-testid="creator-world-preview"]')).not.toBeNull()
  })

  it('005 小说入口明确全部已确认语义，作者确认后只创建独立世界草稿，不提交小说正式会谈', async () => {
    const onContinue = vi.fn()
    await act(async () => root.render(createElement(TextOpenWorldCreatorStudio, {
      worldScope, novelScope, initialSourceKind: 'novel', onContinue,
    })))
    await waitFor(() => expect(host.textContent).toContain('河灯长夜'))
    expect(previewNovel).toHaveBeenCalledWith(novelScope)
    expect(listWorld).not.toHaveBeenCalled()
    expect(host.textContent).toContain('全部已确认语义')
    expect(host.textContent).toContain('不提供按卷')
    expect(host.querySelectorAll('input[type="radio"]')).toHaveLength(0)
    expect(button(host, '派生独立世界草稿').disabled).toBe(true)
    const acknowledge = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    await act(async () => acknowledge.click())
    expect(button(host, '派生独立世界草稿').disabled).toBe(false)
    await act(async () => button(host, '派生独立世界草稿').click())
    await waitFor(() => expect(host.textContent).toContain('独立世界草稿已创建'))
    expect(deriveDraft).toHaveBeenCalledTimes(1)
    expect(deriveDraft).toHaveBeenCalledWith(novelPreview())
    expect(onContinue).not.toHaveBeenCalled()
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/world/basics?project=99')
    expect(host.textContent).toContain('尚未封存')
    expect(host.textContent).toContain('不会被迁移或改写')
  })

  it('005 取消或重新检查不会派生；源漂移失败保留预览并要求重新确认', async () => {
    await act(async () => root.render(createElement(TextOpenWorldCreatorStudio, { novelScope })))
    await waitFor(() => expect(host.textContent).toContain('河灯长夜'))
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
    await act(async () => button(host, '取消派生').click())
    expect(button(host, '派生独立世界草稿').disabled).toBe(true)
    expect(deriveDraft).not.toHaveBeenCalled()
    await act(async () => button(host, '重新检查当前来源').click())
    expect(previewNovel).toHaveBeenCalledTimes(2)
    deriveDraft.mockRejectedValueOnce(new Error('作者预览后源作品已变化'))
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
    await act(async () => button(host, '派生独立世界草稿').click())
    await waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('源作品已变化'))
    expect(host.textContent).toContain('河灯长夜')
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false)
    expect(host.querySelector('a')).toBeNull()
  })

  it('005 双击只派生一次，切换 Work 后不展示旧请求的世界链接', async () => {
    const pending = deferred<Awaited<ReturnType<typeof deriveTextOpenWorldNovelWorldDraftV1>>>()
    deriveDraft.mockReturnValueOnce(pending.promise)
    const otherScope = { projectId: 81, worldId: 82, workId: 83 }
    previewNovel.mockImplementation(async scope => ({ ...novelPreview(scope),
      workTitle: scope.workId === otherScope.workId ? '另一部小说' : '河灯长夜' }))
    await act(async () => root.render(createElement(TextOpenWorldCreatorStudio, { novelScope })))
    await waitFor(() => expect(host.textContent).toContain('河灯长夜'))
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
    await act(async () => { const action = button(host, '派生独立世界草稿'); action.click(); action.click() })
    expect(deriveDraft).toHaveBeenCalledTimes(1)
    await act(async () => root.render(createElement(TextOpenWorldCreatorStudio, { novelScope: otherScope })))
    await waitFor(() => expect(host.textContent).toContain('另一部小说'))
    await act(async () => pending.resolve({ targetProjectId: 99 } as Awaited<ReturnType<typeof deriveTextOpenWorldNovelWorldDraftV1>>))
    expect(host.querySelector('a')).toBeNull()
    expect(host.textContent).not.toContain('独立世界草稿已创建')
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false)
  })

  it('只有小说上下文时默认进入小说来源，缺少任一上下文都有明确空态', async () => {
    await act(async () => root.render(createElement(TextOpenWorldCreatorStudio, {
      worldScope: null,
      novelScope,
    })))
    await waitFor(() => expect(host.textContent).toContain('河灯长夜'))
    expect(tab(host, '从小说派生世界').getAttribute('aria-selected')).toBe('true')

    await act(async () => tab(host, '冻结世界版本').click())
    await waitFor(() => expect(host.querySelector('[data-testid="creator-world-empty"]')).not.toBeNull())
    expect(listWorld).not.toHaveBeenCalled()

    await act(async () => root.render(createElement(TextOpenWorldCreatorStudio, {
      worldScope,
      novelScope: null,
      initialSourceKind: 'novel',
      worldGroupId: 2,
    })))
    await waitFor(() => expect(host.querySelector('[data-testid="creator-novel-world-draft"]')).not.toBeNull())
    expect(host.textContent).toContain('请先打开一部独立长篇或短篇小说')
  })

  it('显示加载、目录空态与安全错误，并拒绝无效 handoff', async () => {
    const pending = deferred<TextOpenWorldCreatorWorldSourceCandidateV1[]>()
    listWorld.mockReturnValueOnce(pending.promise)
    await act(async () => root.render(createElement(TextOpenWorldCreatorStudio, {
      worldScope,
      novelScope,
    })))
    expect(host.querySelector('[data-testid="text-open-world-creator-studio"]')?.getAttribute('aria-busy')).toBe('true')
    expect(host.querySelector('[data-testid="creator-source-loading"]')?.getAttribute('role')).toBe('status')

    await act(async () => pending.resolve([]))
    await waitFor(() => expect(host.querySelector('[data-testid="creator-world-empty"]')).not.toBeNull())

    listWorld.mockRejectedValueOnce(new Error('[db-secret] 世界目录暂时不可用'))
    await act(async () => root.render(createElement(TextOpenWorldCreatorStudio, {
      worldScope,
      novelScope,
      worldGroupId: 9,
    })))
    await waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('世界目录暂时不可用'))
    expect(host.querySelector('[role="alert"]')?.textContent).not.toContain('db-secret')

    listWorld.mockResolvedValueOnce([worldCandidate()])
    await act(async () => root.render(createElement(TextOpenWorldCreatorStudio, {
      worldScope,
      novelScope,
      initialSource: {
        schema: 'storyforge.product-production-handoff',
        version: 1,
        productType: 'avg',
        worldReleaseId: 71,
        worldContentHash: WORLD_HASH,
      },
    })))
    await waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('不属于文字开放世界'))
    expect(inspectWorld).not.toHaveBeenCalled()
    expect(button(host, '继续到主 Agent 会谈').disabled).toBe(true)
  })

  it('实现可访问 tab 键盘语义，且未接 G5-02 时继续按钮保持禁用', async () => {
    await act(async () => root.render(createElement(TextOpenWorldCreatorStudio, {
      worldScope,
      novelScope,
    })))
    await waitFor(() => expect(host.textContent).toContain('盐脊世界'))
    const worldTab = tab(host, '冻结世界版本')
    const novelTab = tab(host, '从小说派生世界')
    expect(worldTab.getAttribute('aria-selected')).toBe('true')
    expect(worldTab.tabIndex).toBe(0)
    expect(novelTab.tabIndex).toBe(-1)

    await act(async () => worldTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    expect(novelTab.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(novelTab)
    await waitFor(() => expect(host.textContent).toContain('河灯长夜'))

    await act(async () => novelTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })))
    expect(worldTab.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(worldTab)
    expect(button(host, '继续到主 Agent 会谈').getAttribute('aria-disabled')).toBe('true')
    expect(host.textContent).toContain('G5-02 接口尚未接入')
  })

  it('快速切源和来源核验交错时丢弃旧响应，不把选择或结果串到另一来源', async () => {
    const firstWorldList = deferred<TextOpenWorldCreatorWorldSourceCandidateV1[]>()
    const novelInspection = deferred<TextOpenWorldNovelWorldDraftPreviewV1>()
    listWorld.mockReturnValueOnce(firstWorldList.promise).mockResolvedValueOnce([worldCandidate()])
    previewNovel.mockReturnValueOnce(novelInspection.promise)

    await act(async () => root.render(createElement(TextOpenWorldCreatorStudio, {
      worldScope,
      novelScope,
    })))
    expect(host.querySelector('[data-testid="creator-source-loading"]')).not.toBeNull()
    await act(async () => tab(host, '从小说派生世界').click())
    await waitFor(() => expect(host.textContent).toContain('正在检查已保存的小说来源'))

    await act(async () => firstWorldList.resolve([worldCandidate()]))
    await act(async () => { await Promise.resolve() })
    expect(tab(host, '从小说派生世界').getAttribute('aria-selected')).toBe('true')
    expect(host.textContent).not.toContain('盐脊世界 · 第三版')

    await act(async () => tab(host, '冻结世界版本').click())
    await waitFor(() => expect(host.textContent).toContain('盐脊世界 · 第三版'))
    await act(async () => novelInspection.resolve(novelPreview()))
    await act(async () => { await Promise.resolve() })

    expect(tab(host, '冻结世界版本').getAttribute('aria-selected')).toBe('true')
    expect(host.querySelector('[data-testid="creator-novel-world-draft"]')).toBeNull()
    expect(host.textContent).not.toContain(NOVEL_HASH)
    expect(host.querySelectorAll('[role="radio"]')).toHaveLength(1)
  })
})
