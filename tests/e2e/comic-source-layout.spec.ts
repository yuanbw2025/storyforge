import { expect, test } from '@playwright/test'
import type { AdaptationSourceUnit } from '../../src/lib/types'

for (const viewport of [{ width: 1728, height: 997 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  test(`203 comic source rows keep full titles and readable evidence at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    await page.route('**/*', route => {
      const url = new URL(route.request().url())
      return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort()
    })
    await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'bug025-isolated'))
    await page.goto('./')
    const fixture = await page.evaluate(async () => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const [{ createWorkspace }, { db }, { stampNewRecord }, { createAdaptation, listActiveSourceUnits }, { defaultComicTargetSpec }] = await Promise.all([
        load<typeof import('../../src/lib/workspace/create-workspace')>('/storyforge/src/lib/workspace/create-workspace.ts'),
        load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts'),
        load<typeof import('../../src/lib/workspace/scope')>('/storyforge/src/lib/workspace/scope.ts'),
        load<typeof import('../../src/lib/adaptation/source-manifest')>('/storyforge/src/lib/adaptation/source-manifest.ts'),
        load<typeof import('../../src/lib/comic/authoring')>('/storyforge/src/lib/comic/authoring.ts'),
      ])
      const source = await createWorkspace({ name: '025 隔离原作', description: '本地排版验证', genres: [], status: 'drafting', targetWordCount: 1000000 }, { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' })
      for (let i = 0; i < 101; i++) {
        const title = i === 0 ? '第一章 ' + '长标题中文没有空格'.repeat(8)
          : i === 1 ? '第二章 ' + '极长标题'.repeat(100)
            : i === 2 ? '第三章 多行标题\n第二行保留\n第三行保留' : `第${i + 1}章 来源标题与因果线索`
        const outlineNodeId = await db.outlineNodes.add(stampNewRecord(source.scope, 'outlineNodes', {
          projectId: source.scope.projectId, parentId: null, type: 'chapter', title, summary: i % 2 ? '' : '大纲证据', order: i, createdAt: 1, updatedAt: 1,
        }, { owner: 'work' })) as number
        await db.chapters.add(stampNewRecord(source.scope, 'chapters', {
          projectId: source.scope.projectId, outlineNodeId, title,
          content: `025 正文起点 ${i + 1}。` + '正文证据'.repeat(350) + `。025 正文末尾 ${i + 1}`,
          summary: '', status: 'draft', order: i, wordCount: 1400, notes: '', createdAt: 1, updatedAt: 1,
        }, { owner: 'work' }))
      }
      const adapted = await createAdaptation({ sourceScope: source.scope, sourceWorkId: source.work.id!, title: '025 隔离漫画', sourceSelection: { mode: 'entire-work' }, medium: 'comic', targetSpec: defaultComicTargetSpec() })
      const units = await listActiveSourceUnits(adapted.adaptation.id!)
      return { workId: adapted.targetWork.id!, sourceWorkId: source.work.id!, units, hash: adapted.adaptation.activeSourceManifestHash }
    })
    expect(fixture.units).toHaveLength(203)
    await page.goto(`./comic/source?work=${fixture.workId}`)
    const nav = page.getByRole('navigation', { name: '原作来源单元' })
    const buttons = nav.getByRole('button')
    const reader = page.getByRole('article', { name: '原作内容' })
    await expect(buttons).toHaveCount(203)
    await page.locator('.cp-source').scrollIntoViewIfNeeded()
    const geometry = await nav.evaluate(element => {
      const rows = [...element.querySelectorAll('button')]
      const failures: string[] = []
      let lastBottom = -Infinity
      rows.forEach((row, index) => {
        const bounds = row.getBoundingClientRect()
        if (bounds.top < lastBottom - 1) failures.push(`row ${index} overlaps previous row`)
        lastBottom = bounds.bottom
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
        let node: Node | null
        while ((node = walker.nextNode())) {
          if (!node.textContent?.trim()) continue
          const range = document.createRange(); range.selectNodeContents(node)
          for (const line of range.getClientRects()) {
            if (line.top < bounds.top - 1 || line.bottom > bounds.bottom + 1 || line.left < bounds.left - 1 || line.right > bounds.right + 1) failures.push(`text leaves row ${index}`)
          }
        }
      })
      return { failures, scrollHeight: element.scrollHeight, height: element.clientHeight, overflow: document.documentElement.scrollWidth > innerWidth }
    })
    expect(geometry.failures).toEqual([])
    expect(geometry.scrollHeight).toBeGreaterThan(geometry.height)
    expect(geometry.overflow).toBe(false)
    // Every title remains present, including explicit newlines and the 400-char title.
    expect(await nav.locator('.cp-source-unit-title').allTextContents()).toEqual(fixture.units.map(unit => unit.label))
    const select = async (unit: AdaptationSourceUnit) => {
      const index = fixture.units.findIndex(row => row.sourceUnitKey === unit.sourceUnitKey)
      await buttons.nth(index).click()
      await expect(buttons.nth(index)).toHaveAttribute('aria-pressed', 'true')
      await expect(nav.locator('[aria-pressed=true]')).toHaveCount(1)
      await expect(reader).toHaveAttribute('aria-busy', 'false')
    }
    const outline = fixture.units.find(unit => unit.sourceKind === 'outline-node' && unit.label.startsWith('第二章'))!
    expect(outline.wordCount).toBe(0)
    await select(outline)
    // Metadata units have zero prose words but still expose their title/summary.
    await expect(reader.locator('pre')).toHaveText(outline.label)
    const chapters = fixture.units.filter(unit => unit.sourceKind === 'chapter')
    for (const index of [0, 1, 2, 50, 100]) {
      await select(chapters[index])
      await expect(reader.locator('pre')).toContainText(`025 正文起点 ${index + 1}。`)
      await expect(reader.locator('pre')).toContainText(`025 正文末尾 ${index + 1}`)
    }
    expect(await nav.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await select(chapters[0])
    await reader.scrollIntoViewIfNeeded()
    expect(await reader.locator('pre').evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
    const artifact = (name: string) => process.env.BUG025_ARTIFACT_DIR ? `${process.env.BUG025_ARTIFACT_DIR}/${name}` : testInfo.outputPath(name)
    await page.screenshot({ path: artifact(`reading-${viewport.width}.png`) })
    const readingGeometry = await reader.evaluate(element => {
      const box = element.getBoundingClientRect()
      return { width: box.width, top: box.top, bottom: box.bottom, horizontalOverflow: element.scrollWidth > element.clientWidth }
    })
    expect(readingGeometry.width).toBeGreaterThan(viewport.width === 390 ? 250 : 400)
    expect(readingGeometry.top).toBeLessThan(viewport.height)
    expect(readingGeometry.bottom).toBeGreaterThan(0)
    expect(readingGeometry.horizontalOverflow).toBe(false)
    await select(chapters[2])
    await page.screenshot({ path: artifact(`multiline-${viewport.width}.png`) })
    const saved = await page.evaluate(async ({ workId, sourceWorkId }) => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
      return { units: await db.adaptationSourceUnits.where('workId').equals(workId).toArray(), chapters: await db.chapters.filter(chapter => 'workId' in chapter && chapter.workId === sourceWorkId).count(), hash: (await db.adaptationProjects.where('workId').equals(workId).first())!.activeSourceManifestHash }
    }, fixture)
    expect(saved.units.sort((a, b) => a.order - b.order)).toEqual(fixture.units)
    expect(saved.chapters).toBe(101)
    expect(saved.hash).toBe(fixture.hash)
    await page.reload()
    await expect(buttons).toHaveCount(203)
    await select(chapters[100])
    await expect(reader).toContainText('025 正文末尾 101')
  })
}
