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

  it('auto post-generation organization uses selective recall and does not restore the state-only model bypass', () => {
    const source = readFileSync(sourcePath, 'utf8')
    const body = source.slice(
      source.indexOf('const handleAutoPostGenerate = async (task: {'),
      source.indexOf('const handleAcceptAI = async (text: string) => {'),
    )

    expect(body).toContain('sourceKeys: [...sourceKeys]')
    expect(body).toContain('CHAPTER_POST_ADOPTION_STEP_SOURCE_KEYS_V1.organization')
    expect(body).toContain('stateReferenceText: task.chapterPlainText')
    expect(body).toContain('buildSelectiveStateContext(task.chapterPlainText, extraStateIds).text')
    expect(body.match(/runChapterOrganization\(/g)).toHaveLength(1)
    expect(body).not.toContain('stateAI.start(')
    expect(body).not.toContain('buildStateExtractPrompt(')
    expect(body).not.toContain('const stateCtx = buildStateContext()')
  })
})
