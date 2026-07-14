/**
 * R-E-group-ui-and-divine · 6 月 17 日 E 组收尾
 *
 * E-2: 二级导航按内容自适应，不再固定 w-48。
 * E-3: 神明信仰旧 JSON string 数据可正常恢复为对象。
 * E-4: 章节编辑器提供完整状态选择器。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { normalizeWorldviewRecord } from '../../src/stores/worldview'
import type { Worldview } from '../../src/lib/types'

const root = process.cwd()
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

describe('R-E-group-ui-and-divine · E 组收尾', () => {
  it('E-2: 世界观与故事设计二级导航使用内容自适应宽度', () => {
    const files = [
      'src/components/worldview/WorldviewOriginSidebar.tsx',
      'src/components/worldview/WorldviewNaturalPanel.tsx',
      'src/components/worldview/WorldviewHumanityPanel.tsx',
      'src/components/worldview/StoryCorePanel.tsx',
    ]
    for (const file of files) {
      const source = read(file)
      expect(source).toMatch(/w-(?:fit|max) min-w-32 max-w-/)
    }
  })

  it('E-3: 兼容旧版被序列化为 JSON string 的神明信仰数据', () => {
    const row = {
      projectId: 1,
      geography: '', history: '', society: '', culture: '', economy: '', rules: '', summary: '',
      divineDesign: JSON.stringify({
        hasDivinity: true,
        divineRank: '主神 / 次神',
        divineNames: '星母',
        divineRules: '朔日禁火',
      }),
      createdAt: 1,
      updatedAt: 1,
    } as unknown as Worldview

    expect(normalizeWorldviewRecord(row)?.divineDesign).toEqual({
      hasDivinity: true,
      divineRank: '主神 / 次神',
      divineNames: '星母',
      divineRules: '朔日禁火',
    })
  })

  it('E-4: 章节编辑器提供五种状态并写回 status', () => {
    const editorSource = read('src/components/editor/ChapterEditor.tsx')
    const headerSource = read('src/components/editor/ChapterEditorHeader.tsx')
    expect(editorSource).toContain('<ChapterEditorHeader')
    expect(editorSource).toContain('onStatusChange={status =>')
    expect(editorSource).toContain('void updateChapter(currentChapter.id, { status })')
    expect(headerSource).toContain('aria-label="章节状态"')
    for (const status of ['outline', 'draft', 'revised', 'polished', 'final']) {
      expect(headerSource).toContain(`value: '${status}'`)
    }
    expect(headerSource).toContain('onStatusChange(event.target.value as ChapterStatus)')
  })
})
