import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextOpenWorldCreatorStudio from '../../src/components/text-game/TextOpenWorldCreatorStudio'
import {
  inspectTextOpenWorldCreatorNovelSourceV1,
  inspectTextOpenWorldCreatorWorldSourceV1,
  listTextOpenWorldCreatorNovelSourceCatalogV1,
  listTextOpenWorldCreatorWorldSourcesV1,
} from '../../src/lib/open-world/creator-source'
import type {
  AdaptationSourceSelectionV1,
  TextOpenWorldCreatorNovelSourceCatalogV1,
  TextOpenWorldCreatorNovelSourcePreviewV1,
  TextOpenWorldCreatorWorldSourceCandidateV1,
  WorkspaceScope,
} from '../../src/lib/types'

vi.mock('../../src/lib/open-world/creator-source', () => ({
  inspectTextOpenWorldCreatorNovelSourceV1: vi.fn(),
  inspectTextOpenWorldCreatorWorldSourceV1: vi.fn(),
  listTextOpenWorldCreatorNovelSourceCatalogV1: vi.fn(),
  listTextOpenWorldCreatorWorldSourcesV1: vi.fn(),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const WORLD_HASH = 'a'.repeat(64)
const CATALOG_HASH = 'b'.repeat(64)
const PROFILE_HASH = 'c'.repeat(64)
const REFERENCE_HASH = 'd'.repeat(64)
const SCHEMA_HASH = 'e'.repeat(64)
const NOVEL_HASH = 'f'.repeat(64)
const NOVEL_BOUNDARY_HASH = '1'.repeat(64)

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

function novelCatalog(): TextOpenWorldCreatorNovelSourceCatalogV1 {
  return {
    schema: 'storyforge.text-open-world-creator-novel-source-catalog',
    version: 1,
    sourceKind: 'novel',
    workCode: 'novel.river',
    workTitle: '河灯长夜',
    sourceUpdatedAt: Date.UTC(2026, 8, 9, 9, 15),
    coverage: 'full-text',
    outlines: [
      { id: 31, parentId: null, type: 'volume', title: '第一卷 · 入夜', order: 0 },
      { id: 32, parentId: 31, type: 'chapter', title: '河岸失灯', order: 0 },
    ],
    chapters: [
      { id: 41, outlineNodeId: 32, title: '第一章 河岸', order: 0, wordCount: 1600, hasContent: true },
      { id: 42, outlineNodeId: 32, title: '第二章 旧渡', order: 1, wordCount: 1800, hasContent: true },
      { id: 43, outlineNodeId: 32, title: '第三章 无灯', order: 2, wordCount: 0, hasContent: false },
    ],
    range: { firstChapterId: 41, lastChapterId: 43, outlineCount: 2, chapterCount: 3 },
    totalWordCount: 3400,
    readiness: 'ready-with-gaps',
    gaps: [{
      code: 'partial-text',
      severity: 'recommendation',
      title: '部分章纲没有正文',
      detail: '仍可进入会谈，后续需要确认允许推演的范围。',
      requirementKey: null,
    }],
  }
}

function novelPreview(
  selection: AdaptationSourceSelectionV1 = { mode: 'entire-work' },
): TextOpenWorldCreatorNovelSourcePreviewV1 {
  const catalog = novelCatalog()
  const selectedChapters = selection.mode === 'chapters'
    ? catalog.chapters.filter(chapter => selection.chapterIds.includes(chapter.id))
    : selection.mode === 'chapter-range'
      ? catalog.chapters.filter(chapter => chapter.id >= selection.startChapterId && chapter.id <= selection.endChapterId)
      : catalog.chapters
  const selectedOutlines = selection.mode === 'outline-subtree' ? catalog.outlines.slice(1) : catalog.outlines
  return {
    schema: 'storyforge.text-open-world-novel-source-snapshot-preview',
    version: 1,
    sourceKind: 'novel',
    workCode: catalog.workCode,
    workTitle: catalog.workTitle,
    sourceUpdatedAt: catalog.sourceUpdatedAt,
    sourceVersionHash: NOVEL_HASH,
    sourceBoundaryHash: NOVEL_BOUNDARY_HASH,
    coverage: selectedChapters.some(chapter => chapter.hasContent) ? 'full-text' : 'outline-only',
    selection: {
      mode: selection.mode,
      label: selection.mode === 'entire-work'
        ? '整部小说'
        : selection.mode === 'outline-subtree'
          ? '大纲子树：河岸失灯'
          : selection.mode === 'chapter-range'
            ? '章节范围：1-2'
            : `指定章节：${selectedChapters.length}章`,
      selectedChapterCount: selectedChapters.length,
      selectedOutlineCount: selectedOutlines.length,
    },
    outlines: selectedOutlines,
    chapters: selectedChapters,
    storyCoreCount: 1,
    writtenChapterCount: selectedChapters.filter(chapter => chapter.hasContent).length,
    totalWordCount: selectedChapters.reduce((total, chapter) => total + chapter.wordCount, 0),
    sourceUnitCount: selectedChapters.length + selectedOutlines.length + 2,
    readiness: 'ready-with-gaps',
    gaps: catalog.gaps,
  }
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

function radio(host: ParentNode, label: string): HTMLInputElement {
  const result = [...host.querySelectorAll<HTMLLabelElement>('label')]
    .find(candidate => candidate.textContent?.includes(label))
    ?.querySelector<HTMLInputElement>('input[type="radio"]')
  if (!result) throw new Error(`找不到单选项：${label}`)
  return result
}

function setSelect(select: HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value)
  select.dispatchEvent(new Event('change', { bubbles: true }))
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
  const listNovel = vi.mocked(listTextOpenWorldCreatorNovelSourceCatalogV1)
  const inspectNovel = vi.mocked(inspectTextOpenWorldCreatorNovelSourceV1)

  beforeEach(() => {
    vi.resetAllMocks()
    listWorld.mockResolvedValue([worldCandidate()])
    inspectWorld.mockResolvedValue(worldCandidate())
    listNovel.mockResolvedValue(novelCatalog())
    inspectNovel.mockImplementation(input => Promise.resolve(novelPreview(input.selection)))
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
    expect(listNovel).not.toHaveBeenCalled()
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

  it('只用 novelScope 展示四种范围并提交不含正文的候选摘要', async () => {
    const onContinue = vi.fn()
    await act(async () => root.render(createElement(TextOpenWorldCreatorStudio, {
      worldScope,
      novelScope,
      initialSourceKind: 'novel',
      onContinue,
    })))
    await waitFor(() => expect(host.textContent).toContain('河灯长夜'))

    expect(listNovel).toHaveBeenCalledWith(novelScope)
    expect(listWorld).not.toHaveBeenCalled()
    expect(host.textContent).toContain('3 章')
    expect(host.textContent).toContain('2 项')
    expect(host.textContent).toContain('3,400 字')
    expect(radio(host, '整部小说').checked).toBe(true)
    expect(radio(host, '大纲子树')).toBeTruthy()
    expect(radio(host, '章节范围')).toBeTruthy()
    expect(radio(host, '指定章节')).toBeTruthy()

    await act(async () => radio(host, '大纲子树').click())
    const outline = host.querySelector<HTMLSelectElement>('select')!
    await act(async () => setSelect(outline, '32'))
    await act(async () => button(host, '核验小说候选').click())
    await waitFor(() => expect(host.querySelector('[data-testid="creator-novel-preview"]')).not.toBeNull())

    expect(inspectNovel).toHaveBeenLastCalledWith({
      sourceScope: novelScope,
      selection: { mode: 'outline-subtree', outlineNodeId: 32 },
    })
    expect(host.textContent).toContain('候选内容 Hash')
    expect(host.textContent).toContain(NOVEL_HASH)
    expect(host.textContent).toContain(NOVEL_BOUNDARY_HASH)
    expect(host.innerHTML).not.toContain('小说正文不应出现在页面')
    expect(host.innerHTML).not.toContain('contentText')
    expect(host.innerHTML).not.toContain('sourceManifest')

    await act(async () => button(host, '继续到主 Agent 会谈').click())
    expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({
      sourceKind: 'novel',
      sourceScope: novelScope,
      selection: { mode: 'outline-subtree', outlineNodeId: 32 },
      preview: expect.objectContaining({ sourceVersionHash: NOVEL_HASH }),
    }))

    await act(async () => radio(host, '章节范围').click())
    expect(host.querySelectorAll('select')).toHaveLength(2)
    await act(async () => radio(host, '指定章节').click())
    expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(3)
    expect(button(host, '核验小说候选').disabled).toBe(true)
    const secondChapter = [...host.querySelectorAll<HTMLLabelElement>('label')]
      .find(label => label.textContent?.includes('第二章 旧渡'))!
      .querySelector<HTMLInputElement>('input[type="checkbox"]')!
    await act(async () => secondChapter.click())
    expect(button(host, '核验小说候选').disabled).toBe(false)
  })

  it('只有小说上下文时默认进入小说来源，缺少任一上下文都有明确空态', async () => {
    await act(async () => root.render(createElement(TextOpenWorldCreatorStudio, {
      worldScope: null,
      novelScope,
    })))
    await waitFor(() => expect(host.textContent).toContain('河灯长夜'))
    expect(tab(host, '小说作品').getAttribute('aria-selected')).toBe('true')

    await act(async () => tab(host, '冻结世界版本').click())
    await waitFor(() => expect(host.querySelector('[data-testid="creator-world-empty"]')).not.toBeNull())
    expect(listWorld).not.toHaveBeenCalled()

    await act(async () => root.render(createElement(TextOpenWorldCreatorStudio, {
      worldScope,
      novelScope: null,
      initialSourceKind: 'novel',
      worldGroupId: 2,
    })))
    await waitFor(() => expect(host.querySelector('[data-testid="creator-novel-empty"]')).not.toBeNull())
    expect(host.textContent).toContain('当前没有可用的小说 Work')
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
    const novelTab = tab(host, '小说作品')
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
    const novelInspection = deferred<TextOpenWorldCreatorNovelSourcePreviewV1>()
    listWorld.mockReturnValueOnce(firstWorldList.promise).mockResolvedValueOnce([worldCandidate()])
    inspectNovel.mockReturnValueOnce(novelInspection.promise)

    await act(async () => root.render(createElement(TextOpenWorldCreatorStudio, {
      worldScope,
      novelScope,
    })))
    expect(host.querySelector('[data-testid="creator-source-loading"]')).not.toBeNull()
    await act(async () => tab(host, '小说作品').click())
    await waitFor(() => expect(host.textContent).toContain('河灯长夜'))

    await act(async () => firstWorldList.resolve([worldCandidate()]))
    await act(async () => { await Promise.resolve() })
    expect(tab(host, '小说作品').getAttribute('aria-selected')).toBe('true')
    expect(host.textContent).not.toContain('盐脊世界 · 第三版')

    await act(async () => button(host, '核验小说候选').click())
    await act(async () => tab(host, '冻结世界版本').click())
    await waitFor(() => expect(host.textContent).toContain('盐脊世界 · 第三版'))
    await act(async () => novelInspection.resolve(novelPreview()))
    await act(async () => { await Promise.resolve() })

    expect(tab(host, '冻结世界版本').getAttribute('aria-selected')).toBe('true')
    expect(host.querySelector('[data-testid="creator-novel-preview"]')).toBeNull()
    expect(host.textContent).not.toContain(NOVEL_HASH)
    expect(host.querySelectorAll('[role="radio"]')).toHaveLength(1)
  })
})
