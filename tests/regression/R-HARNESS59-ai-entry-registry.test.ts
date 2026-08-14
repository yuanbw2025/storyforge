import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface Entry {
  file: string
  calls: number
  status: 'governed' | 'auxiliary' | 'migration'
  nextUnit?: string
  mechanism?: string
}

const registry = JSON.parse(readFileSync('src/lib/agent/ai-entry-registry.json', 'utf8')) as {
  version: number
  entries: Entry[]
}

describe('R-HARNESS59 · 分步骤 UI 模型入口注册表', () => {
  it('AST 守卫证明所有直调入口均登记且调用计数一致', () => {
    const output = execFileSync(process.execPath, ['scripts/check-ai-entry-registry.mjs'], { encoding: 'utf8' })
    expect(output).toContain('16 files / 30 calls')
    expect(output).toContain('governed 7, auxiliary 4, migration 5')
  })

  it('高风险正式写入入口不能冒充已治理或只读辅助', () => {
    const byFile = new Map(registry.entries.map(entry => [entry.file, entry]))
    expect(byFile.has('src/components/editor/FloatingToolbar.tsx')).toBe(false)
    expect(byFile.has('src/components/geography/WorldMapPanel.tsx')).toBe(false)
    for (const file of ['src/components/project/AnalysisReportViewer.tsx']) {
      expect(byFile.get(file)).toMatchObject({ status: 'migration', nextUnit: 'HARNESS-60' })
    }
  })

  it('已治理运行时与真正只读入口保留明确机制，迁移时可逐项清零', () => {
    expect(registry.entries.filter(entry => entry.status === 'governed')).toHaveLength(7)
    expect(registry.entries.filter(entry => entry.status === 'auxiliary')).toHaveLength(4)
    expect(registry.entries.filter(entry => entry.status === 'migration')).toHaveLength(5)
    expect(registry.entries.some(entry => entry.file.endsWith('ForeshadowPanel.tsx'))).toBe(false)
    expect(registry.entries.some(entry => entry.file.endsWith('CultivationProgressPanel.tsx'))).toBe(false)
    expect(registry.entries.some(entry => entry.file.endsWith('CodexPanel.tsx'))).toBe(false)
    expect(registry.entries.some(entry => entry.file.endsWith('InventoryPanel.tsx'))).toBe(false)
    expect(registry.entries.some(entry => entry.file.endsWith('StoryTimelinePanel.tsx'))).toBe(false)
    expect(registry.entries.some(entry => entry.file.endsWith('WorldGroupOverview.tsx'))).toBe(false)
    expect(registry.entries.some(entry => entry.file.endsWith('WorldConstitutionPanel.tsx'))).toBe(false)
    expect(registry.entries.find(entry => entry.file.endsWith('ChapterEditor.tsx'))?.mechanism).toBe('durable-run')
    expect(registry.entries.find(entry => entry.file.endsWith('SceneVerifyPanel.tsx'))?.mechanism).toBe('read-only-review')
  })
})
