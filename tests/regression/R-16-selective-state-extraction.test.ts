/**
 * R-16: state extraction must use selective state recall.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sourcePath = resolve(process.cwd(), 'src/components/editor/ChapterEditor.tsx')

describe('R-16: selective state extraction wiring', () => {
  it('manual state extraction uses selective recall from current chapter text', () => {
    const source = readFileSync(sourcePath, 'utf8')
    const body = source.slice(
      source.indexOf('const handleExtractState = async () => {'),
      source.indexOf('const handleAcceptDiffs = async'),
    )

    expect(body).toContain('buildSelectiveStateContext(plainText, extraStateIds).text')
    expect(body).not.toContain('const stateCtx = buildStateContext()')
  })

  it('auto post-generation state extraction uses selective recall from generated text', () => {
    const source = readFileSync(sourcePath, 'utf8')
    const body = source.slice(
      source.indexOf('const handleAutoPostGenerate = async (task: {'),
      source.indexOf('const handleAcceptAI = async (text: string) => {'),
    )

    expect(body).toContain('buildSelectiveStateContext(task.chapterPlainText, extraStateIds).text')
    expect(body).not.toContain('const stateCtx = buildStateContext()')
  })
})
