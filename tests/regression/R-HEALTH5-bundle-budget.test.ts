import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BUNDLE_BUDGETS, checkBundleBudget } from '../../scripts/check-bundle-size.mjs'

const tempDirs: string[] = []

function makeDist(entryContent: string): string {
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storyforge-bundle-budget-'))
  tempDirs.push(distDir)
  fs.mkdirSync(path.join(distDir, 'assets'))
  fs.writeFileSync(
    path.join(distDir, 'index.html'),
    '<script type="module" crossorigin src="/storyforge/assets/index-test.js"></script>',
  )
  fs.writeFileSync(path.join(distDir, 'assets/index-test.js'), entryContent)
  fs.writeFileSync(path.join(distDir, 'assets/lazy-test.js'), 'export const lazy = true')
  return distDir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

describe('HEALTH-5 · 构建产物体积预算', () => {
  it('从 index.html 识别入口并接受预算内产物', () => {
    const result = checkBundleBudget(makeDist('console.log("ok")'))

    expect(result.entryScript).toBe('index-test.js')
    expect(result.violations).toEqual([])
  })

  it('入口原始体积或 gzip 体积超限时报告具体文件', () => {
    const distDir = makeDist('x'.repeat(BUNDLE_BUDGETS.entryScript.raw + 1))
    const result = checkBundleBudget(distDir)

    expect(result.violations.map(item => item.filename)).toContain('index-test.js')
  })
})
