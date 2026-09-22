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
  it('独立预览样式预算不放宽正式应用样式，且仍有明确上限', () => {
    const distDir = makeDist('console.log("ok")')
    const justOverApp = 'x'.repeat(BUNDLE_BUDGETS.stylesheet.raw + 1)
    fs.writeFileSync(path.join(distDir, 'assets/app-test.css'), justOverApp)
    fs.writeFileSync(path.join(distDir, 'assets/ui-preview-test.css'), justOverApp)
    expect(checkBundleBudget(distDir).violations.map(item => item.filename)).toEqual(['app-test.css'])
    fs.writeFileSync(path.join(distDir, 'assets/ui-preview-test.css'), 'x'.repeat(BUNDLE_BUDGETS.previewStylesheet.raw + 1))
    expect(checkBundleBudget(distDir).violations.map(item => item.filename)).toEqual(['app-test.css', 'ui-preview-test.css'])
  })

  it('全局安全对话只在用户选择立即备份后装入完整项目导出闭包', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/safety/require-backup-before.ts'),
      'utf8',
    )

    expect(source).not.toMatch(/^import .*['"]\.\.\/export\/json-export['"]/m)
    expect(source).toContain("await import('../export/json-export')")
  })
})
