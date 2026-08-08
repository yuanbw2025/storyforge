/**
 * R-16: state extraction must use selective state recall.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sourcePath = resolve(process.cwd(), 'src/components/editor/ChapterEditor.tsx')

describe('R-16: selective state extraction wiring', () => {
  it('manual chapter organization uses selective state recall from the persisted chapter text', () => {
    const source = readFileSync(sourcePath, 'utf8')
    const body = source.slice(
      source.indexOf('const handleRunChapterOrganization = async'),
      source.indexOf('const handleApplyChapterOrganization = async'),
    )

    expect(body).toContain('buildSelectiveStateContext(persisted.plain, extraStateIds).text')
    expect(body).not.toContain('const stateCtx = buildStateContext()')
  })

  it('auto post-generation state extraction uses selective recall from generated text', () => {
    const source = readFileSync(sourcePath, 'utf8')
    const body = source.slice(
      source.indexOf('const handleAutoPostGenerate = async (task: {'),
      source.indexOf('const handleAcceptAI = async (text: string) => {'),
    )

    expect(body).toContain("sourceKeys: [...CHAPTER_TRANSITION_SOURCE_KEYS_V1]")
    expect(body).toContain('stateReferenceText: task.chapterPlainText')
    expect(body).toContain("assembled.included.indexOf('stateCards')")
    expect(body).not.toContain('const stateCtx = buildStateContext()')
  })
})
